// O Monstro está entre nós: vila, rodada, segredo dos papéis, brindes, votação, pontos e teste.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { criarAjudas } = require('./jogos-ajuda');
const notif = require('../server/notificacoes');

let s; let admin; let h;
const gente = [];
test.before(async () => {
  s = await subir(); admin = await s.tokenAdmin(); h = criarAjudas(s, admin);
  for (const n of ['Ana Vila', 'Beto Vila', 'Carla Vila', 'Duda Vila', 'Edu Vila', 'Fora Vila']) gente.push(await h.convidado(n, { push: true }));
});
test.after(async () => { await s.fechar(); });

const get = async (c) => (await s.req('GET', '/api/monstro', { token: c.token }));
const adm = (url, corpo) => s.req('POST', `/api/admin/monstro/${url}`, { token: admin, corpo });
const jogos = async () => (await s.req('GET', '/api/admin/jogos', { token: admin })).json.monstro;
const telao = async () => (await s.req('GET', '/api/admin/telao', { token: admin })).json.monstro;

test('bloqueado: ninguém vê; liberado: entra e sai da vila', async () => {
  assert.equal((await get(gente[0])).status, 403);
  assert.equal((await s.req('GET', '/api/festa', { token: gente[0].token })).json.monstro, null);
  await h.liberar('monstro');
  const m = (await get(gente[0])).json.monstro;
  assert.equal(m.naVila, false);
  assert.equal(m.estado, 'aberta');
  for (const c of gente.slice(0, 5)) {
    assert.equal((await s.req('PUT', '/api/monstro/vila', { token: c.token, corpo: { quero: true } })).status, 200);
  }
  assert.equal((await get(gente[0])).json.monstro.naVila, true);
  assert.equal((await jogos()).vila.length, 5);
  assert.equal((await jogos()).sugestao, 1);
  assert.equal((await telao()).vila.length, 5);
  // Começar exige vila e liberação; quantidade fora do limite é recusada
  assert.equal((await adm('iniciar', { quantos: 3 })).status, 400, 'com 5 na vila, no máximo 2 monstros');
});

let monstros = [];
test('rodada: só o monstro sabe que é monstro; os outros não descobrem pelo site', async () => {
  notif.caixa.length = 0;
  assert.equal((await adm('iniciar', { quantos: 1 })).status, 200);
  const respostas = await Promise.all(gente.slice(0, 5).map(async (c) => ({ c, m: (await get(c)).json.monstro })));
  monstros = respostas.filter((x) => x.m.souMonstro).map((x) => x.c);
  assert.equal(monstros.length, 1);
  for (const { c, m } of respostas) {
    assert.equal(m.estado, 'jogando');
    assert.equal(m.qtdMonstros, 1);
    const texto = JSON.stringify(m);
    if (!monstros.includes(c)) {
      assert.equal(m.souMonstro, false);
      assert.ok(!('alvos' in m) && !('comparsas' in m), 'aldeão não recebe lista de alvos');
      assert.ok(!texto.includes(monstros[0].nome), 'nada no payload aponta o monstro');
    } else {
      assert.equal(m.alvos.length, 4, 'alvos: a vila menos ele');
    }
  }
  const t = await telao();
  assert.ok(!JSON.stringify(t).includes(monstros[0].nome), 'o telão não sabe quem é');
  assert.equal(t.estado, 'jogando');
  assert.equal((await s.req('GET', '/api/admin/telao', { token: admin })).json.telao.modo, 'monstro', 'telão troca sozinho');
  // Aviso só para a vila, sem dizer quem é monstro
  const avisos = notif.caixa.filter((x) => x.titulo === 'Project V: o Monstro acordou');
  assert.equal(avisos.length, 5);
  assert.ok(!avisos.some((x) => x.endpoint === gente[5].sub.endpoint), 'quem não está na vila não recebe');
  // Sair da vila no meio da rodada: não pode
  assert.equal((await s.req('PUT', '/api/monstro/vila', { token: gente[0].token, corpo: { quero: false } })).status, 409);
});

test('brindes: só o monstro marca, só gente da vila, sem repetir; aldeão não consegue', async () => {
  const mon = monstros[0];
  const m = (await get(mon)).json.monstro;
  const aldeao = gente.slice(0, 5).find((c) => c !== mon);
  assert.equal((await s.req('PUT', '/api/monstro/brinde', { token: aldeao.token, corpo: { vitima: m.alvos[0].id } })).status, 403);
  for (const a of m.alvos.slice(0, 3)) {
    assert.equal((await s.req('PUT', '/api/monstro/brinde', { token: mon.token, corpo: { vitima: a.id } })).status, 200);
  }
  await s.req('PUT', '/api/monstro/brinde', { token: mon.token, corpo: { vitima: m.alvos[0].id } });
  assert.equal((await s.req('PUT', '/api/monstro/brinde', { token: mon.token, corpo: { vitima: 'x' } })).status, 400);
  assert.equal((await s.req('PUT', '/api/monstro/brinde', { token: mon.token, corpo: { vitima: gente[5].id } })).status, 400, 'id interno não vale');
  assert.equal((await get(mon)).json.monstro.vitimas.length, 3);
  // Desmarca um (tocou errado)
  await s.req('PUT', '/api/monstro/brinde', { token: mon.token, corpo: { vitima: m.alvos[2].id, marcar: false } });
  assert.equal((await get(mon)).json.monstro.vitimas.length, 2);
  assert.equal((await telao()).almas, 2);
  // Pistas
  const j = await jogos();
  assert.ok(j.prontas.length >= 2);
  assert.equal((await adm('pista', { texto: j.prontas[0] })).status, 200);
  assert.equal((await telao()).pistas[0].texto, j.prontas[0]);
  assert.equal((await get(aldeao)).json.monstro.pistas.length, 1);
});

test('votação e revelação: +1000 quem acertou; monstro descoberto não ganha; telão mostra o resultado', async () => {
  const mon = monstros[0];
  assert.equal((await s.req('PUT', '/api/monstro/voto', { token: gente[0].token, corpo: { suspeito: 'x' } })).status, 409, 'antes da votação');
  notif.caixa.length = 0;
  assert.equal((await adm('votacao')).status, 200);
  assert.equal(notif.caixa.filter((x) => x.titulo === 'Project V: quem é o monstro?').length, 5);
  assert.equal((await s.req('PUT', '/api/monstro/brinde', { token: mon.token, corpo: { vitima: 'x' } })).status, 409, 'brinde só durante a rodada');
  const aldeoes = gente.slice(0, 5).filter((c) => c !== mon);
  const alvoMon = (await get(aldeoes[0])).json.monstro.suspeitos.find((x) => x.nome === mon.nome).id;
  // 3 acertam, 1 erra; o monstro vota em alguém
  for (const c of aldeoes.slice(0, 3)) assert.equal((await s.req('PUT', '/api/monstro/voto', { token: c.token, corpo: { suspeito: alvoMon } })).status, 200);
  const outro = (await get(aldeoes[3])).json.monstro.suspeitos.find((x) => x.nome !== mon.nome).id;
  await s.req('PUT', '/api/monstro/voto', { token: aldeoes[3].token, corpo: { suspeito: outro } });
  const eu = (await get(mon)).json.monstro.suspeitos;
  assert.ok(!eu.some((x) => x.nome === mon.nome), 'não vota em si');
  await s.req('PUT', '/api/monstro/voto', { token: mon.token, corpo: { suspeito: eu[0].id } });
  assert.equal((await s.req('PUT', '/api/monstro/voto', { token: gente[5].token, corpo: { suspeito: alvoMon } })).status, 403, 'fora da vila não vota');
  assert.equal((await telao()).eleitores.length, 5);

  assert.equal((await adm('revelar')).status, 200);
  for (const c of aldeoes.slice(0, 3)) assert.equal(await h.pontosDe(c.token), 1000);
  assert.equal(await h.pontosDe(aldeoes[3].token), 0);
  assert.equal(await h.pontosDe(mon.token), 0, 'foi descoberto');
  const r = (await telao()).resultado;
  assert.equal(r.monstros[0].nome, mon.nome);
  assert.equal(r.monstros[0].descoberto, true);
  assert.equal(r.monstros[0].almas, 2);
  assert.equal(r.acertaram, 3);
  const meu = (await get(aldeoes[0])).json.monstro.resultado;
  assert.equal(meu.acertei, true);
  assert.equal((await adm('revelar')).status, 409, 'revelar duas vezes não dá ponto de novo');
});

test('nova rodada: monstro que escapa ganha 1000 + 100 por vítima; cancelar não dá ponto', async () => {
  assert.equal((await adm('nova')).status, 200);
  assert.equal((await adm('iniciar', { quantos: 1 })).status, 200);
  const todos = await Promise.all(gente.slice(0, 5).map(async (c) => ({ c, m: (await get(c)).json.monstro })));
  const mon = todos.find((x) => x.m.souMonstro);
  assert.equal(mon.m.rodada, 2);
  for (const a of mon.m.alvos.slice(0, 2)) await s.req('PUT', '/api/monstro/brinde', { token: mon.c.token, corpo: { vitima: a.id } });
  await adm('votacao');
  // Todos votam em um aldeão: o monstro escapa
  const bode = todos.find((x) => !x.m.souMonstro);
  for (const { c } of todos) {
    if (c === bode.c) continue;
    const alvo = (await get(c)).json.monstro.suspeitos.find((x) => x.nome === bode.c.nome);
    await s.req('PUT', '/api/monstro/voto', { token: c.token, corpo: { suspeito: alvo.id } });
  }
  const antes = await h.pontosDe(mon.c.token);
  await adm('revelar');
  assert.equal(await h.pontosDe(mon.c.token), antes + 1000 + 200);
  assert.equal((await get(mon.c)).json.monstro.resultado.escapei, true);
  // Cancelar uma rodada no meio
  await adm('nova');
  await adm('iniciar', { quantos: 1 });
  assert.equal((await adm('cancelar')).status, 200);
  const j = await jogos();
  assert.equal(j.estado, 'aberta');
  assert.equal(j.rodada, 2);
});

test('apagar dados de teste: rodada de teste some, numeração volta', async () => {
  await h.liberar('monstro', 'teste');
  const [t1, t2, t3] = gente.slice(0, 3);
  for (const c of [t1, t2, t3]) await s.req('PATCH', `/api/admin/convidados/${c.id}`, { token: admin, corpo: { testador: true } });
  assert.equal((await adm('iniciar', { quantos: 1 })).status, 200);
  assert.equal((await jogos()).rodada, 3);
  assert.equal((await get(gente[4])).status, 403, 'quem não testa não vê');
  const r = await s.req('POST', '/api/admin/teste/apagar', { token: admin });
  assert.equal(r.status, 200);
  const j = await jogos();
  assert.equal(j.rodada, 2);
  assert.equal(j.estado, 'aberta');
  for (const c of [t1, t2, t3]) await s.req('PATCH', `/api/admin/convidados/${c.id}`, { token: admin, corpo: { testador: false } });
});
