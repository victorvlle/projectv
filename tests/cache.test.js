// Páginas e scripts não podem ficar presos em cache depois de um deploy.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

test('HTML, JS e CSS saem com Cache-Control: no-cache', async () => {
  const s = await subir();
  try {
    for (const caminho of ['/', '/c/abcdefghjk', '/admin', '/telao', '/convidado/convidado.js', '/comum/base.css', '/comum/api.js']) {
      const r = await s.req('GET', caminho, { cru: true });
      assert.equal(r.status, 200, caminho);
      assert.equal(r.headers.get('cache-control'), 'no-cache', caminho);
    }
  } finally {
    await s.fechar();
  }
});
