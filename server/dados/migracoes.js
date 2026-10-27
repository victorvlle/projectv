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
  {
    nome: 'jogos: previsões, maldição e enigmas',
    sql: `
      CREATE TABLE IF NOT EXISTS previsoes_perguntas (
        id TEXT PRIMARY KEY,
        ordem INTEGER NOT NULL,
        texto TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('convidado', 'opcoes')),
        opcoes TEXT NOT NULL DEFAULT '[]',
        resposta TEXT
      );
      CREATE TABLE IF NOT EXISTS previsoes_palpites (
        convidado_id TEXT NOT NULL REFERENCES convidados(id) ON DELETE CASCADE,
        pergunta_id TEXT NOT NULL REFERENCES previsoes_perguntas(id) ON DELETE CASCADE,
        escolha TEXT NOT NULL,
        atualizado_em INTEGER NOT NULL,
        PRIMARY KEY (convidado_id, pergunta_id)
      );
      CREATE TABLE IF NOT EXISTS maldicoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        convidado_id TEXT NOT NULL REFERENCES convidados(id) ON DELETE CASCADE,
        parceiro_id TEXT REFERENCES convidados(id) ON DELETE SET NULL,
        castigo TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'sorteada' CHECK (estado IN ('sorteada', 'cumprida', 'cancelada')),
        origem TEXT NOT NULL,
        chave TEXT NOT NULL UNIQUE,
        sorteada_em INTEGER NOT NULL,
        resolvida_em INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_maldicoes_quando ON maldicoes (sorteada_em);
      CREATE TABLE IF NOT EXISTS enigmas (
        id TEXT PRIMARY KEY,
        ordem INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        pergunta TEXT NOT NULL,
        respostas TEXT NOT NULL,
        dica TEXT NOT NULL DEFAULT '',
        abre_em INTEGER NOT NULL,
        fecha_em INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS enigma_tentativas (
        enigma_id TEXT NOT NULL REFERENCES enigmas(id) ON DELETE CASCADE,
        convidado_id TEXT NOT NULL REFERENCES convidados(id) ON DELETE CASCADE,
        tentativas INTEGER NOT NULL DEFAULT 0,
        acertou_em INTEGER,
        posicao INTEGER,
        PRIMARY KEY (enigma_id, convidado_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pontos_atividade ON pontos_log (atividade)
    `,
    async depois(c) {
      const { PERGUNTAS, ENIGMAS } = require('../jogos/conteudo');
      for (const p of PERGUNTAS) {
        await c.execute({ sql: 'INSERT OR IGNORE INTO previsoes_perguntas (id, ordem, texto, tipo, opcoes) VALUES (?, ?, ?, ?, ?)',
          args: [p.id, p.ordem, p.texto, p.tipo, JSON.stringify(p.opcoes || [])] });
      }
      for (const e of ENIGMAS) {
        await c.execute({ sql: 'INSERT OR IGNORE INTO enigmas (id, ordem, titulo, pergunta, respostas, dica, abre_em, fecha_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          args: [e.id, e.ordem, e.titulo, e.pergunta, JSON.stringify(e.respostas), e.dica, Date.parse(e.abre), Date.parse(e.fecha)] });
      }
    },
  },
  {
    nome: 'enigmas: três por dia (manhã, tarde e noite)',
    sql: 'SELECT 1',
    // Acrescenta os enigmas novos e passa os 3 antigos (meia-noite) para o turno da manhã,
    // só se o admin ainda não tiver mexido neles. Nunca apaga respostas nem pontos.
    async depois(c) {
      const { ENIGMAS } = require('../jogos/conteudo');
      const antigos = { quarta: ['Enigma de quarta', '2026-10-28T00:00:00-04:00'], quinta: ['Enigma de quinta', '2026-10-29T00:00:00-04:00'],
        sexta: ['Enigma de sexta', '2026-10-30T00:00:00-04:00'] };
      for (const e of ENIGMAS) {
        await c.execute({ sql: 'INSERT OR IGNORE INTO enigmas (id, ordem, titulo, pergunta, respostas, dica, abre_em, fecha_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          args: [e.id, e.ordem, e.titulo, e.pergunta, JSON.stringify(e.respostas), e.dica, Date.parse(e.abre), Date.parse(e.fecha)] });
        await c.execute({ sql: 'UPDATE enigmas SET ordem = ? WHERE id = ?', args: [e.ordem, e.id] });
        const velho = antigos[e.id];
        if (velho) {
          await c.execute({ sql: 'UPDATE enigmas SET titulo = ? WHERE id = ? AND titulo = ?', args: [e.titulo, e.id, velho[0]] });
          await c.execute({ sql: 'UPDATE enigmas SET abre_em = ? WHERE id = ? AND abre_em = ?', args: [Date.parse(e.abre), e.id, Date.parse(velho[1])] });
        }
      }
    },
  },
  {
    nome: 'enigmas: filmes de terror (recentes e clássicos)',
    sql: 'SELECT 1',
    // Troca o texto, as respostas e a dica só dos enigmas que o admin ainda não editou.
    async depois(c) {
      const { ENIGMAS } = require('../jogos/conteudo');
      const ANTIGOS = {"quarta": "Tenho rosto, mas não tenho cabeça. Tenho dentes, mas não mordo. Uma noite por ano acendem uma vela dentro de mim e eu sorrio no escuro. Quem sou eu?", "quarta-tarde": "Durmo de dia pendurado de cabeça para baixo e à noite saio para voar. Não sou pássaro e enxergo com os ouvidos. Quem sou eu?", "quarta-noite": "Tenho oito pernas, construo a minha casa com fios e espero o jantar cair nela. Quem sou eu?", "quinta": "Quanto mais você tira de mim, maior eu fico. O coveiro me conhece bem. O que sou eu?", "quinta-tarde": "Não tenho carne nem pele, só ossos. Moro dentro de todo mundo, mas só saio para passear no Halloween. Quem sou eu?", "quinta-noite": "Uso capa, fujo do alho, durmo num caixão e não apareço no espelho. Quem sou eu?", "sexta": "Ando sem pés, falo sem boca, atravesso paredes e assusto quem dorme. Na casa velha, quem você chama quando ouve um barulho e não vê ninguém?", "sexta-tarde": "Borbulho em cima do fogo, a bruxa me mexe com uma colher enorme e tudo o que cai em mim vira poção. O que sou eu?", "sexta-noite": "Apareço inteira uma vez por mês, e quando estou cheia os lobisomens uivam para mim. Quem sou eu?"};
      for (const e of ENIGMAS) {
        if (!ANTIGOS[e.id]) continue;
        await c.execute({ sql: 'UPDATE enigmas SET pergunta = ?, respostas = ?, dica = ? WHERE id = ? AND pergunta = ?',
          args: [e.pergunta, JSON.stringify(e.respostas), e.dica, e.id, ANTIGOS[e.id]] });
      }
    },
  },
  {
    nome: 'enigmas: modo prova (relógio e saída da página) e perguntas mais difíceis',
    sql: 'SELECT 1',
    async depois(c) {
      const cols = new Set((await c.execute("SELECT name FROM pragma_table_info('enigma_tentativas')")).rows.map((r) => r.name));
      if (!cols.has('revelado_em')) await c.execute('ALTER TABLE enigma_tentativas ADD COLUMN revelado_em INTEGER');
      if (!cols.has('saiu_em')) await c.execute('ALTER TABLE enigma_tentativas ADD COLUMN saiu_em INTEGER');
      // Textos mais difíceis, sem dica, só nos enigmas que o admin não editou.
      const { ENIGMAS } = require('../jogos/conteudo');
      const ANTERIORES = {"quarta": "Moro no esgoto de uma cidadezinha do Maine, ofereço balões vermelhos às crianças e volto a cada 27 anos. Um grupo de amigos chamado Clube dos Perdedores decide me enfrentar. Qual é o filme?", "quarta-tarde": "Mississippi, 1932. Dois irmãos gêmeos voltam para casa e abrem um bar de blues numa serraria. A música é tão boa que atrai visitantes que só entram se forem convidados. Qual é o filme de 2025?", "quarta-noite": "Um escritor aceita cuidar de um hotel vazio nas montanhas durante o inverno, com a esposa e o filho. No corredor aparecem duas gêmeas, lá fora há um labirinto de cerca viva e ninguém deve entrar no quarto 237. Qual é o filme?", "quinta": "Quem assiste a uma fita de vídeo estranha recebe um telefonema e passa a ter só sete dias de vida. A menina de cabelo comprido sai do poço… e da televisão. Qual é o filme?", "quinta-tarde": "Numa madrugada, às 2h17, todas as crianças de uma mesma turma saem correndo de casa de braços abertos e desaparecem. Só um aluno fica. Qual é o filme de 2025?", "quinta-noite": "Uma menina de 12 anos muda de comportamento, a cama treme e a voz que sai dela já não é a dela. A mãe, desesperada, procura dois padres. Qual é o clássico de 1973?", "sexta": "Uma universitária tem pesadelos com uma tragédia que a avó escapou décadas atrás e descobre que a Morte voltou para cobrar a família inteira. Qual é o filme de 2025?", "sexta-tarde": "Na noite de 31 de outubro, um homem de macacão e máscara branca, sem expressão, foge do hospício e volta à cidade onde tudo começou, quando ele ainda era criança. A babá Laurie que se cuide. Qual é o clássico de 1978?", "sexta-noite": "Um rapaz tímido compra numa loja de mágica uma varinha que realiza um desejo quando é quebrada. Ele deseja que a amiga o ame mais do que tudo… e o desejo é atendido. Qual é o terror de 2026?"};
      for (const e of ENIGMAS) {
        if (!ANTERIORES[e.id]) continue;
        await c.execute({ sql: 'UPDATE enigmas SET pergunta = ?, respostas = ?, dica = ? WHERE id = ? AND pergunta = ?',
          args: [e.pergunta, JSON.stringify(e.respostas), e.dica, e.id, ANTERIORES[e.id]] });
      }
    },
  },
];
