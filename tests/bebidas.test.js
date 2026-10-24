// Lista de bebidas: quem leva o quê, o que falta, privacidade e regras.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir, proximoEvento } = require('./ajuda');

let s;
let admin;

test.before(async () => { s = await subir(); admin = await s.tokenAdmin(); });
test.after(async () => { await s.fechar(); });

async function convidado(nome, apelido, avatar, exibir = true) {
  const c = (await s.req('POST', '/api/admin/convidados', { token: admin, corpo: { nome } })).json.criados[0];
  const token = (await s.req('POST', '/api/entrar', { corpo: { codigo: c.codigo } })).json.token;
  await s.req('PUT', '/api/eu/perfil', { token, corpo: { apelido, avatar, exibir } });
  return { ...c, token };
}

const lista = async (token) => (await s.req('GET', '/api/festa', { token })).json.bebidas;
const item = (b, nome) => b.itens.find((i) => i.nome === nome);

test('lista nasce aberta com sugestões e metas', async () => {
  const c = await convidado('Ana', 'Aninha', 'bruxa');
  const b = await lista(c.token);
  assert.equal(b.aberta, true);
  assert.ok(b.itens.length >= 8);
  const gelo = item(b, 'Gelo');
  assert.equal(gelo.meta, 10);
  assert.equal(gelo.total, 0);
  assert.equal(gelo.falta, 10);
  assert.deepEqual(b.minhas, []);
});

test('marcar, mudar e desmarcar quantidade; total e falta acompanham', async () => {
  const a = await convidado('Bia', 'Bia', 'zumbi');
  const b = await convidado('Caio', 'Caio', 'vampiro');
  const gelo = item(await lista(a.token), 'Gelo');

  assert.equal((await s.req('PUT', `/api/bebidas/itens/${gelo.id}`, { token: a.token, corpo: { quantidade: 4 } })).status, 200);
  const r = await s.req('PUT', `/api/bebidas/itens/${gelo.id}`, { token: b.token, corpo: { quantidade: 3 } });
  let g = item(r.json.bebidas, 'Gelo');
  assert.equal(g.total, 7);
  assert.equal(g.falta, 3);
  assert.deepEqual(g.quem.map((q) => [q.apelido, q.quantidade, q.souEu]), [['Bia', 4, false], ['Caio', 3, true]]);

  // Mudar não duplica
  await s.req('PUT', `/api/bebidas/itens/${gelo.id}`, { token: a.token, corpo: { quantidade: 8 } });
  g = item(await lista(a.token), 'Gelo');
  assert.equal(g.total, 11);
  assert.equal(g.falta, 0);
  assert.equal(g.quem.length, 2);

  // Zero remove
  await s.req('PUT', `/api/bebidas/itens/${gelo.id}`, { token: a.token, corpo: { quantidade: 0 } });
  const depois = await lista(a.token);
  assert.equal(item(depois, 'Gelo').total, 3);
  assert.ok(!depois.minhas.some((m) => m.nome === 'Gelo'));
  await s.req('PUT', `/api/bebidas/itens/${gelo.id}`, { token: b.token, corpo: { quantidade: 0 } });
});

test('quantidades inválidas e item inexistente são recusados', async () => {
  const c = await convidado('Duda', 'Duda', 'alien');
  const gelo = item(await lista(c.token), 'Gelo');
  for (const q of [-1, 100, 2.5, 'muito', null]) {
    assert.equal((await s.req('PUT', `/api/bebidas/itens/${gelo.id}`, { token: c.token, corpo: { quantidade: q } })).status, 400, `aceitou ${q}`);
  }
  assert.equal((await s.req('PUT', '/api/bebidas/itens/99999', { token: c.token, corpo: { quantidade: 1 } })).status, 404);
  assert.equal((await s.req('PUT', `/api/bebidas/itens/${gelo.id}`, { corpo: { quantidade: 1 } })).status, 401);
});

test('outra bebida: entra separada; nome igual a item da lista soma no item', async () => {
  const c = await convidado('Edu', 'Edu', 'caveira');
  let r = await s.req('POST', '/api/bebidas/outras', { token: c.token, corpo: { nome: 'Vinho tinto', quantidade: 2, unidade: 'garrafas' } });
  assert.equal(r.status, 200);
  const vinho = r.json.bebidas.outras.find((o) => o.nome === 'Vinho tinto');
  assert.equal(vinho.total, 2);
  assert.equal(vinho.unidade, 'garrafas');

  r = await s.req('POST', '/api/bebidas/outras', { token: c.token, corpo: { nome: 'gelo', quantidade: 2 } });
  assert.equal(item(r.json.bebidas, 'Gelo').quem.find((q) => q.souEu).quantidade, 2);
  assert.ok(!r.json.bebidas.outras.some((o) => o.nome.toLowerCase() === 'gelo'));

  assert.equal((await s.req('POST', '/api/bebidas/outras', { token: c.token, corpo: { nome: 'x', quantidade: 1 } })).status, 400);
  assert.equal((await s.req('POST', '/api/bebidas/outras', { token: c.token, corpo: { nome: 'Licor', quantidade: 0 } })).status, 400);
});

test('convidado só remove o que é dele', async () => {
  const a = await convidado('Fabi', 'Fabi', 'morcego');
  const b = await convidado('Gil', 'Gil', 'aranha');
  await s.req('POST', '/api/bebidas/outras', { token: a.token, corpo: { nome: 'Saquê', quantidade: 1 } });
  const minha = (await lista(a.token)).minhas.find((m) => m.nome === 'Saquê');
  assert.equal((await s.req('DELETE', `/api/bebidas/minhas/${minha.id}`, { token: b.token })).status, 404);
  assert.equal((await s.req('DELETE', `/api/bebidas/minhas/${minha.id}`, { token: a.token })).status, 200);
  assert.ok(!(await lista(a.token)).outras.some((o) => o.nome === 'Saquê'));
});

test('quem escolheu não aparecer vira "Alguém" para os outros, mas vê a si mesmo', async () => {
  const discreto = await convidado('Hugo', 'Hugão', 'demonio', false);
  const outro = await convidado('Iris', 'Iris', 'fantasma');
  const vodka = item(await lista(outro.token), 'Vodka');
  await s.req('PUT', `/api/bebidas/itens/${vodka.id}`, { token: discreto.token, corpo: { quantidade: 1 } });
  const visto = item(await lista(outro.token), 'Vodka').quem.find((q) => q.quantidade === 1 && !q.souEu);
  assert.equal(visto.apelido, 'Alguém');
  assert.equal(visto.avatar, null);
  const proprio = item(await lista(discreto.token), 'Vodka').quem.find((q) => q.souEu);
  assert.equal(proprio.apelido, 'Hugão');
  // Nome real nunca vai para o convidado
  assert.ok(!JSON.stringify(await lista(outro.token)).includes('Hugo'));
});

test('admin: cria, edita e exclui itens; exclusão preserva o que foi prometido', async () => {
  let r = await s.req('POST', '/api/admin/bebidas/itens', { token: admin, corpo: { nome: 'Whisky', unidade: 'garrafas', meta: 2 } });
  assert.equal(r.status, 201);
  const whisky = r.json.bebidas.itens.find((i) => i.nome === 'Whisky');
  assert.equal((await s.req('POST', '/api/admin/bebidas/itens', { token: admin, corpo: { nome: 'whisky' } })).status, 409);
  assert.equal((await s.req('PATCH', `/api/admin/bebidas/itens/${whisky.id}`, { token: admin, corpo: { meta: -3 } })).status, 400);
  r = await s.req('PATCH', `/api/admin/bebidas/itens/${whisky.id}`, { token: admin, corpo: { meta: 4 } });
  assert.equal(r.json.bebidas.itens.find((i) => i.id === whisky.id).meta, 4);

  const c = await convidado('João', 'Jota', 'lobisomem');
  await s.req('PUT', `/api/bebidas/itens/${whisky.id}`, { token: c.token, corpo: { quantidade: 1 } });
  // Admin vê o nome real
  const adm = (await s.req('GET', '/api/admin/bebidas', { token: admin })).json.bebidas;
  assert.equal(adm.itens.find((i) => i.id === whisky.id).quem[0].nome, 'João');

  await s.req('DELETE', `/api/admin/bebidas/itens/${whisky.id}`, { token: admin });
  const b = await lista(c.token);
  assert.ok(!b.itens.some((i) => i.nome === 'Whisky'));
  assert.equal(b.outras.find((o) => o.nome === 'Whisky').total, 1);
  assert.equal(b.minhas.find((m) => m.nome === 'Whisky').quantidade, 1);

  // Convidado não acessa rotas de admin
  assert.equal((await s.req('POST', '/api/admin/bebidas/itens', { token: c.token, corpo: { nome: 'Rum' } })).status, 401);
});

test('admin fecha a lista: convidado vê, mas não muda; reabre', async () => {
  const c = await convidado('Kika', 'Kika', 'palhaco');
  const agua = item(await lista(c.token), 'Água');
  await s.req('PUT', '/api/admin/bebidas/aberta', { token: admin, corpo: { aberta: false } });
  const b = await lista(c.token);
  assert.equal(b.aberta, false);
  assert.equal((await s.req('PUT', `/api/bebidas/itens/${agua.id}`, { token: c.token, corpo: { quantidade: 1 } })).status, 403);
  await s.req('PUT', '/api/admin/bebidas/aberta', { token: admin, corpo: { aberta: true } });
  assert.equal((await s.req('PUT', `/api/bebidas/itens/${agua.id}`, { token: c.token, corpo: { quantidade: 1 } })).status, 200);
});

test('limite de bebidas por convidado', async () => {
  const c = await convidado('Leo', 'Leo', 'abobora');
  for (let i = 0; i < 15; i++) {
    const r = await s.req('POST', '/api/bebidas/outras', { token: c.token, corpo: { nome: `Bebida ${i + 1}`, quantidade: 1 } });
    assert.equal(r.status, 200);
  }
  assert.equal((await s.req('POST', '/api/bebidas/outras', { token: c.token, corpo: { nome: 'Bebida 16', quantidade: 1 } })).status, 400);
});

test('mudança na lista avisa os outros celulares em tempo real', async () => {
  const a = await convidado('Mia', 'Mia', 'vampiro');
  const b = await convidado('Nico', 'Nico', 'zumbi');
  const sock = await s.conectar({ tipo: 'convidado', token: b.token });
  const chegou = proximoEvento(sock, 'atualizar');
  const cerveja = item(await lista(a.token), 'Cerveja');
  await s.req('PUT', `/api/bebidas/itens/${cerveja.id}`, { token: a.token, corpo: { quantidade: 12 } });
  assert.equal((await chegou).oque, 'bebidas');
  sock.close();
});

test('excluir convidado leva junto o que ele prometeu; backup inclui a lista', async () => {
  const c = await convidado('Otto', 'Otto', 'caveira');
  const gin = item(await lista(c.token), 'Gin');
  await s.req('PUT', `/api/bebidas/itens/${gin.id}`, { token: c.token, corpo: { quantidade: 2 } });

  const copia = await (await s.req('GET', '/api/admin/backup', { token: admin, cru: true })).json();
  assert.ok(copia.tabelas.bebidas_itens.length > 0);
  assert.ok(copia.tabelas.bebidas_compromissos.some((x) => x.convidado_id === c.id));

  await s.req('DELETE', `/api/admin/convidados/${c.id}`, { token: admin });
  let adm = (await s.req('GET', '/api/admin/bebidas', { token: admin })).json.bebidas;
  assert.equal(adm.itens.find((i) => i.nome === 'Gin').total, 0);

  assert.equal((await s.req('POST', '/api/admin/restaurar', { token: admin, corpo: copia })).status, 200);
  adm = (await s.req('GET', '/api/admin/bebidas', { token: admin })).json.bebidas;
  assert.equal(adm.itens.find((i) => i.nome === 'Gin').total, 2);
});
