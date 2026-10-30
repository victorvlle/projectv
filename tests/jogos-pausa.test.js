// Regra geral: a Maldição pausa os jogos com relógio (Quiz, Corrida) e eles voltam de onde pararam.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { criarAjudas } = require('./jogos-ajuda');
const festa = require('../server/dados/festa');
const quiz = require('../server/dados/quiz');
const corrida = require('../server/dados/corrida');
const pausa = require('../server/dados/pausa');
const banco = require('../server/dados/banco');

let s; let admin; let h; let a; let b;
test.before(async () => {
  s = await subir(); admin = await s.tokenAdmin(); h = criarAjudas(s, admin);
  a = await h.convidado('Ana Pausa'); b = await h.convidado('Beto Pausa');
});
test.after(async () => { await s.fechar(); });

const sortear = () => s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
const quizDe = async (c) => (await s.req('GET', '/api/quiz', { token: c.token })).json.quiz;

test('quiz: a Maldição pausa a pergunta (ninguém responde), e ela volta com o mesmo tempo que faltava', async () => {
  for (const id of ['quiz', 'maldicao']) await h.liberar(id);
  await s.req('POST', '/api/quiz/entrar', { token: a.token });
  assert.equal((await s.req('POST', '/api/admin/quiz/iniciar', { token: admin, corpo: { quantas: 2 } })).status, 200);
  // Leva o quiz para o meio da 1ª pergunta: faltando 8 s
  const cfg = await quiz.config();
  const tempo = cfg.sessao.tempoS * 1000;
  await festa.gravar('quiz', { ...cfg, sessao: { ...cfg.sessao, inicioEm: Date.now() - quiz.PREPARO_MS - (tempo - 8000) } });
  const antes = await quizDe(a);
  assert.equal(antes.fase, 'pergunta');
  const restaAntes = antes.fimEm - Date.now();

  assert.equal((await sortear()).status, 200);
  const p = await pausa.ler();
  assert.ok(p && p.quiz, 'pausou o quiz');
  const durante = await quizDe(a);
  assert.equal(durante.pausado, true);
  assert.ok(Math.abs(durante.restaMs - restaAntes) < 1500, `faltavam ~${restaAntes} ms, pausado com ${durante.restaMs}`);
  const r = await s.req('POST', `/api/quiz/${durante.atual.id}/resposta`, { token: a.token, corpo: { escolha: 0 } });
  assert.equal(r.status, 409, 'pausado: não responde');

  // Simula que a pausa começou há 60 s (tudo 60 s mais cedo) e acabou agora
  const c2 = await quiz.config();
  await festa.gravar('quiz', { ...c2, sessao: { ...c2.sessao, inicioEm: c2.sessao.inicioEm - 60000 } });
  await festa.gravar('pausa', { ...p, desde: p.desde - 60000, ate: Date.now() - 10, quiz: { inicioEm: c2.sessao.inicioEm - 60000 } });
  const depois = await quizDe(a);
  assert.equal(depois.pausado, false);
  assert.equal(depois.fase, 'pergunta', 'continua na mesma pergunta');
  const restaDepois = depois.fimEm - Date.now();
  assert.ok(Math.abs(restaDepois - restaAntes) < 2500, `faltavam ${restaAntes} ms, voltou com ${restaDepois} ms`);
  assert.equal(await pausa.ler(), null);
  assert.equal((await s.req('POST', `/api/quiz/${depois.atual.id}/resposta`, { token: a.token, corpo: { escolha: 0 } })).status, 200);
  await s.req('POST', '/api/admin/quiz/encerrar', { token: admin });
});

test('corrida: pausa no meio, não termina durante a pausa, volta e termina no tempo certo', async () => {
  await h.liberar('corrida');
  await s.req('POST', '/api/admin/corrida/apostas', { token: admin });
  await s.req('PUT', '/api/corrida/aposta', { token: b.token, corpo: { naipe: 'copas' } });
  assert.equal((await s.req('POST', '/api/admin/corrida/largar', { token: admin })).status, 200);
  const cfg = await corrida.config();
  const total = corrida.PREPARO_MS + corrida.duracaoDe(cfg) + 1500;
  // Faltando 10 s para acabar
  await festa.gravar('corrida', { ...cfg, inicioEm: Date.now() - (total - 10000) });
  assert.equal((await sortear()).status, 200);
  const p = await pausa.ler();
  assert.ok(p && p.corrida, 'pausou a corrida');
  const tel = (await s.req('GET', '/api/admin/telao', { token: admin })).json.corrida;
  assert.ok(tel.pausadaEm, 'telão recebe o ponto onde congelar');
  // Simula que a pausa começou há 30 s (mais que os 10 s que faltavam): pausada, não termina
  const cc = await corrida.config();
  await festa.gravar('corrida', { ...cc, inicioEm: cc.inicioEm - 30000 });
  await festa.gravar('pausa', { ...p, desde: p.desde - 30000, corrida: { ...p.corrida, inicioEm: cc.inicioEm - 30000 } });
  await s.req('GET', '/api/admin/telao', { token: admin });
  assert.equal((await corrida.config()).estado, 'correndo');
  // Pausa acabou agora: ainda faltam ~10 s (não termina na hora)
  await festa.gravar('pausa', { ...(await pausa.ler()), ate: Date.now() - 10 });
  await s.req('GET', '/api/admin/telao', { token: admin });
  const c2 = await corrida.config();
  assert.equal(c2.estado, 'correndo');
  const falta = c2.inicioEm + total - Date.now();
  assert.ok(falta > 7000 && falta < 12000, `faltavam ~10 s, faltam ${falta} ms`);
});

test('Maldição sem jogo correndo não pausa nada; confirmar a Maldição encerra a pausa logo', async () => {
  await banco.rodar("DELETE FROM config WHERE chave = 'pausa'");
  await festa.gravar('corrida', { rodada: 9, estado: 'fim' });
  assert.equal((await sortear()).status, 200);
  assert.equal(await pausa.ler(), null, 'nada correndo: não pausa');
  // Com corrida correndo, confirmar a maldição encurta a pausa para ~5 s
  await festa.gravar('corrida', { rodada: 10, estado: 'apostas' });
  await s.req('PUT', '/api/corrida/aposta', { token: b.token, corpo: { naipe: 'paus' } });
  await s.req('POST', '/api/admin/corrida/largar', { token: admin });
  const r = await sortear();
  const p = await pausa.ler();
  assert.ok(p);
  await s.req('POST', `/api/admin/maldicao/${r.json.maldicao.id}/resolver`, { token: admin, corpo: { estado: 'cumprida' } });
  await new Promise((ok) => setTimeout(ok, 100));
  const p2 = await pausa.ler();
  assert.ok(p2.ate <= Date.now() + 5200, 'termina 5 s depois de confirmar');
});
