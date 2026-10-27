// Ajudas comuns dos testes dos jogos.
const assert = require('node:assert/strict');

function criarAjudas(s, admin) {
  let seq = 0;
  async function convidado(nome, { push = false, endpoint = null } = {}) {
    const c = (await s.req('POST', '/api/admin/convidados', { token: admin, corpo: { nome } })).json.criados[0];
    const token = (await s.req('POST', '/api/entrar', { corpo: { codigo: c.codigo } })).json.token;
    assert.ok(token, `entrou: ${nome}`);
    await s.req('PUT', '/api/eu/perfil', { token, corpo: { avatar: 'bruxa' } });
    let sub = null;
    if (push) {
      seq += 1;
      sub = { endpoint: endpoint || `https://fcm.googleapis.com/fcm/send/jogo${seq}-${Date.now()}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } };
      assert.equal((await s.req('POST', '/api/eu/push', { token, corpo: { inscricao: sub } })).status, 200);
    }
    return { ...c, token, sub };
  }
  const liberar = (id, estado = 'liberada') => s.req('PUT', `/api/admin/atividades/${id}`, { token: admin, corpo: { estado } });
  const festaEm = (inicioMs) => s.req('PUT', '/api/admin/festa', { token: admin, corpo: {
    inicio: new Date(inicioMs).toISOString(), fim: new Date(inicioMs + 7 * 3600 * 1000).toISOString() } });
  const pontosDe = async (token) => (await s.req('GET', '/api/ranking', { token })).json.ranking.eu.pontos;
  const idClique = () => `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return { convidado, liberar, festaEm, pontosDe, idClique };
}

module.exports = { criarAjudas };
