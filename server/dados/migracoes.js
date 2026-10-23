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
];
