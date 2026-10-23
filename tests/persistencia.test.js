// Reinício real do servidor (processo novo) com o mesmo arquivo de banco:
// convidados, perfil, configurações e sessões precisam sobreviver.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-persist-'));
const arquivo = path.join(pasta, 'projectv.db');
const PORTA = 3900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORTA}`;
const env = { ...process.env, PORT: String(PORTA), BANCO_CAMINHO: arquivo, ADMIN_SEGREDO: 'persist-123', SESSAO_SEGREDO: 'fixo', TURSO_URL: '' };

function iniciar() {
  const p = spawn(process.execPath, ['server/index.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (d) => { log += d; });
  p.stderr.on('data', (d) => { log += d; });
  p.log = () => log;
  return p;
}

async function prontoEm(ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try { if ((await fetch(`${base}/saude`)).ok) return; } catch (_) { /* subindo */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('servidor não subiu');
}

const parar = (p) => new Promise((r) => { p.once('exit', r); p.kill('SIGTERM'); });

async function req(metodo, caminho, token, corpo) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

test('dados e sessões sobrevivem a um reinício do servidor', async () => {
  let p = iniciar();
  await prontoEm();
  const admin = (await req('POST', '/api/admin/entrar', null, { senha: 'persist-123' })).json.token;
  const c = (await req('POST', '/api/admin/convidados', admin, { nome: 'Persistente' })).json.criados[0];
  const t = (await req('POST', '/api/entrar', null, { codigo: c.codigo })).json.token;
  await req('PUT', '/api/eu/perfil', t, { apelido: 'Imortal', avatar: 'zumbi' });
  await req('PUT', '/api/admin/festa', admin, { local: 'Cripta' });
  await req('PUT', '/api/admin/atividades/maldicao', admin, { estado: 'liberada' });
  await parar(p);

  p = iniciar();
  await prontoEm();
  try {
    // Migração não roda de novo no segundo boot
    assert.ok(!/migração 0 -> 1/.test(p.log()), 'migração repetida no reinício');
    const eu = await req('GET', '/api/eu', t);
    assert.equal(eu.status, 200, 'sessão do convidado caiu no reinício');
    assert.equal(eu.json.eu.apelido, 'Imortal');
    const f = await req('GET', '/api/festa', t);
    assert.equal(f.json.festa.local, 'Cripta');
    assert.equal(f.json.atividades.find((a) => a.id === 'maldicao').estado, 'liberada');
    assert.equal((await req('GET', '/api/admin/estado', admin)).status, 200, 'sessão de admin caiu no reinício');
  } finally {
    await parar(p);
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});
