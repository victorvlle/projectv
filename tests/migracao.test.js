// Banco criado antes da mudança de horário (padrão antigo 21h, sem fim) é
// atualizado sozinho para 17h-00h; horário mudado pelo admin é respeitado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-migra-'));
process.env.BANCO_CAMINHO = path.join(pasta, 'antigo.db');
const banco = require('../server/dados/banco');
const festa = require('../server/dados/festa');

async function voltarParaVersao1(inicio) {
  await banco.rodar('UPDATE esquema SET versao = 1');
  await banco.rodar("DELETE FROM config WHERE chave = 'fim'");
  await banco.rodar("UPDATE config SET valor = ? WHERE chave = 'inicio'", [JSON.stringify(inicio)]);
  await banco.fechar();
  await banco.abrir();
}

test.after(async () => { await banco.fechar(); fs.rmSync(pasta, { recursive: true, force: true }); });

test('banco com o padrão antigo (21h) passa para 17h às 00h', async () => {
  await banco.abrir();
  await voltarParaVersao1('2026-10-31T21:00:00-04:00');
  const f = await festa.info();
  assert.equal(f.inicio, '2026-10-31T17:00:00-04:00');
  assert.equal(f.fim, '2026-11-01T00:00:00-04:00');
});

test('horário escolhido pelo admin não é sobrescrito', async () => {
  await voltarParaVersao1('2026-10-31T19:30:00-04:00');
  const f = await festa.info();
  assert.equal(f.inicio, '2026-10-31T19:30:00-04:00');
  assert.equal(f.fim, '2026-11-01T00:00:00-04:00');
});

test('lista de bebidas antiga recebe as metas do organizador sem perder promessas', async () => {
  // Volta o banco para antes do ajuste (versão 3) com a lista antiga e uma promessa de Gelo
  await banco.rodar("DELETE FROM bebidas_compromissos");
  await banco.rodar("DELETE FROM bebidas_itens");
  const antigas = [['Cerveja', 'latas', 72], ['Vodka', 'garrafas', 3], ['Tequila (para os shots)', 'garrafas', 2],
    ['Cachaça', 'garrafas', 2], ['Gin', 'garrafas', 2], ['Energético', 'latas', 18],
    ['Refrigerante', 'garrafas de 2 L', 6], ['Suco', 'litros', 4], ['Água', 'garrafas de 1,5 L', 6], ['Gelo', 'sacos', 10]];
  for (const [i, [nome, unidade, meta]] of antigas.entries()) {
    await banco.rodar('INSERT INTO bebidas_itens (nome, unidade, meta, ordem, criado_em) VALUES (?, ?, ?, ?, ?)', [nome, unidade, meta, i, Date.now()]);
  }
  await banco.rodar("INSERT INTO convidados (id, nome, codigo, avatar, criado_em, atualizado_em) VALUES ('c1', 'Zé', 'abcdefghjk', 'zumbi', 1, 1)");
  const gelo = await banco.um("SELECT id FROM bebidas_itens WHERE nome = 'Gelo'");
  await banco.rodar('INSERT INTO bebidas_compromissos (convidado_id, item_id, quantidade, criado_em, atualizado_em) VALUES (?, ?, 4, 1, 1)', ['c1', gelo.id]);
  await banco.rodar('UPDATE esquema SET versao = 3');
  await banco.fechar();
  await banco.abrir();

  const itens = await banco.tudo('SELECT nome, unidade, meta FROM bebidas_itens ORDER BY ordem');
  assert.deepEqual(itens.map((i) => [i.nome, i.unidade, Number(i.meta)]), [
    ['Cerveja', 'longnecks', 20], ['Vodka', 'garrafas', 3], ['Tequila (para os shots)', 'garrafas', 1],
    ['Cachaça', 'garrafas', 2], ['Gin', 'garrafas', 3], ['Energético Tropical', 'garrafas de 2 L', 3],
    ['Refrigerante', 'garrafas de 2 L', 3],
  ]);
  const promessa = await banco.um("SELECT * FROM bebidas_compromissos WHERE convidado_id = 'c1'");
  assert.equal(promessa.item_id, null);
  assert.equal(promessa.nome_livre, 'Gelo');
  assert.equal(promessa.unidade_livre, 'sacos');
  assert.equal(Number(promessa.quantidade), 4);
});
