// Modo teste, Quiz Relâmpago, Concurso de Fantasia, Correio das Trevas e "Apagar dados de teste".
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { criarAjudas } = require('./jogos-ajuda');
const banco = require('../server/dados/banco');

let s; let admin; let h;
let victor; let lucas; let outra; let real;
test.before(async () => {
  s = await subir(); admin = await s.tokenAdmin(); h = criarAjudas(s, admin);
  victor = await h.convidado('Victor Teste');
  lucas = await h.convidado('Lucas Teste');
  outra = await h.convidado('Convidada Comum');
  real = await h.convidado('Pontuador Real');
  for (const c of [victor, lucas]) {
    assert.equal((await s.req('PATCH', `/api/admin/convidados/${c.id}`, { token: admin, corpo: { testador: true } })).status, 200);
  }
  // Um ponto real (música) que o "Apagar dados de teste" não pode tocar.
  await s.req('POST', '/api/playlist', { token: real.token, corpo: { titulo: 'Thriller', artista: 'Michael Jackson' } });
});
test.after(async () => { await s.fechar(); });

const festa = async (c) => (await s.req('GET', '/api/festa', { token: c.token })).json;
const adminJogos = async () => (await s.req('GET', '/api/admin/jogos', { token: admin })).json;
const telao = async () => (await s.req('GET', '/api/admin/telao', { token: admin })).json;
const vencerTempo = (id) => banco.rodar('UPDATE quiz_perguntas SET lancada_em = ? WHERE id = ?', [Date.now() - 120000, id]);

test('em teste: só os testadores veem e jogam; para os outros continua com cadeado', async () => {
  for (const id of ['quiz', 'concurso', 'correio']) assert.equal((await h.liberar(id, 'teste')).status, 200);
  const fv = await festa(victor);
  const quizV = fv.atividades.find((a) => a.id === 'quiz');
  assert.equal(quizV.estado, 'liberada');
  assert.equal(quizV.teste, true);
  assert.ok(fv.quiz && fv.quiz.teste === true);
  assert.ok(fv.concurso && fv.correio);

  const fo = await festa(outra);
  const quizO = fo.atividades.find((a) => a.id === 'quiz');
  assert.equal(quizO.estado, 'bloqueada');
  assert.equal(quizO.nome, undefined, 'nome real não vaza');
  assert.equal(fo.quiz, null);
  assert.equal(fo.concurso, null);
  assert.equal(fo.correio, null);
  assert.equal((await s.req('GET', '/api/quiz', { token: outra.token })).status, 403);
  assert.equal((await s.req('POST', '/api/correio', { token: outra.token, corpo: { texto: 'oi oi oi' } })).status, 403);
  assert.equal((await s.req('PUT', '/api/concurso/voto', { token: outra.token, corpo: { candidato: 'x' } })).status, 403);
});

test('quiz: uma resposta só, dentro do tempo; a certa não sai antes de revelar; +500 marcado como teste', async () => {
  assert.equal((await s.req('POST', '/api/admin/quiz/q1/lancar', { token: admin })).status, 200);
  assert.equal((await telao()).telao.modo, 'quiz', 'lançar leva o telão para o quiz');
  // Outra pergunta não pode ser lançada enquanto esta vale
  assert.equal((await s.req('POST', '/api/admin/quiz/q2/lancar', { token: admin })).status, 409);

  const fv = await festa(victor);
  assert.equal(fv.quiz.atual.id, 'q1');
  assert.equal(fv.quiz.atual.fase, 'respondendo');
  assert.equal(fv.quiz.atual.correta, undefined, 'resposta certa escondida');
  assert.ok(!JSON.stringify(await telao()).includes('"correta"'), 'nem no telão antes de revelar');

  const responder = (c, escolha) => s.req('POST', '/api/quiz/q1/resposta', { token: c.token, corpo: { escolha } });
  assert.equal((await responder(victor, 9)).status, 400);
  assert.equal((await responder(victor, 2)).status, 200); // Irlanda (certa)
  assert.equal((await responder(victor, 2)).status, 409, 'só vale uma resposta');
  assert.equal((await responder(lucas, 0)).status, 200); // errada
  assert.equal((await responder(outra, 1)).status, 403, 'quem não testa não responde');
  // Revelar antes do tempo acabar é recusado
  assert.equal((await s.req('POST', '/api/admin/quiz/q1/revelar', { token: admin })).status, 409);

  await vencerTempo('q1');
  const r = await s.req('POST', '/api/admin/quiz/q1/revelar', { token: admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.acertaram, 1);
  assert.equal((await s.req('POST', '/api/admin/quiz/q1/revelar', { token: admin })).json.jaRevelada, true, 'revelar de novo não duplica');
  assert.equal(await h.pontosDe(victor.token), 500);
  assert.equal(await h.pontosDe(lucas.token), 0);
  const fv2 = await festa(victor);
  assert.equal(fv2.quiz.atual.correta, 2);
  assert.equal(fv2.quiz.atual.acertei, true);
  const t = await telao();
  assert.deepEqual(t.quiz.atual.acertaram.map((a) => a.nome), ['Victor Teste']);
  // Ponto de teste: quem não é testador não vê no ranking
  const rOutra = (await s.req('GET', '/api/ranking', { token: outra.token })).json.ranking;
  assert.equal(rOutra.top.find((x) => x.nome === 'Victor Teste').pontos, 0);
});

test('quiz: responder depois do tempo é recusado; cancelar desfaz o lançamento', async () => {
  await s.req('POST', '/api/admin/quiz/q2/lancar', { token: admin });
  await vencerTempo('q2');
  assert.equal((await s.req('POST', '/api/quiz/q2/resposta', { token: lucas.token, corpo: { escolha: 0 } })).status, 409);
  assert.equal((await s.req('POST', '/api/admin/quiz/q2/cancelar', { token: admin })).status, 200);
  const q2 = (await adminJogos()).quiz.perguntas.find((x) => x.id === 'q2');
  assert.equal(q2.fase, 'nao-lancada');
  // Editar só antes de lançar; precisa de 4 opções e da certa
  assert.equal((await s.req('PUT', '/api/admin/quiz/q2', { token: admin, corpo: { texto: 'Pergunta nova?', opcoes: ['a', 'b', 'c'], correta: 0 } })).status, 400);
  assert.equal((await s.req('PUT', '/api/admin/quiz/q2', { token: admin, corpo: { texto: 'Pergunta nova?', opcoes: ['a', 'b', 'c', 'd'], correta: 3 } })).status, 200);
  assert.equal((await s.req('PUT', '/api/admin/quiz/q1', { token: admin, corpo: { texto: 'Mudar?', opcoes: ['a', 'b', 'c', 'd'], correta: 0 } })).status, 409);
});

test('concurso: não vota em si, troca o voto, contagem escondida; empate divide a colocação', async () => {
  const votar = (c, candidato) => s.req('PUT', '/api/concurso/voto', { token: c.token, corpo: { candidato } });
  assert.equal((await votar(victor, 'qualquer')).status, 409, 'votação ainda fechada');
  assert.equal((await s.req('POST', '/api/admin/concurso/abrir', { token: admin })).status, 200);
  const c = (await festa(victor)).concurso;
  const id = (nome) => c.candidatos.find((x) => x.nome === nome).id;
  assert.ok(!JSON.stringify(c).includes(victor.id), 'ids internos não saem');
  assert.equal((await votar(victor, id('Victor Teste'))).status, 400, 'não vale votar em si');
  assert.equal((await votar(victor, id('Convidada Comum'))).status, 200);
  assert.equal((await votar(victor, id('Lucas Teste'))).status, 200, 'trocou o voto');
  assert.equal((await votar(lucas, id('Victor Teste'))).status, 200);
  assert.equal((await festa(victor)).concurso.podio, undefined, 'sem resultado antes de publicar');

  assert.equal((await s.req('POST', '/api/admin/concurso/publicar', { token: admin })).status, 409, 'precisa encerrar antes');
  await s.req('POST', '/api/admin/concurso/encerrar', { token: admin });
  assert.equal((await votar(lucas, id('Convidada Comum'))).status, 409, 'encerrada não aceita voto');
  assert.equal((await s.req('POST', '/api/admin/concurso/publicar', { token: admin })).status, 200);
  const podio = (await festa(lucas)).concurso.podio;
  assert.deepEqual(podio.map((p) => [p.nome, p.posicao, p.pontos]).sort(), [['Lucas Teste', 1, 1000], ['Victor Teste', 1, 1000]]);
  assert.equal(await h.pontosDe(lucas.token), 1000);
  assert.equal(await h.pontosDe(victor.token), 1500);
  assert.equal((await telao()).telao.modo, 'concurso');
  // Publicar de novo (despublicar + publicar) não duplica
  await s.req('POST', '/api/admin/concurso/despublicar', { token: admin });
  await s.req('POST', '/api/admin/concurso/publicar', { token: admin });
  assert.equal(await h.pontosDe(lucas.token), 1000);
});

test('correio: anônimo, com freio, só aprovadas vão ao telão (sem o autor)', async () => {
  const k = (await festa(victor)).correio;
  const para = k.pessoas.find((p) => p.nome === 'Lucas Teste').id;
  assert.ok(!k.pessoas.some((p) => p.nome === 'Victor Teste'), 'não manda carta para si');
  const mandar = (c, texto, p = null) => s.req('POST', '/api/correio', { token: c.token, corpo: { texto, para: p } });
  assert.equal((await mandar(victor, 'oi')).status, 400);
  assert.equal((await mandar(victor, '<img src=x onerror=alert(1)> sua fantasia dá medo', para)).status, 200);
  assert.equal((await mandar(victor, 'outra carta logo em seguida')).status, 429, '1 por minuto');
  assert.equal((await mandar(lucas, 'Carta do Lucas: '.padEnd(400, 'x'))).status, 200);
  const minhas = (await festa(lucas)).correio.minhas;
  assert.equal(minhas[0].texto.length, 140, 'corta em 140');

  assert.equal((await telao()).correio.cartas.length, 0, 'nada vai ao telão sem aprovação');
  const cartas = (await adminJogos()).correio.cartas;
  assert.equal(cartas.length, 2);
  const doVictor = cartas.find((x) => x.autor === 'Victor Teste');
  assert.equal(doVictor.para, 'Lucas Teste');
  assert.equal((await s.req('POST', `/api/admin/correio/${doVictor.id}/aprovar`, { token: admin })).status, 200);
  const t = (await telao()).correio.cartas;
  assert.equal(t.length, 1);
  assert.equal(t[0].para, 'Lucas Teste');
  assert.ok(!JSON.stringify(t).includes('Victor'), 'o telão não sabe quem mandou');
  assert.equal((await festa(victor)).correio.minhas[0].estado, 'aprovada');
});

test('previsões em teste: só testador palpita; +1000 por acerto marcado como teste', async () => {
  await h.liberar('previsoes', 'teste');
  const resp = (c, id, escolha) => s.req('PUT', `/api/previsoes/${id}`, { token: c.token, corpo: { escolha } });
  assert.equal((await resp(outra, 'sobra-bebida', 'destilado')).status, 409);
  assert.equal((await resp(victor, 'sobra-bebida', 'destilado')).status, 200);
  await s.req('POST', '/api/admin/previsoes/encerrar', { token: admin });
  await s.req('PUT', '/api/admin/previsoes/sobra-bebida/resposta', { token: admin, corpo: { resposta: 'destilado' } });
  assert.equal((await s.req('POST', '/api/admin/previsoes/publicar', { token: admin })).status, 200);
  assert.equal(await h.pontosDe(victor.token), 2500);
});

test('maldição em teste: só testadores são sorteados; cumprida vale +500 de teste', async () => {
  await h.liberar('maldicao', 'teste');
  for (let i = 0; i < 4; i++) {
    const r = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
    assert.equal(r.status, 200);
    assert.ok(['Victor Teste', 'Lucas Teste'].includes(r.json.maldicao.nome), r.json.maldicao.nome);
    await s.req('POST', `/api/admin/maldicao/${r.json.maldicao.id}/resolver`, { token: admin, corpo: { estado: i === 0 ? 'cumprida' : 'cancelada' } });
  }
  const total = (await h.pontosDe(victor.token)) + (await h.pontosDe(lucas.token));
  assert.ok(total === 2500 + 1000 + 500 || total === 2500 + 1000 + 1000, `total ${total}`);
});

test('apagar dados de teste: some tudo que foi teste, nada real muda, atividades saem do teste', async () => {
  const pontosReal = await h.pontosDe(real.token);
  assert.equal(pontosReal, 5);
  const r = await s.req('POST', '/api/admin/teste/apagar', { token: admin });
  assert.equal(r.status, 200);
  assert.ok(r.json.pontos >= 4);
  assert.equal(await h.pontosDe(victor.token), 0);
  assert.equal(await h.pontosDe(lucas.token), 0);
  assert.equal(await h.pontosDe(real.token), 5, 'ponto real intacto');
  const j = await adminJogos();
  assert.ok(j.quiz.perguntas.every((q) => q.fase === 'nao-lancada' && q.total === 0));
  assert.equal(j.concurso.estado, 'fechado');
  assert.equal(j.concurso.eleitores, 0);
  assert.equal(j.correio.cartas.length, 0);
  assert.equal(j.maldicao.historico.length, 0);
  assert.equal(j.maldicao.config.ligada, false);
  assert.equal(j.previsoes.estado, 'aguardando');
  assert.ok(j.previsoes.perguntas.every((p) => p.resposta == null), 'respostas oficiais de teste apagadas');
  assert.equal(j.previsoes.participantes, 0);
  const ativs = (await s.req('GET', '/api/admin/estado', { token: admin })).json.atividades;
  assert.ok(ativs.every((a) => a.estado !== 'teste'));
});

test('liberada de verdade: todos jogam e os pontos são reais', async () => {
  await h.liberar('quiz');
  await s.req('POST', '/api/admin/quiz/q3/lancar', { token: admin });
  assert.equal((await s.req('POST', '/api/quiz/q3/resposta', { token: outra.token, corpo: { escolha: 3 } })).status, 200);
  await vencerTempo('q3');
  await s.req('POST', '/api/admin/quiz/q3/revelar', { token: admin });
  const rReal = (await s.req('GET', '/api/ranking', { token: real.token })).json.ranking;
  assert.equal(rReal.top.find((x) => x.nome === 'Convidada Comum').pontos, 500, 'ponto real aparece para todos');
  await h.liberar('quiz', 'bloqueada');
});
