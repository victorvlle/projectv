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
