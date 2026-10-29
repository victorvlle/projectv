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
  assert.equal((await responder(ana.token, 'sobra-bebida', 'cerveja')).status, 409);
});

test('aberta: responder, alterar, desmarcar e validar escolhas', async () => {
  await h.liberar('previsoes');
  const p = await prev(ana.token);
  assert.equal(p.estado, 'aberta');
  const betoApelido = p.pessoas.find((x) => x.nome === 'Beto').id;
  assert.ok(!p.pessoas.some((x) => x.id === beto.id), 'o id interno dos outros não sai');
  assert.equal((await responder(ana.token, 'sobra-bebida', 'cerveja')).status, 200);
  assert.equal((await responder(ana.token, 'sobra-bebida', 'nada')).status, 200); // alterou
  assert.equal((await responder(ana.token, 'da-pt', betoApelido)).status, 200);
  assert.equal((await responder(ana.token, 'sem-fantasia', 'sim')).status, 200);
  assert.equal((await responder(ana.token, 'chuva', 'sim')).status, 200);
  assert.equal((await responder(ana.token, 'chuva', null)).status, 200); // desmarcou
  const depois = await prev(ana.token);
  assert.equal(depois.respondidas, 3);
  assert.equal(depois.perguntas.find((x) => x.id === 'sobra-bebida').minha, 'nada');
  assert.equal(depois.perguntas.find((x) => x.id === 'da-pt').minhaNome, 'Beto');
  // Inválidos
  assert.equal((await responder(ana.token, 'sobra-bebida', '999')).status, 400);
  assert.equal((await responder(ana.token, 'da-pt', 'p000000000000')).status, 400);
  assert.equal((await responder(ana.token, 'da-pt', beto.id)).status, 400, 'id interno não vale como escolha');
  assert.equal((await responder(ana.token, 'nao-existe', 'sim')).status, 404);
  assert.equal((await s.req('PUT', '/api/previsoes/sobra-bebida', { corpo: { escolha: 'destilado' } })).status, 401);
});

test('lista de pessoas tem todos os cadastrados (mesmo quem não entrou); perguntas revisadas', async () => {
  const c = (await s.req('POST', '/api/admin/convidados', { token: admin, corpo: { nome: 'Nunca Entrou' } })).json.criados[0];
  const p = await prev(ana.token);
  const quem = p.pessoas.find((x) => x.nome === 'Nunca Entrou');
  assert.ok(quem, 'quem não entrou também aparece');
  assert.equal(quem.avatar, null);
  assert.equal((await responder(beto.token, 'da-pt', quem.id)).status, 200);
  await responder(beto.token, 'da-pt', null);
  const textos = p.perguntas.map((q) => q.texto).join(' | ');
  assert.ok(textos.includes('Quem vai dar PT?') && textos.includes('O que vai sobrar de bebida?'));
  assert.ok(!/concurso|maldi|mural|correio|trevas|pós/i.test(textos), textos);
  await s.req('PATCH', `/api/admin/convidados/${c.id}`, { token: admin, corpo: { ativo: false } });
});

test('enviar previsões: trava as escolhas, mas a pessoa continua vendo', async () => {
  const dani = await h.convidado('Dani');
  assert.equal((await s.req('POST', '/api/previsoes/enviar', { token: dani.token })).status, 400, 'precisa responder pelo menos uma');
  await responder(dani.token, 'chuva', 'sim');
  const envios = await Promise.all([1, 2].map(() => s.req('POST', '/api/previsoes/enviar', { token: dani.token })));
  assert.ok(envios.every((r) => r.status === 200), 'enviar duas vezes não quebra');
  const p = await prev(dani.token);
  assert.equal(p.enviado, true);
  assert.ok(p.enviadoEm > 0);
  assert.equal(p.perguntas.find((x) => x.id === 'chuva').minha, 'sim', 'continua vendo a escolha');
  assert.equal((await responder(dani.token, 'chuva', 'nao')).status, 409);
  assert.equal((await responder(dani.token, 'sem-fantasia', 'sim')).status, 409);
  assert.equal((await prev(ana.token)).enviado, false, 'o envio é de cada um');
  assert.equal((await s.req('GET', '/api/admin/jogos', { token: admin })).json.previsoes.enviaram, 1);
});

test('privacidade: ninguém vê o palpite dos outros nem contagem enquanto está aberta', async () => {
  await responder(beto.token, 'sobra-bebida', 'destilado');
  const p = await prev(beto.token);
  const texto = JSON.stringify(p);
  for (const q of p.perguntas) {
    assert.deepEqual(Object.keys(q).sort(), ['id', 'minha', 'minhaNome', 'opcoes', 'ordem', 'texto', 'tipo'], 'só o próprio palpite');
  }
  assert.equal(p.perguntas.find((x) => x.id === 'sobra-bebida').minha, 'destilado');
  assert.ok(!/"votos"|"n":|"resposta"/.test(texto));
  assert.equal(p.perguntas.find((x) => x.id === 'sobra-bebida').resposta, undefined);
  const telao = (await s.req('GET', '/api/admin/telao', { token: admin })).json.previsao;
  assert.equal(telao.estado, 'aberta');
  assert.equal(telao.votos, undefined, 'nem o telão mostra votos antes de fechar');
});

test('encerrar: ninguém muda mais; publicar exige estar encerrada', async () => {
  const caioApelido = (await prev(caio.token)).pessoas.find((x) => x.nome === 'Beto').id;
  await responder(caio.token, 'da-pt', caioApelido);
  await responder(caio.token, 'sem-fantasia', 'nao');
  assert.equal((await s.req('POST', '/api/admin/previsoes/publicar', { token: admin })).status, 409);
  assert.equal((await s.req('POST', '/api/admin/previsoes/encerrar', { token: admin })).status, 200);
  assert.equal((await prev(ana.token)).estado, 'encerrada');
  assert.equal((await responder(ana.token, 'sobra-bebida', 'destilado')).status, 409);
  assert.equal((await s.req('POST', '/api/previsoes/encerrar', { token: ana.token })).status, 404, 'convidado não encerra');
});

test('resultados: pontos certos, uma vez só (publicar repetido e ao mesmo tempo), ranking atualizado', async () => {
  const set = (id, resposta) => s.req('PUT', `/api/admin/previsoes/${id}/resposta`, { token: admin, corpo: { resposta } });
  assert.equal((await set('sobra-bebida', 'nada')).status, 200);
  assert.equal((await set('da-pt', beto.id)).status, 200);
  assert.equal((await set('sem-fantasia', 'sim')).status, 200);
  assert.equal((await set('sobra-bebida', 'xx')).status, 400);
  const pubs = await Promise.all([1, 2, 3].map(() => s.req('POST', '/api/admin/previsoes/publicar', { token: admin })));
  assert.ok(pubs.every((r) => r.status === 200));
  assert.equal(await h.pontosDe(ana.token), 3000); // sobra-bebida + da-pt + sem-fantasia
  assert.equal(await h.pontosDe(caio.token), 1000); // rei
  assert.equal(await h.pontosDe(beto.token), 0);
  await s.req('POST', '/api/admin/previsoes/publicar', { token: admin });
  assert.equal(await h.pontosDe(ana.token), 3000, 'publicar de novo não duplica');
  const p = await prev(ana.token);
  assert.equal(p.estado, 'publicada');
  assert.equal(p.acertos, 3);
  assert.equal(p.perguntas.find((x) => x.id === 'da-pt').respostaNome, 'Beto');
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
