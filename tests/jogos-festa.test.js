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

// Leva o cronograma do quiz para um ponto: 'pergunta' k (0 = primeira) ou 'revelacao' k ou 'fim'.
const quizMod = require('../server/dados/quiz');
const festaDados = require('../server/dados/festa');
async function irPara(fase, k = 0) {
  const cfg = await quizMod.config();
  const tempo = cfg.sessao.tempoS * 1000;
  const bloco = tempo + quizMod.REVELA_MS;
  const desde = fase === 'fim' ? quizMod.PREPARO_MS + bloco * cfg.sessao.ids.length + 1000
    : quizMod.PREPARO_MS + k * bloco + (fase === 'pergunta' ? 1000 : tempo + 1000);
  await festaDados.gravar('quiz', { ...cfg, sessao: { ...cfg.sessao, inicioEm: Date.now() - desde } });
}

test('quiz estilo Kahoot: sala, início pelo admin, uma resposta, certa só na revelação, +500 de teste, placar', async () => {
  const q0 = (await festa(victor)).quiz;
  assert.equal(q0.fase, 'sala');
  assert.equal(q0.naSala, false);
  assert.equal((await s.req('POST', '/api/admin/quiz/iniciar', { token: admin })).status, 409, 'sala vazia não começa');
  assert.equal((await s.req('POST', '/api/quiz/entrar', { token: outra.token })).status, 403, 'quem não testa não entra');
  assert.equal((await s.req('POST', '/api/quiz/entrar', { token: victor.token })).status, 200);
  assert.equal((await s.req('POST', '/api/quiz/entrar', { token: victor.token })).status, 200, 'entrar de novo não duplica');
  const t0 = await telao();
  assert.deepEqual(t0.quiz.sala, [{ avatar: 'bruxa', iniciais: 'VT' }]);
  assert.ok(!JSON.stringify(t0.quiz).includes('Victor'), 'na sala o telão mostra só o monstro e as iniciais');

  assert.equal((await s.req('POST', '/api/admin/quiz/iniciar', { token: admin, corpo: { quantas: 3 } })).status, 200);
  assert.equal((await telao()).telao.modo, 'quiz', 'iniciar leva o telão para o quiz');
  assert.equal((await festa(victor)).quiz.fase, 'preparar');
  assert.equal((await s.req('POST', '/api/admin/quiz/iniciar', { token: admin })).status, 409, 'não começa duas vezes');
  assert.ok(!JSON.stringify(await festa(victor)).includes('Samhain'), 'a pergunta não chega antes da hora');

  await irPara('pergunta', 0);
  const fv = await festa(victor);
  assert.equal(fv.quiz.fase, 'pergunta');
  assert.equal(fv.quiz.atual.id, 'q1');
  assert.equal(fv.quiz.total, 3);
  assert.equal(fv.quiz.atual.correta, undefined, 'resposta certa escondida');
  assert.ok(!JSON.stringify(await telao()).includes('"correta"'), 'nem no telão antes de revelar');
  assert.ok(!JSON.stringify(fv).includes('Frankenstein'), 'a próxima pergunta não vaza');

  const responder = (c, id, escolha) => s.req('POST', `/api/quiz/${id}/resposta`, { token: c.token, corpo: { escolha } });
  assert.equal((await responder(victor, 'q1', 9)).status, 400);
  assert.equal((await responder(victor, 'q1', 2)).status, 200); // Irlanda (certa)
  assert.equal((await responder(victor, 'q1', 1)).status, 409, 'só vale uma resposta');
  assert.equal((await responder(lucas, 'q1', 0)).status, 200, 'responder já coloca na sala');
  assert.equal((await responder(lucas, 'q2', 0)).status, 409, 'pergunta que não está valendo');
  assert.equal((await responder(outra, 'q1', 2)).status, 403);
  assert.equal((await telao()).quiz.atual.respostas, 2);

  await irPara('revelacao', 0);
  const fv2 = await festa(victor);
  assert.equal(fv2.quiz.fase, 'revelacao');
  assert.equal(fv2.quiz.atual.correta, 2);
  assert.equal(fv2.quiz.atual.acertei, true);
  assert.equal(fv2.quiz.proxima, true);
  assert.equal(await h.pontosDe(victor.token), 500);
  assert.equal(await h.pontosDe(lucas.token), 0);
  assert.equal((await responder(lucas, 'q1', 2)).status, 409, 'depois do tempo não vale');
  const t = await telao();
  assert.deepEqual(t.quiz.atual.acertaram.map((a) => a.nome), ['Victor Teste']);
  const rOutra = (await s.req('GET', '/api/ranking', { token: outra.token })).json.ranking;
  assert.equal(rOutra.top.find((x) => x.nome === 'Victor Teste').pontos, 0, 'ponto de teste não aparece para quem não testa');

  await irPara('pergunta', 1);
  assert.equal((await festa(lucas)).quiz.atual.id, 'q2', 'troca sozinho para a próxima');
  assert.equal((await responder(lucas, 'q2', 0)).status, 200); // Mary Shelley (certa)
  await irPara('fim');
  const fim = (await festa(lucas)).quiz;
  assert.equal(fim.fase, 'fim');
  assert.equal(fim.acertos, 1);
  assert.deepEqual(fim.placar.map((p) => [p.nome, p.acertos]).sort(), [['Lucas Teste', 1], ['Victor Teste', 1]]);
  assert.equal(await h.pontosDe(lucas.token), 500);
  assert.equal((await telao()).quiz.placar.length, 2);
});

test('quiz: jogado não recomeça sozinho; parar no meio; recomeçar zera respostas, sala e pontos do quiz', async () => {
  // Nova rodada pega as próximas perguntas ainda não jogadas
  assert.equal((await s.req('POST', '/api/admin/quiz/iniciar', { token: admin, corpo: { quantas: 2 } })).status, 200);
  await irPara('pergunta', 0);
  assert.equal((await festa(victor)).quiz.atual.id, 'q4', 'q1 a q3 já foram (2 jogadas + 1 que fechou sem resposta)');
  await s.req('POST', '/api/admin/quiz/encerrar', { token: admin });
  // Editar pergunta já jogada não pode; não jogada pode
  assert.equal((await s.req('PUT', '/api/admin/quiz/q1', { token: admin, corpo: { texto: 'Mudar?', opcoes: ['a', 'b', 'c', 'd'], correta: 0 } })).status, 409);
  assert.equal((await s.req('PUT', '/api/admin/quiz/q9', { token: admin, corpo: { texto: 'Pergunta nova?', opcoes: ['a', 'b', 'c'], correta: 0 } })).status, 400);
  assert.equal((await s.req('POST', '/api/admin/quiz/recomecar', { token: admin })).status, 200);
  assert.equal(await h.pontosDe(victor.token), 0);
  const j = (await adminJogos()).quiz;
  assert.equal(j.sala.length, 0);
  assert.ok(j.perguntas.every((x) => x.reveladaEm == null && x.respostas === 0));
  // Parar no meio: a pergunta em andamento não vale
  await s.req('POST', '/api/quiz/entrar', { token: victor.token });
  await s.req('POST', '/api/admin/quiz/iniciar', { token: admin, corpo: { quantas: 2 } });
  await irPara('pergunta', 0);
  await s.req('POST', '/api/quiz/q1/resposta', { token: victor.token, corpo: { escolha: 2 } });
  assert.equal((await s.req('POST', '/api/admin/quiz/encerrar', { token: admin })).status, 200);
  assert.equal((await festa(victor)).quiz.fase, 'fim');
  assert.equal(await h.pontosDe(victor.token), 0, 'parou antes de revelar: não pontua');
  await s.req('POST', '/api/admin/quiz/recomecar', { token: admin });
  // Deixa uma sessão de teste com ponto para o "apagar dados de teste" limpar depois
  await s.req('POST', '/api/quiz/entrar', { token: victor.token });
  const ini = await s.req('POST', '/api/admin/quiz/iniciar', { token: admin, corpo: { quantas: 1 } });
  await irPara('pergunta', 0);
  const resp = await s.req('POST', '/api/quiz/q1/resposta', { token: victor.token, corpo: { escolha: 2 } });
  await irPara('fim');
  assert.equal(ini.status, 200);
  assert.equal(resp.status, 200);
  assert.equal(await h.pontosDe(victor.token), 500);
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
  assert.ok(j.quiz.perguntas.every((q) => q.reveladaEm == null && q.respostas === 0));
  assert.equal(j.quiz.sala.length, 0);
  assert.equal(j.quiz.fase, 'sala');
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
  assert.equal((await s.req('POST', '/api/quiz/entrar', { token: outra.token })).status, 200);
  await s.req('POST', '/api/admin/quiz/iniciar', { token: admin, corpo: { quantas: 1 } });
  await irPara('pergunta', 0);
  assert.equal((await s.req('POST', '/api/quiz/q1/resposta', { token: outra.token, corpo: { escolha: 2 } })).status, 200);
  await irPara('revelacao', 0);
  await festa(outra);
  const rReal = (await s.req('GET', '/api/ranking', { token: real.token })).json.ranking;
  assert.equal(rReal.top.find((x) => x.nome === 'Convidada Comum').pontos, 500, 'ponto real aparece para todos');
  await h.liberar('quiz', 'bloqueada');
});

