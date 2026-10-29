// Previsões: registro, alteração, privacidade, encerramento, resultados, pontos e ranking.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { criarAjudas } = require('./jogos-ajuda');

let s; let admin; let h;
test.before(async () => {
  s = await subir(); admin = await s.tokenAdmin(); h = criarAjudas(s, admin);
  await h.festaEm(Date.now() + 3 * 24 * 3600 * 1000);
});
test.after(async () => { await s.fechar(); });

const prev = async (token) => (await s.req('GET', '/api/previsoes', { token })).json.previsoes;
const responder = (token, id, escolha) => s.req('PUT', `/api/previsoes/${id}`, { token, corpo: { escolha } });

let ana; let beto; let caio;
test('antes de abrir: perguntas visíveis, resposta recusada', async () => {
  ana = await h.convidado('Ana'); beto = await h.convidado('Beto'); caio = await h.convidado('Caio');
  await h.liberar('previsoes', 'bloqueada');
  const p = await prev(ana.token);
  assert.equal(p.estado, 'aguardando');
  assert.equal(p.perguntas.length, 10);
  assert.equal((await responder(ana.token, 'longnecks', '1-5')).status, 409);
});

test('aberta: responder, alterar, desmarcar e validar escolhas', async () => {
  await h.liberar('previsoes');
  const p = await prev(ana.token);
  assert.equal(p.estado, 'aberta');
  const betoApelido = p.pessoas.find((x) => x.nome === 'Beto').id;
  assert.ok(!p.pessoas.some((x) => x.id === beto.id), 'o id interno dos outros não sai');
  assert.equal((await responder(ana.token, 'longnecks', '1-5')).status, 200);
  assert.equal((await responder(ana.token, 'longnecks', 'mais-10')).status, 200); // alterou
  assert.equal((await responder(ana.token, 'rei-trevas', betoApelido)).status, 200);
  assert.equal((await responder(ana.token, 'sem-fantasia', 'sim')).status, 200);
  assert.equal((await responder(ana.token, 'destino-pos', 'condado')).status, 200);
  assert.equal((await responder(ana.token, 'destino-pos', null)).status, 200); // desmarcou
  const depois = await prev(ana.token);
  assert.equal(depois.respondidas, 3);
  assert.equal(depois.perguntas.find((x) => x.id === 'longnecks').minha, 'mais-10');
  assert.equal(depois.perguntas.find((x) => x.id === 'rei-trevas').minhaNome, 'Beto');
  // Inválidos
  assert.equal((await responder(ana.token, 'longnecks', '999')).status, 400);
  assert.equal((await responder(ana.token, 'rei-trevas', 'p000000000000')).status, 400);
  assert.equal((await responder(ana.token, 'rei-trevas', beto.id)).status, 400, 'id interno não vale como escolha');
  assert.equal((await responder(ana.token, 'nao-existe', 'sim')).status, 404);
  assert.equal((await s.req('PUT', '/api/previsoes/longnecks', { corpo: { escolha: 'nenhuma' } })).status, 401);
});

test('privacidade: ninguém vê o palpite dos outros nem contagem enquanto está aberta', async () => {
  await responder(beto.token, 'longnecks', 'nenhuma');
  const p = await prev(beto.token);
  const texto = JSON.stringify(p);
  for (const q of p.perguntas) {
    assert.deepEqual(Object.keys(q).sort(), ['id', 'minha', 'minhaNome', 'opcoes', 'ordem', 'texto', 'tipo'], 'só o próprio palpite');
  }
  assert.equal(p.perguntas.find((x) => x.id === 'longnecks').minha, 'nenhuma');
  assert.ok(!/"votos"|"n":|"resposta"/.test(texto));
  assert.equal(p.perguntas.find((x) => x.id === 'longnecks').resposta, undefined);
  const telao = (await s.req('GET', '/api/admin/telao', { token: admin })).json.previsao;
  assert.equal(telao.estado, 'aberta');
  assert.equal(telao.votos, undefined, 'nem o telão mostra votos antes de fechar');
});

test('encerrar: ninguém muda mais; publicar exige estar encerrada', async () => {
  const caioApelido = (await prev(caio.token)).pessoas.find((x) => x.nome === 'Beto').id;
  await responder(caio.token, 'rei-trevas', caioApelido);
  await responder(caio.token, 'sem-fantasia', 'nao');
  assert.equal((await s.req('POST', '/api/admin/previsoes/publicar', { token: admin })).status, 409);
  assert.equal((await s.req('POST', '/api/admin/previsoes/encerrar', { token: admin })).status, 200);
  assert.equal((await prev(ana.token)).estado, 'encerrada');
  assert.equal((await responder(ana.token, 'longnecks', 'nenhuma')).status, 409);
  assert.equal((await s.req('POST', '/api/previsoes/encerrar', { token: ana.token })).status, 404, 'convidado não encerra');
});

test('resultados: pontos certos, uma vez só (publicar repetido e ao mesmo tempo), ranking atualizado', async () => {
  const set = (id, resposta) => s.req('PUT', `/api/admin/previsoes/${id}/resposta`, { token: admin, corpo: { resposta } });
  assert.equal((await set('longnecks', 'mais-10')).status, 200);
  assert.equal((await set('rei-trevas', beto.id)).status, 200);
  assert.equal((await set('sem-fantasia', 'sim')).status, 200);
  assert.equal((await set('longnecks', 'xx')).status, 400);
  const pubs = await Promise.all([1, 2, 3].map(() => s.req('POST', '/api/admin/previsoes/publicar', { token: admin })));
  assert.ok(pubs.every((r) => r.status === 200));
  assert.equal(await h.pontosDe(ana.token), 3000); // longnecks + rei + sem-fantasia
  assert.equal(await h.pontosDe(caio.token), 1000); // rei
  assert.equal(await h.pontosDe(beto.token), 0);
  await s.req('POST', '/api/admin/previsoes/publicar', { token: admin });
  assert.equal(await h.pontosDe(ana.token), 3000, 'publicar de novo não duplica');
  const p = await prev(ana.token);
  assert.equal(p.estado, 'publicada');
  assert.equal(p.acertos, 3);
  assert.equal(p.perguntas.find((x) => x.id === 'rei-trevas').respostaNome, 'Beto');
  const r = (await s.req('GET', '/api/ranking', { token: beto.token })).json.ranking;
  assert.deepEqual(r.top.slice(0, 2).map((x) => [x.nome, x.pontos, x.posicao]), [['Ana', 3000, 1], ['Caio', 1000, 2]]);
  assert.equal(r.eu.nome, 'Beto');
  assert.ok(!JSON.stringify(r).includes(ana.id), 'ranking não expõe ids');
});

test('corrigir uma resposta depois de publicar recalcula; despublicar tira os pontos', async () => {
  await s.req('PUT', '/api/admin/previsoes/sem-fantasia/resposta', { token: admin, corpo: { resposta: 'nao' } });
  assert.equal(await h.pontosDe(ana.token), 2000);
  assert.equal(await h.pontosDe(caio.token), 2000);
  const t = (await s.req('GET', '/api/admin/telao', { token: admin })).json.previsao;
  assert.ok(Array.isArray(t.votos));
  await s.req('PUT', '/api/admin/telao', { token: admin, corpo: { modo: 'previsoes', previsao: 9 } });
  const t2 = (await s.req('GET', '/api/admin/telao', { token: admin })).json;
  assert.equal(t2.telao.modo, 'previsoes');
  assert.equal(t2.previsao.texto, 'Alguém vai chegar sem fantasia?');
  assert.equal(t2.previsao.resposta, 'Não');
  assert.deepEqual(t2.previsao.acertaram.map((x) => x.nome).sort(), ['Caio']);
  await s.req('POST', '/api/admin/previsoes/despublicar', { token: admin });
  assert.equal(await h.pontosDe(ana.token), 0);
  assert.equal((await s.req('GET', '/api/admin/jogos', { token: admin })).json.previsoes.estado, 'encerrada');
});
