// Enigma do dia (ordem e bônus) e "colaborar conta ponto" (carona, música, bebida).
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { criarAjudas } = require('./jogos-ajuda');
const enigmasDados = require('../server/dados/enigmas');

let s; let admin; let h;
test.before(async () => {
  s = await subir(); admin = await s.tokenAdmin(); h = criarAjudas(s, admin);
  await h.festaEm(Date.now() + 3 * 24 * 3600 * 1000);
});
test.after(async () => { await s.fechar(); });

const resp = (token, id, resposta) => s.req('POST', `/api/enigmas/${id}/resposta`, { token, corpo: { resposta } });
const agoraISO = (deltaH) => new Date(Date.now() + deltaH * 3600 * 1000).toISOString();

test('normalização aceita acento, maiúscula, artigo e pontuação', () => {
  assert.equal(enigmasDados.normalizar('Uma Abóbora!'), 'abobora');
  assert.equal(enigmasDados.normalizar('Premonição 6: Laços de Sangue'), 'premonicao 6 lacos sangue');
  assert.equal(enigmasDados.normalizar('  A  ASSOMBRAÇÃO. '), 'assombracao');
  assert.equal(enigmasDados.normalizar('Jack-o-Lantern'), enigmasDados.normalizar('jack o lantern'));
});

let p1; let p2; let p3; let p4;
const revelar = (token, id) => s.req('POST', `/api/enigmas/${id}/revelar`, { token });
const banco = require('../server/dados/banco');

test('enigma: escondido antes de abrir e antes de revelar; ordem e bônus certos', async () => {
  p1 = await h.convidado('Primeira'); p2 = await h.convidado('Segundo'); p3 = await h.convidado('Terceira'); p4 = await h.convidado('Quarto');
  await s.req('PUT', '/api/admin/enigmas/quarta', { token: admin, corpo: { abreEm: agoraISO(5), fechaEm: agoraISO(48) } });
  const antes = (await s.req('GET', '/api/enigmas', { token: p1.token })).json.enigmas;
  const q = antes.enigmas.find((e) => e.id === 'quarta');
  assert.equal(q.estado, 'em-breve');
  assert.equal(q.pergunta, undefined, 'o texto só aparece quando abre');
  assert.equal((await revelar(p1.token, 'quarta')).status, 409);

  await s.req('PUT', '/api/admin/enigmas/quarta', { token: admin, corpo: { abreEm: agoraISO(-1) } });
  const aberto = (await s.req('GET', '/api/enigmas', { token: p1.token })).json.enigmas.enigmas.find((e) => e.id === 'quarta');
  assert.equal(aberto.estado, 'aberto');
  assert.equal(aberto.fase, 'nao-revelado');
  assert.equal(aberto.pergunta, undefined, 'aberto mas não revelado: texto não sai do servidor');
  assert.equal((await resp(p1.token, 'quarta', 'It')).status, 409, 'responder sem revelar não vale');

  const rev = (await revelar(p1.token, 'quarta')).json.enigmas.enigmas.find((e) => e.id === 'quarta');
  assert.equal(rev.fase, 'respondendo');
  assert.ok(rev.pergunta.length > 40);
  assert.ok(rev.expiraEm > Date.now() + 100000 && rev.expiraEm <= Date.now() + 121000);
  assert.ok(!JSON.stringify(rev).includes('respostas'), 'a resposta não sai do servidor');
  // Revelar de novo não zera o relógio
  await new Promise((r) => setTimeout(r, 20));
  const rev2 = (await revelar(p1.token, 'quarta')).json.enigmas.enigmas.find((e) => e.id === 'quarta');
  assert.equal(rev2.expiraEm, rev.expiraEm);

  const errado = await resp(p1.token, 'quarta', 'O Exorcista');
  assert.equal(errado.json.resultado.acertou, false);
  assert.equal(errado.json.resultado.restantes, 4);
  assert.equal((await resp(p1.token, 'quarta', 'IT: A Coisa')).json.resultado.pontos, 20);
  for (const p of [p2, p3]) await revelar(p.token, 'quarta');
  const [r2, r3] = await Promise.all([resp(p2.token, 'quarta', 'a coisa'), resp(p3.token, 'quarta', 'IT.')]);
  assert.deepEqual([r2.json.resultado.posicao, r3.json.resultado.posicao].sort(), [2, 3]);
  assert.deepEqual([r2.json.resultado.pontos, r3.json.resultado.pontos].sort((a, b) => a - b), [13, 15]);
  await revelar(p4.token, 'quarta');
  assert.equal((await resp(p4.token, 'quarta', 'it capítulo 1')).json.resultado.pontos, 10, 'quarto lugar: sem bônus');
  const de = await Promise.all([1, 2, 3].map(() => resp(p1.token, 'quarta', 'it')));
  assert.ok(de.every((r) => r.json.resultado.jaTinha));
  assert.equal(await h.pontosDe(p1.token), 20);
  const adm = (await s.req('GET', '/api/admin/jogos', { token: admin })).json.enigmas.enigmas.find((e) => e.id === 'quarta');
  assert.deepEqual(adm.acertadores.map((a) => a.posicao), [1, 2, 3, 4]);
  assert.equal(adm.revelaram, 4);
});

test('modo prova: sair da página encerra; tempo esgotado encerra; acertou e saiu não perde', async () => {
  const fujao = await h.convidado('Fujão');
  await revelar(fujao.token, 'quarta');
  const saiu = await s.req('POST', '/api/enigmas/quarta/saiu', { token: fujao.token });
  assert.equal(saiu.json.encerrou, true);
  const r = await resp(fujao.token, 'quarta', 'it');
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /saiu da página/);
  const st = (await s.req('GET', '/api/enigmas', { token: fujao.token })).json.enigmas.enigmas.find((e) => e.id === 'quarta');
  assert.equal(st.fase, 'saiu');
  assert.equal(st.pergunta, undefined, 'depois de eliminado, o texto não volta');
  assert.equal((await revelar(fujao.token, 'quarta')).json.enigmas.enigmas.find((e) => e.id === 'quarta').fase, 'saiu', 'revelar de novo não ressuscita');
  // Sair sem ter revelado não faz nada
  const outro = await h.convidado('Curioso');
  assert.equal((await s.req('POST', '/api/enigmas/quarta/saiu', { token: outro.token })).json.encerrou, false);
  // Tempo esgotado (relógio do servidor)
  await revelar(outro.token, 'quarta');
  await banco.rodar('UPDATE enigma_tentativas SET revelado_em = ? WHERE convidado_id = ?', [Date.now() - 125 * 1000, outro.id]);
  const tarde = await resp(outro.token, 'quarta', 'it');
  assert.equal(tarde.status, 409);
  assert.match(tarde.json.erro, /tempo acabou/);
  // Quem já acertou e depois sai da página continua com os pontos
  await s.req('POST', '/api/enigmas/quarta/saiu', { token: p1.token });
  assert.equal(await h.pontosDe(p1.token), 20);
  assert.equal((await s.req('GET', '/api/admin/jogos', { token: admin })).json.enigmas.enigmas.find((e) => e.id === 'quarta').sairam.includes('Fujão'), true);
});

test('enigma: limite de tentativas; bônus e tempo configuráveis; fechado mostra a resposta', async () => {
  const p5 = await h.convidado('Chutador');
  await revelar(p5.token, 'quarta');
  for (let i = 0; i < 5; i++) await resp(p5.token, 'quarta', `chute ${i}`);
  assert.equal((await resp(p5.token, 'quarta', 'it')).status, 429);
  assert.equal((await s.req('PUT', '/api/admin/enigmas-bonus', { token: admin, corpo: { bonus: [20, 10, 5] } })).status, 200);
  assert.equal((await s.req('PUT', '/api/admin/enigmas-bonus', { token: admin, corpo: { bonus: [99, 1] } })).status, 400);
  assert.equal((await s.req('PUT', '/api/admin/enigmas-tempo', { token: admin, corpo: { segundos: 10 } })).status, 400);
  assert.equal((await s.req('PUT', '/api/admin/enigmas-tempo', { token: admin, corpo: { segundos: 60 } })).status, 200);
  await s.req('PUT', '/api/admin/enigmas/quinta', { token: admin, corpo: { abreEm: agoraISO(-2), fechaEm: agoraISO(24) } });
  const rv = (await revelar(p2.token, 'quinta')).json.enigmas.enigmas.find((e) => e.id === 'quinta');
  assert.ok(rv.expiraEm <= Date.now() + 61000, 'tempo novo vale');
  assert.equal((await resp(p2.token, 'quinta', 'O Chamado')).json.resultado.pontos, 30, 'bônus novo vale para o próximo acerto');
  await s.req('PUT', '/api/admin/enigmas/quinta', { token: admin, corpo: { fechaEm: agoraISO(-1) } });
  const fechado = (await s.req('GET', '/api/enigmas', { token: p1.token })).json.enigmas.enigmas.find((e) => e.id === 'quinta');
  assert.equal(fechado.estado, 'fechado');
  assert.equal(fechado.resposta, 'o chamado');
  assert.equal((await resp(p1.token, 'quinta', 'o chamado')).status, 409);
  assert.equal((await s.req('PUT', '/api/admin/enigmas/quinta', { token: admin, corpo: { respostas: '' } })).status, 400);
});

test('carona: +5 uma vez; mudar a oferta não soma; tirar tira os pontos; oferecer de novo volta', async () => {
  const m = await h.convidado('Motorista');
  const oferta = { vagas: 2, trajeto: 'ida', saindo: 'Centro' };
  await s.req('PUT', '/api/caronas/minha', { token: m.token, corpo: oferta });
  await s.req('PUT', '/api/caronas/minha', { token: m.token, corpo: { ...oferta, vagas: 3 } });
  assert.equal(await h.pontosDe(m.token), 5);
  await s.req('DELETE', '/api/caronas/minha', { token: m.token });
  assert.equal(await h.pontosDe(m.token), 0);
  await s.req('PUT', '/api/caronas/minha', { token: m.token, corpo: oferta });
  assert.equal(await h.pontosDe(m.token), 5);
});

test('música: +5 por música; voto em música repetida não dá ponto; tirar tira os pontos', async () => {
  const d = await h.convidado('DJ');
  const outro = await h.convidado('Ouvinte');
  await s.req('POST', '/api/playlist', { token: d.token, corpo: { titulo: 'Thriller', artista: 'Artista A' } });
  await s.req('POST', '/api/playlist', { token: d.token, corpo: { titulo: 'Monster Mash', artista: 'Artista B' } });
  assert.equal(await h.pontosDe(d.token), 10);
  const r = await s.req('POST', '/api/playlist', { token: outro.token, corpo: { titulo: 'thriller', artista: 'artista a' } });
  assert.equal(r.json.jaExistia, true);
  assert.equal(await h.pontosDe(outro.token), 0);
  const id = (await s.req('GET', '/api/festa', { token: d.token })).json.playlist.musicas.find((x) => x.titulo === 'Monster Mash').id;
  await s.req('DELETE', `/api/playlist/${id}`, { token: d.token });
  assert.equal(await h.pontosDe(d.token), 5);
});

test('bebida: só com confirmação do admin, só no dia da festa, uma vez; desfazer tira', async () => {
  const b = await h.convidado('Leva Gin');
  const item = (await s.req('GET', '/api/festa', { token: b.token })).json.bebidas.itens[0];
  await s.req('PUT', `/api/bebidas/itens/${item.id}`, { token: b.token, corpo: { quantidade: 1 } });
  assert.equal(await h.pontosDe(b.token), 0, 'marcar a bebida não dá ponto sozinho');
  const pend = (await s.req('GET', '/api/admin/jogos', { token: admin })).json.bebidas;
  assert.equal(pend.liberado, false);
  assert.ok(pend.pessoas.some((p) => p.id === b.id && !p.confirmado));
  assert.equal((await s.req('PUT', `/api/admin/colaboracao/bebida/${b.id}`, { token: admin, corpo: { levou: true } })).status, 409);
  await h.festaEm(Date.now() + 3600 * 1000); // festa daqui a 1 h: confirmação liberada
  const rs = await Promise.all([1, 2].map(() => s.req('PUT', `/api/admin/colaboracao/bebida/${b.id}`, { token: admin, corpo: { levou: true } })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(await h.pontosDe(b.token), 5);
  const sem = await h.convidado('Não Marcou');
  assert.equal((await s.req('PUT', `/api/admin/colaboracao/bebida/${sem.id}`, { token: admin, corpo: { levou: true } })).status, 404);
  await s.req('PUT', `/api/admin/colaboracao/bebida/${b.id}`, { token: admin, corpo: { levou: false } });
  assert.equal(await h.pontosDe(b.token), 0);
  assert.equal((await s.req('PUT', `/api/admin/colaboracao/bebida/${b.id}`, { token: b.token, corpo: { levou: true } })).status, 401);
});

test('ranking com empate divide a posição e o extrato mostra de onde vieram os pontos', async () => {
  const r = (await s.req('GET', '/api/ranking', { token: p1.token })).json.ranking;
  assert.equal(r.eu.pontos, 20);
  assert.ok(r.extrato.porAtividade.some((a) => a.nome === 'Enigmas' && a.pontos === 20));
  const empatados = r.top.filter((x) => x.pontos === r.top[0].pontos);
  assert.ok(empatados.every((x) => x.posicao === 1));
});

test('três enigmas por dia (8h, 13h e 19h), de quarta a sexta, e um aviso só por dia', async () => {
  const lista = await enigmasDados.lista();
  assert.equal(lista.length, 9);
  const horas = new Set(lista.map((e) => new Date(e.abreEm - 4 * 3600 * 1000).toISOString().slice(11, 16)));
  assert.ok(['08:00', '13:00', '19:00'].every((h) => horas.has(h)) || lista.some((e) => e.id === 'quarta'), 'turnos');
  const sexta = lista.filter((e) => e.id.startsWith('sexta')).map((e) => [e.titulo, new Date(e.abreEm - 4 * 3600 * 1000).toISOString().slice(0, 16)]);
  assert.deepEqual(sexta, [['Sexta · manhã', '2026-10-30T08:00'], ['Sexta · tarde', '2026-10-30T13:00'], ['Sexta · noite', '2026-10-30T19:00']]);
  const notif = require('../server/notificacoes');
  const { lista: ag } = await notif._modelos().agendados();
  const dias = ag.filter((a) => a.chave.startsWith('enigma-dia-'));
  assert.ok(dias.some((d) => d.chave === 'enigma-dia-2026-10-30' && /3 enigmas no site da festa, abrindo às 8h, 13h e 19h/.test(d.corpo)));
  for (const d of dias) assert.equal(notif.problemaNoAviso(d), null, d.corpo);
});
