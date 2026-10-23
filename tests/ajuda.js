// Sobe um servidor de verdade (porta aleatória, banco em memória) para os testes.
process.env.BANCO_CAMINHO = process.env.BANCO_CAMINHO || ':memory:';
process.env.ADMIN_SEGREDO = process.env.ADMIN_SEGREDO ?? 'senha-de-teste-123';
process.env.SESSAO_SEGREDO = 'segredo-de-teste';

const banco = require('../server/dados/banco');
const { criarApp } = require('../server/app');
const { io: cliente } = require('socket.io-client');

async function subir() {
  await banco.abrir();
  const { server, io } = criarApp();
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function req(metodo, caminho, { token, corpo, cru } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    if (cru) return r;
    let json = null;
    try { json = await r.json(); } catch (_) { /* sem corpo */ }
    return { status: r.status, json };
  }

  async function tokenAdmin() {
    const r = await req('POST', '/api/admin/entrar', { corpo: { senha: process.env.ADMIN_SEGREDO } });
    return r.json.token;
  }

  function conectar(auth) {
    return new Promise((resolve, reject) => {
      const s = cliente(base, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
      s.once('connect', () => resolve(s));
      s.once('connect_error', (e) => { s.close(); reject(e); });
    });
  }

  async function fechar() {
    io.close();
    await new Promise((r) => server.close(r));
    await banco.fechar();
  }

  return { base, req, tokenAdmin, conectar, fechar };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function proximoEvento(socket, evento, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`evento ${evento} não chegou`)), ms);
    socket.once(evento, (d) => { clearTimeout(t); resolve(d); });
  });
}

module.exports = { subir, esperar, proximoEvento };
