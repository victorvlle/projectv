// Fundação: acesso por link, perfil, admin, atividades, tempo real e backup.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir, proximoEvento, esperar } = require('./ajuda');
const banco = require('../server/dados/banco');
const agendador = require('../server/agendador');

let s;
let admin;

test.before(async () => { s = await subir(); admin = await s.tokenAdmin(); });
test.after(async () => { await s.fechar(); });

async function novoConvidado(nome = 'Fulano de Tal') {
  const r = await s.req('POST', '/api/admin/convidados', { token: admin, corpo: { nome } });
  assert.equal(r.status, 201);
  return r.json.criados[0];
}

async function entrar(codigo) {
  return s.req('POST', '/api/entrar', { corpo: { codigo } });
}

test('admin: senha errada é recusada e a certa gera sessão', async () => {
  const errada = await s.req('POST', '/api/admin/entrar', { corpo: { senha: 'nao-e-essa' } });
  assert.equal(errada.status, 401);
  assert.ok(admin);
  const semToken = await s.req('GET', '/api/admin/estado');
  assert.equal(semToken.status, 401);
  const tokenFalso = await s.req('GET', '/api/admin/estado', { token: 'a.9999999999999.forjado' });
  assert.equal(tokenFalso.status, 401);
});

test('cadastro em lote gera links únicos com código seguro', async () => {
  const r = await s.req('POST', '/api/admin/convidados', { token: admin, corpo: { nome: 'Ana\nBeto\n\nCarla' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.criados.length, 3);
  const codigos = new Set(r.json.criados.map((c) => c.codigo));
  assert.equal(codigos.size, 3);
  for (const c of r.json.criados) {
    assert.match(c.codigo, /^[a-z2-9]{10}$/);
    assert.ok(c.link.endsWith(`/c/${c.codigo}`));
  }
});

test('visitante sem link não entra; código inválido é recusado', async () => {
  assert.equal((await s.req('GET', '/api/festa')).status, 401);
  assert.equal((await entrar('aaaaaaaaaa')).status, 404);
  assert.equal((await entrar('<script>')).status, 404);
});

test('convidado entra pelo link, escolhe o monstro e aparece com o nome cadastrado', async () => {
  const c = await novoConvidado('Victor Teste');
  const e = await entrar(c.codigo);
  assert.equal(e.status, 200);
  const token = e.json.token;
  assert.equal(e.json.eu.perfilCompleto, false);
  assert.equal(e.json.eu.nome, 'Victor Teste');

  assert.equal((await s.req('PUT', '/api/eu/perfil', { token, corpo: { avatar: 'dragao' } })).status, 400);
  assert.equal((await s.req('PUT', '/api/eu/perfil', { token, corpo: {} })).status, 400);

  const p = await s.req('PUT', '/api/eu/perfil', { token, corpo: { avatar: 'vampiro' } });
  assert.equal(p.status, 200);
  assert.equal(p.json.eu.perfilCompleto, true);

  const f = await s.req('GET', '/api/festa', { token });
  assert.equal(f.status, 200);
  assert.ok(Number.isFinite(f.json.agora));
  assert.ok(f.json.confirmados.some((x) => x.nome === 'Victor Teste' && x.avatar === 'vampiro'));
  // Confirmados não vazam código nem dados internos
  for (const x of f.json.confirmados) assert.deepEqual(Object.keys(x).sort(), ['avatar', 'id', 'nome']);
});

test('convidado não muda o próprio nome; só o admin renomeia', async () => {
  const c = await novoConvidado('Nome Oficial');
  const t = (await entrar(c.codigo)).json.token;
  await s.req('PUT', '/api/eu/perfil', { token: t, corpo: { avatar: 'bruxa', nome: 'Hacker', apelido: 'Hacker' } });
  let eu = await s.req('GET', '/api/eu', { token: t });
  assert.equal(eu.json.eu.nome, 'Nome Oficial');
  await s.req('PATCH', `/api/admin/convidados/${c.id}`, { token: admin, corpo: { nome: 'Nome Novo' } });
  eu = await s.req('GET', '/api/eu', { token: t });
  assert.equal(eu.json.eu.nome, 'Nome Novo');
  const f = await s.req('GET', '/api/festa', { token: t });
  assert.ok(f.json.confirmados.some((x) => x.nome === 'Nome Novo'));
});

test('quem escolhe não aparecer fica fora da lista pública', async () => {
  const c = await novoConvidado('Discreto');
  const t = (await entrar(c.codigo)).json.token;
  await s.req('PUT', '/api/eu/perfil', { token: t, corpo: { avatar: 'fantasma', exibir: false } });
  const f = await s.req('GET', '/api/festa', { token: t });
  assert.ok(!f.json.confirmados.some((x) => x.nome === 'Discreto'));
});

test('link regenerado: código e sessão antigos param de funcionar', async () => {
  const c = await novoConvidado('Repassador');
  const antigo = (await entrar(c.codigo)).json.token;
  const r = await s.req('POST', `/api/admin/convidados/${c.id}/regenerar`, { token: admin });
  assert.equal(r.status, 200);
  assert.notEqual(r.json.convidado.codigo, c.codigo);
  assert.equal((await entrar(c.codigo)).status, 404);
  assert.equal((await s.req('GET', '/api/eu', { token: antigo })).status, 401);
  assert.equal((await entrar(r.json.convidado.codigo)).status, 200);
});

test('convidado desativado perde o acesso; reativado volta pelo link', async () => {
  const c = await novoConvidado('Desativável');
  const t = (await entrar(c.codigo)).json.token;
  await s.req('PATCH', `/api/admin/convidados/${c.id}`, { token: admin, corpo: { ativo: false } });
  assert.equal((await s.req('GET', '/api/eu', { token: t })).status, 401);
  assert.equal((await entrar(c.codigo)).status, 404);
  await s.req('PATCH', `/api/admin/convidados/${c.id}`, { token: admin, corpo: { ativo: true } });
  assert.equal((await entrar(c.codigo)).status, 200);
});

test('token de convidado não abre rotas de admin', async () => {
  const c = await novoConvidado('Curioso');
  const t = (await entrar(c.codigo)).json.token;
  assert.equal((await s.req('GET', '/api/admin/estado', { token: t })).status, 401);
  assert.equal((await s.req('GET', '/api/admin/backup', { token: t })).status, 401);
});

test('atividade bloqueada esconde o nome; liberada mostra', async () => {
  const c = await novoConvidado('Espiã');
  const t = (await entrar(c.codigo)).json.token;
  let f = await s.req('GET', '/api/festa', { token: t });
  const maldicao = f.json.atividades.find((a) => a.id === 'maldicao');
  assert.equal(maldicao.estado, 'bloqueada');
  assert.equal(maldicao.nome, undefined);
  assert.equal(maldicao.descricao, undefined);

  await s.req('PUT', '/api/admin/atividades/maldicao', { token: admin, corpo: { estado: 'liberada' } });
  f = await s.req('GET', '/api/festa', { token: t });
  assert.equal(f.json.atividades.find((a) => a.id === 'maldicao').nome, 'A Maldição');

  // Estado inválido e atividade inexistente
  assert.equal((await s.req('PUT', '/api/admin/atividades/maldicao', { token: admin, corpo: { estado: 'aberta' } })).status, 400);
  assert.equal((await s.req('PUT', '/api/admin/atividades/xyz', { token: admin, corpo: { estado: 'liberada' } })).status, 404);
  await s.req('PUT', '/api/admin/atividades/maldicao', { token: admin, corpo: { estado: 'bloqueada' } });
});

test('Previsões nascem agendadas para 30/10 e abrem sozinhas no horário', async () => {
  const est = await s.req('GET', '/api/admin/estado', { token: admin });
  const prev = est.json.atividades.find((a) => a.id === 'previsoes');
  assert.equal(prev.estado, 'agendada');
  assert.equal(prev.abreEm, Date.parse('2026-10-30T00:00:00-04:00'));

  // Agenda para 1 s no passado: o estado efetivo já é liberada, e o agendador grava.
  await s.req('PUT', '/api/admin/atividades/quiz', { token: admin, corpo: { estado: 'agendada', abreEm: Date.now() - 1000 } });
  const c = await novoConvidado('Pontual');
  const t = (await entrar(c.codigo)).json.token;
  const f = await s.req('GET', '/api/festa', { token: t });
  assert.equal(f.json.atividades.find((a) => a.id === 'quiz').estado, 'liberada');
  assert.equal(await agendador.verificar(), 1);
  const l = await banco.um("SELECT estado FROM atividades WHERE id = 'quiz'");
  assert.equal(l.estado, 'liberada');
  await s.req('PUT', '/api/admin/atividades/quiz', { token: admin, corpo: { estado: 'bloqueada' } });
});

test('horário padrão: sábado 31/10, das 17h à meia-noite', async () => {
  const est = await s.req('GET', '/api/admin/estado', { token: admin });
  assert.equal(est.json.festa.inicio, '2026-10-31T17:00:00-04:00');
  assert.equal(est.json.festa.fim, '2026-11-01T00:00:00-04:00');
  assert.equal(est.json.festa.fimMs - est.json.festa.inicioMs, 7 * 60 * 60 * 1000);
});

test('informações da festa: edição validada e fuso de Manaus', async () => {
  const r = await s.req('PUT', '/api/admin/festa', { token: admin, corpo: { inicio: '2026-10-31T22:30:00-04:00', local: 'Salão' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.festa.inicio, '2026-10-31T22:30:00-04:00');
  assert.equal(r.json.festa.local, 'Salão');
  assert.equal((await s.req('PUT', '/api/admin/festa', { token: admin, corpo: { inicio: 'amanhã' } })).status, 400);
  // Fim antes do início é recusado e nada é gravado
  const ruim = await s.req('PUT', '/api/admin/festa', { token: admin, corpo: { fim: '2026-10-31T20:00:00-04:00', local: 'Não grava' } });
  assert.equal(ruim.status, 400);
  const depois = await s.req('GET', '/api/admin/estado', { token: admin });
  assert.equal(depois.json.festa.local, 'Salão');
  const ok = await s.req('PUT', '/api/admin/festa', { token: admin, corpo: { inicio: '2026-10-31T17:00:00-04:00', fim: '2026-11-01T00:00:00-04:00' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.festa.fim, '2026-11-01T00:00:00-04:00');
});

test('socket: só conecta com credencial; recebe atualizações; é expulso ao desativar', async () => {
  await assert.rejects(s.conectar({ tipo: 'convidado', token: 'c.x.1.9999999999999.falso' }));
  await assert.rejects(s.conectar({ tipo: 'admin', token: 'qualquer' }));
  await assert.rejects(s.conectar({}));

  const c = await novoConvidado('Conectado');
  const t = (await entrar(c.codigo)).json.token;
  const sock = await s.conectar({ tipo: 'convidado', token: t });
  const tel = await s.conectar({ tipo: 'telao', token: admin });

  const chegou = proximoEvento(sock, 'atualizar');
  const chegouTelao = proximoEvento(tel, 'atualizar');
  await s.req('PUT', '/api/admin/telao', { token: admin, corpo: { modo: 'confirmados' } });
  await chegou;
  await chegouTelao;

  const hora = await new Promise((r) => sock.emit('hora', r));
  assert.ok(Math.abs(hora - Date.now()) < 5000);

  const encerrada = proximoEvento(sock, 'sessao:encerrada');
  const caiu = proximoEvento(sock, 'disconnect');
  await s.req('PATCH', `/api/admin/convidados/${c.id}`, { token: admin, corpo: { ativo: false } });
  await encerrada;
  await caiu;
  tel.close();
  await s.req('PUT', '/api/admin/telao', { token: admin, corpo: { modo: 'contagem' } });
});

test('telão: modo inválido é recusado', async () => {
  assert.equal((await s.req('PUT', '/api/admin/telao', { token: admin, corpo: { modo: 'hack' } })).status, 400);
  const m = await s.req('PUT', '/api/admin/telao', { token: admin, corpo: { modo: 'mensagem', mensagem: 'A pizza chegou!' } });
  assert.equal(m.json.telao.mensagem, 'A pizza chegou!');
  const tel = await s.req('GET', '/api/admin/telao', { token: admin });
  assert.equal(tel.json.telao.modo, 'mensagem');
});

test('backup e restauração devolvem exatamente os mesmos dados', async () => {
  const c = await novoConvidado('Guardado');
  const t = (await entrar(c.codigo)).json.token;
  await s.req('PUT', '/api/eu/perfil', { token: t, corpo: { avatar: 'caveira' } });

  const b = await s.req('GET', '/api/admin/backup', { token: admin, cru: true });
  assert.equal(b.status, 200);
  assert.match(b.headers.get('content-disposition'), /attachment; filename="projectv-backup-/);
  const copia = await b.json();
  const total = copia.tabelas.convidados.length;

  // Estraga: apaga o convidado e muda a festa
  await s.req('DELETE', `/api/admin/convidados/${c.id}`, { token: admin });
  await s.req('PUT', '/api/admin/festa', { token: admin, corpo: { local: 'Outro lugar' } });

  const r = await s.req('POST', '/api/admin/restaurar', { token: admin, corpo: copia });
  assert.equal(r.status, 200);
  const est = await s.req('GET', '/api/admin/estado', { token: admin });
  assert.equal(est.json.convidados.length, total);
  assert.ok(est.json.convidados.some((x) => x.nome === 'Guardado' && x.avatar === 'caveira'));
  assert.notEqual(est.json.festa.local, 'Outro lugar');
  // A sessão do convidado continua valendo depois da restauração
  assert.equal((await s.req('GET', '/api/eu', { token: t })).status, 200);

  assert.equal((await s.req('POST', '/api/admin/restaurar', { token: admin, corpo: { app: 'outro' } })).status, 400);
});

test('freio: chute de códigos em massa é barrado', async () => {
  let barrado = false;
  for (let i = 0; i < 25; i++) {
    const r = await entrar('zzzzzzzzzz');
    if (r.status === 429) { barrado = true; break; }
  }
  assert.ok(barrado);
  await esperar(10);
});
