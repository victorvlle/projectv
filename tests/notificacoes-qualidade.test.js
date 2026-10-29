// Notificações (parte 3): qualidade do conteúdo, frequência, duplicidade e retries.
// Motivo: o Chrome no Android avisou "possível spam" num teste real. Estes testes
// garantem que todo texto é específico da festa, que nada sai repetido e que erro
// temporário não vira repetição.
process.env.PUSH_LOTE_MS = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const notif = require('../server/notificacoes');
// Hora fixa de tarde: não depende da hora em que os testes rodam.
notif._definirRelogio(() => Date.parse('2026-10-28T15:00:00-04:00'));
const banco = require('../server/dados/banco');

let s;
let admin;
test.before(async () => { s = await subir(); admin = await s.tokenAdmin(); });
test.after(async () => { await s.fechar(); });

let seq = 0;
const inscricao = (extra = '') => {
  seq += 1;
  return { endpoint: `https://fcm.googleapis.com/fcm/send/q${seq}${extra}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } };
};
async function convidado(nome, sub = inscricao()) {
  const c = (await s.req('POST', '/api/admin/convidados', { token: admin, corpo: { nome } })).json.criados[0];
  const token = (await s.req('POST', '/api/entrar', { corpo: { codigo: c.codigo } })).json.token;
  await s.req('PUT', '/api/eu/perfil', { token, corpo: { avatar: 'bruxa' } });
  assert.equal((await s.req('POST', '/api/eu/push', { token, corpo: { inscricao: sub } })).status, 200);
  return { ...c, token, sub };
}
const limpar = async () => { notif.caixa.length = 0; await notif._zerarSociais(); await banco.rodar('DELETE FROM push_log'); };
const idEnvio = () => `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const M = (iso) => Date.parse(iso);

test('todos os modelos de notificação passam na checagem de qualidade', async () => {
  const { SOCIAIS, TEXTOS_LIBERADA, agendados } = notif._modelos();
  const casos = [];
  for (const [tipo, cfg] of Object.entries(SOCIAIS)) for (const n of [1, 3]) { const [titulo, corpo] = cfg.texto(n); casos.push({ tipo, titulo, corpo, url: cfg.url }); }
  for (const [id, [titulo, corpo]] of Object.entries(TEXTOS_LIBERADA)) casos.push({ tipo: id, titulo, corpo, url: id === 'pos' ? '/#pos' : '/' });
  const { lista } = await agendados();
  for (const a of lista.filter((x) => !x.dinamico)) casos.push({ tipo: a.chave, titulo: a.titulo, corpo: a.corpo, url: a.url });
  casos.push({ tipo: 'teste', ...notif.textoTeste(M('2026-10-30T20:43:00-04:00')), url: '/#avisos' });
  casos.push({ tipo: 'teste', ...notif.textoTeste(M('2026-10-31T00:00:00-04:00')), url: '/#avisos' });
  for (const c of casos) {
    assert.equal(notif.problemaNoAviso(c), null, `${c.tipo}: ${c.titulo} / ${c.corpo}`);
    assert.match(c.titulo, /^Project V/);
    assert.ok(!/[🎃🍻🎵🚗🔓⏳👑🔮🌙💀]/u.test(c.titulo), `sem emoji no título: ${c.titulo}`);
  }
  // Nada de texto antigo, genérico, sobrou
  const tudo = JSON.stringify(casos);
  assert.ok(!/Você está na lista|Partiu|Bora|Decidam aí|Te espero lá/.test(tudo));
});

test('a checagem recusa texto com cara de spam', () => {
  const ok = { titulo: 'Project V: pizza', corpo: 'A pizza chegou na churrasqueira.', url: '/' };
  assert.equal(notif.problemaNoAviso(ok), null);
  const ruins = [
    { ...ok, titulo: 'Pizza chegou' },
    { ...ok, corpo: 'GRÁTIS para quem chegar primeiro na festa' },
    { ...ok, corpo: 'Urgente: venha para a churrasqueira' },
    { ...ok, corpo: 'Não perca a pizza na churrasqueira hoje' },
    { ...ok, corpo: 'Veja em https://exemplo.com a nossa festa' },
    { ...ok, corpo: 'A PIZZA CHEGOU NA CHURRASQUEIRA AGORA' },
    { ...ok, corpo: 'Pizza!! Venha logo para a churrasqueira!' },
    { ...ok, corpo: 'Oi' },
    { ...ok, url: 'https://golpe.com' },
  ];
  for (const r of ruins) assert.notEqual(notif.problemaNoAviso(r), null, JSON.stringify(r));
});

test('admin: título ganha "Project V:", texto apelativo é recusado e nada sai', async () => {
  await limpar();
  const c = await convidado('Leitor');
  const r = await s.req('POST', '/api/admin/avisos', { token: admin, corpo: { id: idEnvio(), titulo: 'pizza', corpo: 'A pizza chegou na churrasqueira.' } });
  assert.equal(r.status, 200);
  assert.equal(notif.caixa.at(-1).titulo, 'Project V: pizza');
  const r2 = await s.req('POST', '/api/admin/avisos', { token: admin, corpo: { id: idEnvio(), titulo: 'project v hoje', corpo: 'Começamos às 17h na churrasqueira.' } });
  assert.equal(notif.caixa.at(-1).titulo, 'Project V hoje');
  void r2;
  const antes = notif.caixa.length;
  for (const corpo of ['Prêmio GRÁTIS para o primeiro que chegar', 'Clique aqui www.golpe.com', 'URGENTE URGENTE VENHAM LOGO']) {
    const ruim = await s.req('POST', '/api/admin/avisos', { token: admin, corpo: { id: idEnvio(), corpo } });
    assert.equal(ruim.status, 400, corpo);
  }
  assert.equal(notif.caixa.length, antes, 'nada recusado chegou a sair');
  void c;
});

test('teto de 4 avisos por pessoa por hora (com registro do que foi segurado)', async () => {
  await limpar();
  const c = await convidado('Muitos Avisos');
  const resultados = [];
  for (let i = 0; i < 6; i++) {
    resultados.push(await notif.enviar({ titulo: `Project V: aviso ${i}`, corpo: `Aviso número ${i} sobre a festa de sábado.`, chave: `q:${idEnvio()}` }));
  }
  const recebidos = notif.caixa.filter((m) => m.endpoint === c.sub.endpoint);
  assert.equal(recebidos.length, 4);
  assert.ok(resultados.at(-1).limitados >= 1);
  const lim = await banco.um("SELECT COUNT(*) AS n FROM push_log WHERE convidado_id = ? AND resultado = 'limite'", [c.id]);
  assert.equal(Number(lim.n), 2);
  // Teste pedido pela pessoa não conta no teto (e tem o próprio limite)
  const t = await s.req('POST', '/api/eu/push/teste', { token: c.token, corpo: { endpoint: c.sub.endpoint } });
  assert.equal(t.status, 200);
  await banco.rodar('DELETE FROM push_log'); // não deixa o teto afetar os próximos testes
});

test('erro temporário do serviço de push: uma tentativa só, sem loop, inscrição mantida', async () => {
  await limpar();
  const c = await convidado('Rede Ruim', inscricao('/instavel'));
  const r = await notif.enviar({ titulo: 'Project V: aviso de teste', corpo: 'Mensagem interna de verificação da festa.', para: { ids: [c.id] }, chave: `q:${idEnvio()}` });
  assert.equal(r.falhas, 1);
  assert.equal(notif.caixa.filter((m) => m.endpoint === c.sub.endpoint).length, 1, 'uma tentativa');
  await new Promise((ok) => setTimeout(ok, 200));
  assert.equal(notif.caixa.filter((m) => m.endpoint === c.sub.endpoint).length, 1, 'nenhuma repetição depois');
  assert.equal(await notif.estaInscrito(c.id, c.sub.endpoint), true, 'erro temporário não apaga a inscrição');
  const log = await banco.um("SELECT resultado, codigo FROM push_log WHERE convidado_id = ?", [c.id]);
  assert.deepEqual([log.resultado, Number(log.codigo)], ['falha', 500]);
  // Agendado que falhou não é reenviado no próximo tic (a trava já foi gravada)
  await banco.rodar("DELETE FROM push_enviados WHERE chave LIKE 'agenda:%'");
  await notif.verificarAgendados(M('2026-10-30T19:05:00-04:00'));
  await notif.verificarAgendados(M('2026-10-30T19:06:00-04:00'));
  await notif.verificarAgendados(M('2026-10-30T19:07:00-04:00'));
  assert.equal(notif.caixa.filter((m) => m.endpoint === c.sub.endpoint && m.titulo === 'Project V é amanhã').length, 1);
});

test('agendado e liberação disparados ao mesmo tempo saem uma vez só', async () => {
  await limpar();
  const c = await convidado('Concorrente');
  await banco.rodar("DELETE FROM push_enviados WHERE chave = 'agenda:portoes'");
  const agora = M('2026-10-31T17:00:30-04:00');
  await Promise.all([notif.verificarAgendados(agora), notif.verificarAgendados(agora), notif.verificarAgendados(agora)]);
  assert.equal(notif.caixa.filter((m) => m.endpoint === c.sub.endpoint && m.titulo === 'Project V começou').length, 1);
  await Promise.all([1, 2, 3].map(() => notif.atividadeLiberada({ id: 'desfile-teste', nome: 'Desfile' })));
  assert.equal(notif.caixa.filter((m) => m.endpoint === c.sub.endpoint && m.titulo === 'Project V: Desfile liberado').length, 1);
});

test('teste do admin: no máximo 1 a cada 10 min por pessoa', async () => {
  await limpar();
  const c = await convidado('Testado');
  assert.equal((await s.req('POST', '/api/admin/avisos/teste', { token: admin, corpo: { convidadoId: c.id } })).status, 200);
  assert.equal((await s.req('POST', '/api/admin/avisos/teste', { token: admin, corpo: { convidadoId: c.id } })).status, 429);
  const m = notif.caixa.filter((x) => x.endpoint === c.sub.endpoint);
  assert.equal(m.length, 1);
  assert.equal(m[0].titulo, 'Project V: teste do organizador');
  const g = (await s.req('GET', '/api/admin/avisos', { token: admin })).json;
  assert.ok(g.registro.some((r) => r.chave === 'teste:admin' && r.ok === 1));
});

test('atividade liberada de madrugada: o aviso espera até as 8h e sai uma vez', async () => {
  await limpar();
  const c = await convidado('Dorminhoco');
  await banco.rodar("DELETE FROM push_enviados WHERE chave LIKE '%liberou:previsoes%'");
  const r = await notif.atividadeLiberada({ id: 'previsoes', nome: 'Previsões' }, M('2026-10-30T00:00:05-04:00'));
  assert.equal(r.adiado, true);
  assert.equal(notif.caixa.filter((m) => m.endpoint === c.sub.endpoint).length, 0, 'ninguém é acordado');
  assert.equal(await notif.despacharAdiados(M('2026-10-30T03:00:00-04:00')), 0);
  const [a, b] = await Promise.all([notif.despacharAdiados(M('2026-10-30T08:01:00-04:00')), notif.despacharAdiados(M('2026-10-30T08:01:00-04:00'))]);
  assert.equal(a + b, 1);
  const msgs = notif.caixa.filter((m) => m.endpoint === c.sub.endpoint);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].titulo, 'Project V: Previsões abertas');
  assert.equal(msgs[0].url, '/#previsoes');
  // Liberar de novo depois não repete
  await notif.atividadeLiberada({ id: 'previsoes', nome: 'Previsões' }, M('2026-10-30T10:00:00-04:00'));
  assert.equal(notif.caixa.filter((m) => m.endpoint === c.sub.endpoint).length, 1);
});
