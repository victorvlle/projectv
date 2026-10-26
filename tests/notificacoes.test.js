// Notificações: inscrição segura, avisos do admin, agrupamento, horários e agendados.
process.env.PUSH_LOTE_MS = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const notif = require('../server/notificacoes');
const banco = require('../server/dados/banco');

let s;
let admin;
test.before(async () => { s = await subir(); admin = await s.tokenAdmin(); });
test.after(async () => { await s.fechar(); });

const M = (iso) => Date.parse(iso); // horários em Manaus (-04:00)
let seq = 0;
function inscricao(extra = '') {
  seq += 1;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/aparelho${seq}${extra}`,
    keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
  };
}
async function convidado(nome, ativar = true) {
  const c = (await s.req('POST', '/api/admin/convidados', { token: admin, corpo: { nome } })).json.criados[0];
  const token = (await s.req('POST', '/api/entrar', { corpo: { codigo: c.codigo } })).json.token;
  await s.req('PUT', '/api/eu/perfil', { token, corpo: { avatar: 'bruxa' } });
  const sub = inscricao();
  if (ativar) {
    assert.equal((await s.req('POST', '/api/eu/push', { token, corpo: { inscricao: sub } })).status, 200);
    await new Promise((r) => setTimeout(r, 30)); // deixa sair a confirmação de boas-vindas
  }
  return { ...c, token, sub };
}
const recebeu = (sub) => notif.caixa.filter((m) => m.endpoint === sub.endpoint && m.tag !== 'boas-vindas');
const limpar = () => { notif.caixa.length = 0; notif._zerarSociais(); };

test('inscrição só aceita serviços de push conhecidos (sem SSRF)', async () => {
  const c = await convidado('Seguro', false);
  const ruins = ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://evil.com/x',
    'https://fcm.googleapis.com:8443/x', 'https://fcm.googleapis.com.evil.com/x', 'file:///etc/passwd', 'https://169.254.169.254/latest'];
  for (const endpoint of ruins) {
    const r = await s.req('POST', '/api/eu/push', { token: c.token, corpo: { inscricao: { endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } } } });
    assert.equal(r.status, 400, endpoint);
  }
  const chavesRuins = await s.req('POST', '/api/eu/push', { token: c.token, corpo: { inscricao: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: '<script>', auth: 'x' } } } });
  assert.equal(chavesRuins.status, 400);
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x']) {
    assert.ok(notif.enderecoPermitido(ok), ok);
  }
  assert.equal((await s.req('POST', '/api/eu/push', { corpo: { inscricao: inscricao() } })).status, 401);
  const chave = await s.req('GET', '/api/push/chave', { token: c.token });
  assert.ok(chave.json.chave.length > 60);
});

test('aviso do admin chega a quem ativou; não a quem não ativou nem a desativado; convidado não envia', async () => {
  limpar();
  const a = await convidado('Ativo');
  const b = await convidado('Sem push', false);
  const d = await convidado('Desativado');
  await s.req('PATCH', `/api/admin/convidados/${d.id}`, { token: admin, corpo: { ativo: false } });
  const r = await s.req('POST', '/api/admin/avisos', { token: admin, corpo: { titulo: '🍕', corpo: 'A pizza chegou!', url: '/#playlist' } });
  assert.equal(r.status, 200);
  assert.equal(recebeu(a.sub).length, 1);
  assert.equal(recebeu(a.sub)[0].corpo, 'A pizza chegou!');
  assert.ok(notif.caixa.some((m) => m.endpoint === a.sub.endpoint && m.tag === 'boas-vindas'), 'confirmação ao ativar');
  assert.equal(recebeu(a.sub)[0].url, '/#playlist');
  assert.equal(recebeu(d.sub).length, 0);
  void b;
  assert.equal((await s.req('POST', '/api/admin/avisos', { token: a.token, corpo: { corpo: 'hack' } })).status, 401);
  const destinoRuim = await s.req('POST', '/api/admin/avisos', { token: admin, corpo: { corpo: 'x2', url: 'https://golpe.com' } });
  assert.equal(destinoRuim.status, 200);
  assert.equal(notif.caixa.at(-1).url, '/');
  // O desativado perdeu a inscrição de vez
  assert.equal(await notif.estaInscrito(d.id, d.sub.endpoint), false);
});

test('movimento dos amigos: agrupado, sem avisar o autor, silencioso de madrugada', async () => {
  limpar();
  const autor = await convidado('Autor');
  const outro = await convidado('Outro');
  const item = (await s.req('GET', '/api/festa', { token: autor.token })).json.bebidas.itens[0];
  await s.req('PUT', `/api/bebidas/itens/${item.id}`, { token: autor.token, corpo: { quantidade: 2 } });
  await s.req('PUT', `/api/bebidas/itens/${item.id}`, { token: autor.token, corpo: { quantidade: 3 } }); // mudar não é novidade
  await s.req('POST', '/api/playlist', { token: autor.token, corpo: { titulo: 'Som Novo', artista: 'Banda' } });

  // 3h da manhã: segura
  await notif.despacharSociais(M('2026-10-27T03:00:00-04:00'));
  await notif.despacharSociais(M('2026-10-27T03:05:00-04:00'));
  assert.equal(notif.caixa.filter((m) => m.tag !== 'boas-vindas').length, 0);
  // 9h: manda um de cada tipo
  await notif.despacharSociais(M('2026-10-27T09:00:00-04:00'));
  await notif.despacharSociais(M('2026-10-27T09:00:01-04:00'));
  const titulos = recebeu(outro.sub).map((m) => m.titulo).sort();
  assert.deepEqual(titulos, ['🍻 Nova contribuição', '🎵 Música nova']);
  assert.equal(recebeu(autor.sub).length, 0, 'o autor não recebe aviso da própria ação');
  assert.match(recebeu(outro.sub).find((m) => m.titulo.includes('Música')).corpo, /Vote nas melhores/);

  // Mais 3 músicas logo depois: espera o intervalo de 20 min e manda UM aviso agrupado
  for (let i = 0; i < 3; i++) await s.req('POST', '/api/playlist', { token: autor.token, corpo: { titulo: `Outra ${i}`, artista: 'X' } });
  await notif.despacharSociais(M('2026-10-27T09:05:00-04:00'));
  await notif.despacharSociais(M('2026-10-27T09:06:00-04:00'));
  assert.equal(recebeu(outro.sub).length, 2);
  await notif.despacharSociais(M('2026-10-27T09:21:00-04:00'));
  await notif.despacharSociais(M('2026-10-27T09:21:01-04:00'));
  assert.equal(recebeu(outro.sub).length, 3);
  assert.match(recebeu(outro.sub).at(-1).corpo, /3 músicas novas/);
});

test('durante a festa: contribuição e música não avisam; carona avisa', async () => {
  limpar();
  const a = await convidado('Festeiro');
  const b = await convidado('Ouvinte');
  await s.req('POST', '/api/playlist', { token: a.token, corpo: { titulo: 'Na Festa', artista: 'Y' } });
  await s.req('PUT', '/api/caronas/minha', { token: a.token, corpo: { vagas: 2, trajeto: 'volta', saindo: 'Singolare' } });
  await notif.despacharSociais(M('2026-10-31T21:00:00-04:00'));
  await notif.despacharSociais(M('2026-10-31T21:00:01-04:00'));
  assert.deepEqual(recebeu(b.sub).map((m) => m.titulo), ['🚗 Nova carona']);
});

test('atividade liberada avisa uma vez só', async () => {
  limpar();
  const c = await convidado('Curioso');
  await s.req('PUT', '/api/admin/atividades/quiz', { token: admin, corpo: { estado: 'liberada' } });
  await new Promise((r) => setTimeout(r, 100));
  await s.req('PUT', '/api/admin/atividades/quiz', { token: admin, corpo: { estado: 'bloqueada' } });
  await s.req('PUT', '/api/admin/atividades/quiz', { token: admin, corpo: { estado: 'liberada' } });
  await new Promise((r) => setTimeout(r, 100));
  const msgs = recebeu(c.sub);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].titulo, '🔓 Quiz de Terror Relâmpago foi liberado!');
  await s.req('PUT', '/api/admin/atividades/quiz', { token: admin, corpo: { estado: 'bloqueada' } });
});

test('agendados: véspera, contribuições (com o que falta), faltam 2h; cada um uma vez', async () => {
  limpar();
  const c = await convidado('Lembrado');
  await notif.verificarAgendados(M('2026-10-30T19:05:00-04:00'));
  await notif.verificarAgendados(M('2026-10-30T19:10:00-04:00'));
  assert.deepEqual(recebeu(c.sub).map((m) => m.titulo), ['🎃 Amanhã é o Project V!']);
  assert.match(recebeu(c.sub)[0].corpo, /Sábado, das 17h à meia-noite/);

  await notif.verificarAgendados(M('2026-10-31T10:01:00-04:00'));
  const contrib = recebeu(c.sub).at(-1);
  assert.equal(contrib.titulo, '🍻 Ainda falta bebida!');
  assert.match(contrib.corpo, /Faltam .+ nas Contribuições/);

  await notif.verificarAgendados(M('2026-10-31T15:00:00-04:00'));
  await notif.verificarAgendados(M('2026-10-31T17:00:30-04:00'));
  assert.deepEqual(recebeu(c.sub).slice(-2).map((m) => m.titulo), ['⏳ Faltam 2 horas!', '🎃 Os portões estão abertos!']);

  // Servidor que acordou muito depois não manda aviso velho
  limpar();
  await banco.rodar("DELETE FROM push_enviados WHERE chave = 'agenda:faltam2h'");
  await notif.verificarAgendados(M('2026-10-31T20:00:00-04:00'));
  assert.equal(recebeu(c.sub).filter((m) => m.titulo.includes('2 horas')).length, 0);

  const prog = (await s.req('GET', '/api/admin/avisos', { token: admin })).json;
  assert.ok(prog.programados.find((p) => p.chave === 'vespera').enviado);
  assert.ok(prog.resumo.pessoas >= 1);
  assert.ok(prog.historico.length >= 1);
});

test('inscrição morta é apagada; link regenerado corta os avisos do aparelho antigo', async () => {
  limpar();
  const c = await convidado('Trocou de celular', false);
  const morta = inscricao('/morta');
  await s.req('POST', '/api/eu/push', { token: c.token, corpo: { inscricao: morta } });
  await s.req('POST', '/api/admin/avisos', { token: admin, corpo: { corpo: 'teste' } });
  assert.equal(await notif.estaInscrito(c.id, morta.endpoint), false);

  const r = await convidado('Repassou');
  assert.equal(await notif.estaInscrito(r.id, r.sub.endpoint), true);
  await s.req('POST', `/api/admin/convidados/${r.id}/regenerar`, { token: admin });
  assert.equal(await notif.estaInscrito(r.id, r.sub.endpoint), false);
});

test('desativar as notificações no celular', async () => {
  const c = await convidado('Desliga');
  assert.equal((await s.req('POST', '/api/eu/push/situacao', { token: c.token, corpo: { endpoint: c.sub.endpoint } })).json.inscrito, true);
  await s.req('DELETE', '/api/eu/push', { token: c.token, corpo: { endpoint: c.sub.endpoint } });
  assert.equal((await s.req('POST', '/api/eu/push/situacao', { token: c.token, corpo: { endpoint: c.sub.endpoint } })).json.inscrito, false);
});
