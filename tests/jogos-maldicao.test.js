// Maldição: sorteio no servidor, sincronização com telão/celular, push, confirmação e pontos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir, proximoEvento, esperar } = require('./ajuda');
const { criarAjudas } = require('./jogos-ajuda');
const notif = require('../server/notificacoes');
const maldicao = require('../server/dados/maldicao');
const banco = require('../server/dados/banco');

let s; let admin; let h;
test.before(async () => { s = await subir(); admin = await s.tokenAdmin(); h = criarAjudas(s, admin); });
test.after(async () => { await s.fechar(); });

let unica;
test('bloqueada: não sorteia; sem ninguém disponível: erro claro', async () => {
  await h.liberar('maldicao', 'bloqueada');
  assert.equal(await maldicao.tic(), null);
  const r = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
  assert.equal(r.status, 409);
});

test('sorteio manual: telões e celular recebem uma vez; push sai uma vez; clique duplo não duplica', async () => {
  unica = await h.convidado('Única Bruxa', { push: true });
  await h.liberar('maldicao');
  notif.caixa.length = 0;
  const telao1 = await s.conectar({ tipo: 'telao', token: admin });
  const telao2 = await s.conectar({ tipo: 'telao', token: admin });
  const cel = await s.conectar({ tipo: 'convidado', token: unica.token });
  let recebidos = 0;
  telao1.on('maldicao', () => { recebidos += 1; });
  const ev2 = proximoEvento(telao2, 'maldicao');
  const evCel = proximoEvento(cel, 'maldicao:voce');
  const id = h.idClique();
  const [a, b] = await Promise.all([
    s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id } }),
    s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id } }),
  ]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal([a.json.repetido, b.json.repetido].filter(Boolean).length, 1);
  const p = await ev2;
  assert.equal(p.nome, 'Única Bruxa');
  assert.ok(p.castigo.length > 5);
  assert.deepEqual(p.fases, { alerta: 4000, suspense: 5000, cumprir: 60000 });
  assert.ok(Array.isArray(p.roleta) && p.roleta.length >= 1);
  assert.equal((await evCel).id, p.id);
  await esperar(150);
  assert.equal(recebidos, 1, 'cada telão recebe uma vez');
  const pushes = notif.caixa.filter((m) => m.endpoint === unica.sub.endpoint);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].titulo, 'Project V: você foi amaldiçoado');
  assert.equal(pushes[0].url, '/#maldicao');
  assert.equal(notif.problemaNoAviso(pushes[0]), null);
  // Telão que reconecta pega a maldição em cena
  const t = (await s.req('GET', '/api/admin/telao', { token: admin })).json;
  assert.equal(t.maldicao.id, p.id);
  const minha = (await s.req('GET', '/api/maldicao/minha', { token: unica.token })).json.maldicao;
  assert.equal(minha.id, p.id);
  telao1.close(); telao2.close(); cel.close();
});

test('confirmar cumprida: +500 uma vez só (cliques simultâneos); cancelada não dá ponto', async () => {
  const atual = (await s.req('GET', '/api/admin/jogos', { token: admin })).json.maldicao.historico[0];
  const rs = await Promise.all([1, 2, 3].map(() => s.req('POST', `/api/admin/maldicao/${atual.id}/resolver`, { token: admin, corpo: { estado: 'cumprida' } })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(rs.filter((r) => !r.json.jaResolvida).length, 1);
  assert.equal(await h.pontosDe(unica.token), 500);
  const outra = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
  await s.req('POST', `/api/admin/maldicao/${outra.json.maldicao.id}/resolver`, { token: admin, corpo: { estado: 'cancelada' } });
  await s.req('POST', `/api/admin/maldicao/${outra.json.maldicao.id}/resolver`, { token: admin, corpo: { estado: 'cumprida' } });
  assert.equal(await h.pontosDe(unica.token), 500, 'cancelada não vira cumprida depois');
  assert.equal((await s.req('POST', `/api/admin/maldicao/${atual.id}/resolver`, { token: unica.token, corpo: { estado: 'cumprida' } })).status, 401);
});

test('push que falha não trava o sorteio nem o telão', async () => {
  await banco.rodar("UPDATE convidados SET fora = 1 WHERE id = ?", [unica.id]);
  const instavel = await h.convidado('Rede Ruim', { push: true, endpoint: `https://fcm.googleapis.com/fcm/send/instavel-${Date.now()}` });
  const telao = await s.conectar({ tipo: 'telao', token: admin });
  const ev = proximoEvento(telao, 'maldicao');
  const r = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
  assert.equal(r.status, 200);
  assert.equal((await ev).nome, 'Rede Ruim', 'quem está "fora" não é sorteado');
  await esperar(150);
  const log = await banco.um("SELECT resultado FROM push_log WHERE convidado_id = ? AND chave LIKE 'maldicao:%'", [instavel.id]);
  assert.equal(log.resultado, 'falha');
  telao.close();
  await banco.rodar("UPDATE convidados SET fora = 0 WHERE id = ?", [unica.id]);
});

test('sorteio automático: intervalo no servidor, um sorteio por horário mesmo com tics simultâneos', async () => {
  const cfg = (await s.req('PUT', '/api/admin/maldicao', { token: admin, corpo: { ligada: true, intensidade: 'caos' } })).json.config;
  assert.equal(cfg.ligada, true);
  assert.equal(cfg.minMin, 10);
  const agora = Date.now();
  assert.ok(cfg.proximaEm >= agora + 9 * 60000 && cfg.proximaEm <= agora + 16 * 60000);
  const antes = (await banco.um('SELECT COUNT(*) AS n FROM maldicoes')).n;
  const quando = cfg.proximaEm + 1000;
  const rs = await Promise.all([maldicao.tic(quando), maldicao.tic(quando), maldicao.tic(quando)]);
  assert.equal(rs.filter(Boolean).length, 1);
  assert.equal(Number((await banco.um('SELECT COUNT(*) AS n FROM maldicoes')).n), Number(antes) + 1);
  const depois = (await s.req('GET', '/api/admin/jogos', { token: admin })).json.maldicao.config;
  assert.ok(depois.proximaEm > quando, 'o próximo horário avançou');
  assert.equal(await maldicao.tic(quando + 1000), null, 'antes do próximo horário, nada');
  // Não repete a mesma pessoa duas vezes seguidas quando há outra opção
  const ultimos = await banco.tudo('SELECT convidado_id FROM maldicoes ORDER BY sorteada_em DESC LIMIT 2');
  void ultimos;
  // Pausar
  await s.req('PUT', '/api/admin/maldicao', { token: admin, corpo: { ligada: false } });
  assert.equal(await maldicao.tic(Date.now() + 3600000), null);
  // Intervalo inválido
  assert.equal((await s.req('PUT', '/api/admin/maldicao', { token: admin, corpo: { minMin: 30, maxMin: 5 } })).status, 400);
});

test('não sorteia a mesma pessoa duas vezes seguidas (com 2 disponíveis)', async () => {
  const nomes = [];
  for (let i = 0; i < 6; i++) {
    const r = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
    nomes.push(r.json.maldicao.nome);
  }
  for (let i = 1; i < nomes.length; i++) assert.notEqual(nomes[i], nomes[i - 1]);
});
