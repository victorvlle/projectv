// Degraus de formato do banco. Só ACRESCENTE degraus no fim; nunca edite um que
// já rodou em produção. Cada `sql` é dividido em comandos por ";" + quebra de linha.

const { ATIVIDADES } = require('../atividades/catalogo');
const { FESTA_PADRAO } = require('./festa-padrao');

module.exports = [
  {
    nome: 'convidados, configuração, atividades e pontos',
    sql: `
      CREATE TABLE config (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      );
      CREATE TABLE convidados (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        apelido TEXT,
        avatar TEXT,
        codigo TEXT NOT NULL UNIQUE,
        ativo INTEGER NOT NULL DEFAULT 1,
        fora INTEGER NOT NULL DEFAULT 0,
        exibir INTEGER NOT NULL DEFAULT 1,
        sessao_versao INTEGER NOT NULL DEFAULT 1,
        primeiro_acesso_em INTEGER,
        criado_em INTEGER NOT NULL,
        atualizado_em INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_convidados_apelido ON convidados (apelido COLLATE NOCASE) WHERE apelido IS NOT NULL;
      CREATE TABLE atividades (
        id TEXT PRIMARY KEY,
        estado TEXT NOT NULL CHECK (estado IN ('bloqueada', 'agendada', 'liberada')),
        abre_em INTEGER,
        atualizado_em INTEGER NOT NULL
      );
      CREATE TABLE pontos_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        convidado_id TEXT NOT NULL REFERENCES convidados(id) ON DELETE CASCADE,
        atividade TEXT NOT NULL,
        pontos INTEGER NOT NULL,
        motivo TEXT NOT NULL,
        chave TEXT UNIQUE,
        criado_em INTEGER NOT NULL
      );
      CREATE INDEX idx_pontos_convidado ON pontos_log (convidado_id)
    `,
    // Valores iniciais. INSERT OR IGNORE: rodar de novo nunca sobrescreve o que o admin mudou.
    async depois(c) {
      const agora = Date.now();
      const comandos = Object.entries(FESTA_PADRAO).map(([chave, valor]) => ({
        sql: 'INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)',
        args: [chave, JSON.stringify(valor)],
      }));
      for (const a of ATIVIDADES) {
        comandos.push({
          sql: 'INSERT OR IGNORE INTO atividades (id, estado, abre_em, atualizado_em) VALUES (?, ?, ?, ?)',
          args: [a.id, a.padrao.estado, a.padrao.abreEm ? Date.parse(a.padrao.abreEm) : null, agora],
        });
      }
      await c.batch(comandos, 'write');
    },
  },
  {
    // Horário confirmado: 17h à meia-noite. Só troca o início se ainda for o
    // padrão antigo (21h); se o admin já tiver mudado, respeita.
    nome: 'horário da festa: 17h às 00h',
    sql: `
      INSERT OR IGNORE INTO config (chave, valor) VALUES ('fim', '"2026-11-01T00:00:00-04:00"');
      UPDATE config SET valor = '"2026-10-31T17:00:00-04:00"'
       WHERE chave = 'inicio' AND valor = '"2026-10-31T21:00:00-04:00"'
    `,
  },
  {
    nome: 'lista de bebidas',
    sql: `
      CREATE TABLE IF NOT EXISTS bebidas_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        unidade TEXT NOT NULL DEFAULT 'un.',
        meta INTEGER NOT NULL DEFAULT 0,
        ordem INTEGER NOT NULL DEFAULT 0,
        criado_em INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bebidas_itens_nome ON bebidas_itens (nome COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS bebidas_compromissos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        convidado_id TEXT NOT NULL REFERENCES convidados(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES bebidas_itens(id),
        nome_livre TEXT,
        unidade_livre TEXT,
        quantidade INTEGER NOT NULL CHECK (quantidade BETWEEN 1 AND 99),
        criado_em INTEGER NOT NULL,
        atualizado_em INTEGER NOT NULL,
        CHECK ((item_id IS NULL) <> (nome_livre IS NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bebidas_um_por_item ON bebidas_compromissos (convidado_id, item_id) WHERE item_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bebidas_um_por_livre ON bebidas_compromissos (convidado_id, nome_livre COLLATE NOCASE) WHERE nome_livre IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_bebidas_item ON bebidas_compromissos (item_id);
      INSERT OR IGNORE INTO config (chave, valor) VALUES ('bebidasAberta', 'true')
    `,
    // Sugestão inicial com metas (o admin ajusta tudo no painel). Só entra se a lista estiver vazia.
    async depois(c) {
      const r = await c.execute('SELECT COUNT(*) AS n FROM bebidas_itens');
      if (Number(r.rows[0].n) > 0) return;
      const { SUGESTOES } = require('./bebidas-sugestoes');
      const agora = Date.now();
      await c.batch(SUGESTOES.map((s, i) => ({
        sql: 'INSERT INTO bebidas_itens (nome, unidade, meta, ordem, criado_em) VALUES (?, ?, ?, ?, ?)',
        args: [s.nome, s.unidade, s.meta, i, agora],
      })), 'write');
    },
  },
  {
    // Ajuste do organizador (24/10) na lista que já estava no ar. Cada mudança
    // só acontece se o item ainda tiver o nome original; o que alguém já tinha
    // prometido de um item retirado vira "outra bebida" (nada se perde).
    nome: 'bebidas: metas definidas pelo organizador',
    sql: 'SELECT 1',
    async depois(c) {
      const comandos = [];
      for (const nome of ['Gelo', 'Água', 'Suco']) {
        comandos.push(
          { sql: `UPDATE bebidas_compromissos SET nome_livre = (SELECT nome FROM bebidas_itens WHERE id = item_id),
                    unidade_livre = (SELECT unidade FROM bebidas_itens WHERE id = item_id), item_id = NULL
                  WHERE item_id IN (SELECT id FROM bebidas_itens WHERE nome = ?)`, args: [nome] },
          { sql: 'DELETE FROM bebidas_itens WHERE nome = ?', args: [nome] },
        );
      }
      const metas = [['Gin', 3], ['Refrigerante', 3], ['Tequila (para os shots)', 1], ['Cerveja', 20]];
      for (const [nome, meta] of metas) comandos.push({ sql: 'UPDATE bebidas_itens SET meta = ? WHERE nome = ?', args: [meta, nome] });
      comandos.push({
        sql: `UPDATE bebidas_itens SET nome = 'Energético Tropical', unidade = 'garrafas de 2 L', meta = 3
              WHERE nome = 'Energético'
                AND NOT EXISTS (SELECT 1 FROM bebidas_itens WHERE nome = 'Energético Tropical' COLLATE NOCASE)`,
        args: [],
      });
      await c.batch(comandos, 'write');
    },
  },
  {
    // Cerveja passa a ser contada em longnecks (meta continua 20).
    nome: 'cerveja em longnecks',
    sql: "UPDATE bebidas_itens SET unidade = 'longnecks' WHERE nome = 'Cerveja' AND unidade = 'latas'",
  },
  {
    // Não existe mais a opção de se esconder da lista: todo mundo aparece.
    nome: 'todos aparecem nos confirmados',
    sql: 'UPDATE convidados SET exibir = 1 WHERE exibir <> 1',
  },
  {
    nome: 'playlist, caronas, como chegar e o pós',
    sql: `
      CREATE TABLE IF NOT EXISTS playlist_musicas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        convidado_id TEXT NOT NULL REFERENCES convidados(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL,
        artista TEXT NOT NULL,
        chave TEXT NOT NULL UNIQUE,
        criado_em INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_playlist_convidado ON playlist_musicas (convidado_id);
      CREATE TABLE IF NOT EXISTS playlist_votos (
        musica_id INTEGER NOT NULL REFERENCES playlist_musicas(id) ON DELETE CASCADE,
        convidado_id TEXT NOT NULL REFERENCES convidados(id) ON DELETE CASCADE,
        criado_em INTEGER NOT NULL,
        PRIMARY KEY (musica_id, convidado_id)
      );
      CREATE TABLE IF NOT EXISTS caronas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        motorista_id TEXT NOT NULL UNIQUE REFERENCES convidados(id) ON DELETE CASCADE,
        vagas INTEGER NOT NULL CHECK (vagas BETWEEN 1 AND 6),
        trajeto TEXT NOT NULL CHECK (trajeto IN ('ida', 'volta', 'ida_volta')),
        saindo TEXT NOT NULL,
        obs TEXT,
        criado_em INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS caronas_reservas (
        carona_id INTEGER NOT NULL REFERENCES caronas(id) ON DELETE CASCADE,
        convidado_id TEXT NOT NULL UNIQUE REFERENCES convidados(id) ON DELETE CASCADE,
        criado_em INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reservas_carona ON caronas_reservas (carona_id);
      CREATE TABLE IF NOT EXISTS pos_opcoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        ordem INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_nome ON pos_opcoes (nome COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS pos_votos (
        convidado_id TEXT PRIMARY KEY REFERENCES convidados(id) ON DELETE CASCADE,
        opcao_id INTEGER NOT NULL REFERENCES pos_opcoes(id) ON DELETE CASCADE,
        atualizado_em INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO pos_opcoes (nome, ordem) VALUES ('Bello''s Club', 0), ('Condado Bar', 1), ('Augusta Haus', 2);
      INSERT OR IGNORE INTO config (chave, valor) VALUES ('chegadaEndereco', '"Condomínio Singolare — Manaus"');
      INSERT OR IGNORE INTO config (chave, valor) VALUES ('chegadaPortaria', '"Diga na portaria que vai para a festa do Victor, na churrasqueira gourmet."');
      INSERT OR IGNORE INTO config (chave, valor) VALUES ('chegadaEstacionamento', '""');
      INSERT OR IGNORE INTO config (chave, valor) VALUES ('chegadaObs', '""');
      INSERT OR IGNORE INTO atividades (id, estado, abre_em, atualizado_em) VALUES ('pos', 'agendada', 1793502000000, 0)
    `,
  },
  {
    nome: 'notificações (web push)',
    sql: `
      CREATE TABLE IF NOT EXISTS push_inscricoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        convidado_id TEXT NOT NULL REFERENCES convidados(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        criado_em INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_push_convidado ON push_inscricoes (convidado_id);
      CREATE TABLE IF NOT EXISTS push_enviados (
        chave TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        corpo TEXT NOT NULL,
        para INTEGER NOT NULL DEFAULT 0,
        entregues INTEGER NOT NULL DEFAULT 0,
        enviado_em INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_push_enviados_quando ON push_enviados (enviado_em)
    `,
  },
  {
    // Rótulo amigável do aparelho, falhas por envio e fila persistente do movimento dos amigos.
    nome: 'notificações: aparelhos, falhas e fila',
    sql: `
      CREATE TABLE IF NOT EXISTS push_fila (
        tipo TEXT PRIMARY KEY,
        n INTEGER NOT NULL DEFAULT 0,
        autores TEXT NOT NULL DEFAULT '[]',
        desde INTEGER,
        ultimo_envio INTEGER NOT NULL DEFAULT 0
      )
    `,
    // ALTER TABLE não tem "IF NOT EXISTS": confere as colunas antes (migração pode rodar de novo em teste).
    async depois(c) {
      const cols = async (t) => new Set((await c.execute(`SELECT name FROM pragma_table_info('${t}')`)).rows.map((r) => r.name));
      if (!(await cols('push_inscricoes')).has('aparelho')) await c.execute('ALTER TABLE push_inscricoes ADD COLUMN aparelho TEXT');
      if (!(await cols('push_enviados')).has('falhas')) await c.execute('ALTER TABLE push_enviados ADD COLUMN falhas INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    nome: 'notificações: registro por aparelho (frequência e auditoria)',
    sql: `
      CREATE TABLE IF NOT EXISTS push_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chave TEXT NOT NULL,
        convidado_id TEXT NOT NULL,
        inscricao_id INTEGER,
        resultado TEXT NOT NULL,
        codigo INTEGER,
        em INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_push_log_pessoa ON push_log (convidado_id, em)
    `,
  },
];
