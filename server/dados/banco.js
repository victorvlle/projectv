// Única porta de entrada para o banco de dados (padrão herdado do Bar Bestial).
//
// ONDE O BANCO MORA, nesta ordem:
//   1. TURSO_URL (+ TURSO_TOKEN) -> SQLite hospedado no Turso (produção no Render free,
//      cujo disco é apagado a cada deploy/reinício/hibernação)
//   2. BANCO_CAMINHO             -> arquivo local (desenvolvimento, ou disco persistente
//      do Render Starter, ex.: /var/data/projectv.db)
//   3. data/projectv.db          -> padrão local
// Nos testes, BANCO_CAMINHO=':memory:' mantém tudo em memória.
//
// Nenhum outro arquivo conhece o cliente do banco: o resto do código usa
// um / tudo / rodar / transacao.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const MIGRACOES = require('./migracoes');

const CAMINHO_PADRAO = path.join(__dirname, '..', '..', 'data', 'projectv.db');

let db = null;

function enderecoDoBanco() {
  const remoto = (process.env.TURSO_URL || '').trim();
  if (remoto) return { url: remoto, authToken: (process.env.TURSO_TOKEN || '').trim() || undefined };

  const caminho = process.env.BANCO_CAMINHO || CAMINHO_PADRAO;
  // ':memory:' cru dá um banco vazio por conexão; transações abrem outra conexão.
  if (caminho === ':memory:') return { url: 'file::memory:?cache=shared' };
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  return { url: `file:${caminho}` };
}

function ondeEsta() {
  if ((process.env.TURSO_URL || '').trim()) return 'turso';
  return process.env.BANCO_CAMINHO === ':memory:' ? 'memoria' : 'arquivo';
}

async function abrir(config = enderecoDoBanco()) {
  if (db) return db;
  db = createClient(config);
  try {
    await db.execute('PRAGMA foreign_keys = ON');
  } catch (erro) {
    console.log('[banco] PRAGMA recusado (normal no Turso):', erro.message);
  }
  if (ondeEsta() === 'arquivo') {
    // WAL: leituras não bloqueiam escritas quando muita gente vota ao mesmo tempo.
    try { await db.execute('PRAGMA journal_mode = WAL'); } catch (_) { /* opcional */ }
    try { await db.execute('PRAGMA busy_timeout = 5000'); } catch (_) { /* opcional */ }
  }
  await migrar(db);
  return db;
}

async function fechar() {
  if (db) { db.close(); db = null; }
}

function cliente() {
  if (!db) throw new Error('banco ainda não aberto - chame abrir() na subida do servidor');
  return db;
}

async function um(sql, args = []) {
  const r = await cliente().execute({ sql, args });
  return r.rows[0] || null;
}

async function tudo(sql, args = []) {
  const r = await cliente().execute({ sql, args });
  return r.rows;
}

function rodar(sql, args = []) {
  return cliente().execute({ sql, args });
}

// Tudo ou nada. `acao` recebe um objeto com execute({sql,args}).
async function transacao(acao) {
  const tx = await cliente().transaction('write');
  try {
    const saida = await acao(tx);
    await tx.commit();
    return saida;
  } catch (erro) {
    await tx.rollback().catch(() => {});
    throw erro;
  }
}

// Lote atômico de comandos (mais rápido que transação interativa no Turso).
function lote(comandos) {
  return cliente().batch(comandos, 'write');
}

// ---------------------------------------------------------------- migrações
// A versão do formato fica na tabela `esquema` (o Turso recusa PRAGMA user_version).
// Cada degrau roda uma vez; reiniciar não repete nada; nenhum degrau apaga dados.
async function versaoDoEsquema(c) {
  await c.execute('CREATE TABLE IF NOT EXISTS esquema (versao INTEGER NOT NULL)');
  const r = await c.execute('SELECT versao FROM esquema LIMIT 1');
  if (!r.rows.length) {
    await c.execute('INSERT INTO esquema (versao) VALUES (0)');
    return 0;
  }
  return Number(r.rows[0].versao);
}

async function migrar(c) {
  let versao = await versaoDoEsquema(c);
  for (let alvo = versao + 1; alvo <= MIGRACOES.length; alvo++) {
    const degrau = MIGRACOES[alvo - 1];
    const comandos = degrau.sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sql) => ({ sql, args: [] }));
    comandos.push({ sql: 'UPDATE esquema SET versao = ?', args: [alvo] });
    await c.batch(comandos, 'write');
    if (degrau.depois) await degrau.depois(c);
    console.log(`[banco] migração ${alvo - 1} -> ${alvo}: ${degrau.nome}`);
    versao = alvo;
  }
  return versao;
}

module.exports = { abrir, fechar, um, tudo, rodar, transacao, lote, ondeEsta, versaoAtual: () => MIGRACOES.length };
