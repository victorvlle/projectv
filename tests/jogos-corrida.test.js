// Corrida de Cavalos: regras do baralho, apostas, largada, fim automático e pontos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { criarAjudas } = require('./jogos-ajuda');
const corrida = require('../server/dados/corrida');
const festa = require('../server/dados/festa');

test('simulação segue as regras: o vencedor passa da última casa; laterais só viram quando todos passam', () => {
  for (let k = 0; k < 500; k++) {
    const s = corrida.simular();
    const pos = { espadas: 0, copas: 0, ouros: 0, paus: 0 };
    const viradas = new Set();
    for (const e of s.eventos) {
      if (e.tipo === 'anda') pos[e.naipe] += 1;
      else {
        assert.ok(Math.min(...Object.values(pos)) >= e.casa, 'lateral só vira quando todos passaram da casa');
        assert.ok(!viradas.has(e.casa));
        viradas.add(e.casa);
        assert.equal(e.naipe, s.laterais[e.casa - 1].naipe);
        if (pos[e.naipe] > 0) pos[e.naipe] -= 1;
      }
    }
    assert.equal(pos[s.ordem[0]], corrida.CHEGADA, 'o 1º cruzou a chegada');
    assert.equal(s.ordem.length, 4);
    assert.equal(new Set(s.ordem).size, 4);
    assert.ok(Object.entries(pos).every(([n, p]) => n === s.ordem[0] || p < corrida.CHEGADA), 'só um cruzou');
    assert.ok(s.ultimos.length >= 1 && !s.ultimos.includes(s.ordem[0]));
    const ultimaCarta = s.eventos[s.eventos.length - 1];
    assert.equal(ultimaCarta.tipo, 'anda');
    assert.equal(ultimaCarta.naipe, s.ordem[0], 'a corrida acaba na carta do vencedor');
  }
});

let s; let admin; let h;
const gente = [];
test.before(async () => {
  s = await subir(); admin = await s.tokenAdmin(); h = criarAjudas(s, admin);
  for (const n of ['Ana Corre', 'Beto Corre', 'Carla Corre', 'Duda Corre']) gente.push(await h.convidado(n));
});
test.after(async () => { await s.fechar(); });

const apostar = (c, naipe) => s.req('PUT', '/api/corrida/aposta', { token: c.token, corpo: { naipe } });
const adm = (url) => s.req('POST', `/api/admin/corrida/${url}`, { token: admin });
const telao = async () => (await s.req('GET', '/api/admin/telao', { token: admin })).json;

test('apostas: só com a corrida aberta; troca de cavalo; depois da largada, não', async () => {
  assert.equal((await apostar(gente[0], 'copas')).status, 403);
  await h.liberar('corrida');
  assert.equal((await apostar(gente[0], 'copas')).status, 409, 'apostas ainda não abertas');
  assert.equal((await adm('largar')).status, 409);
  assert.equal((await adm('apostas')).status, 200);
  assert.equal((await telao()).telao.modo, 'corrida', 'telão troca sozinho');
  assert.equal((await apostar(gente[0], 'coringa')).status, 400);
  assert.equal((await apostar(gente[0], 'paus')).status, 200);
  assert.equal((await apostar(gente[0], 'copas')).status, 200, 'pode trocar');
  for (const [i, n] of ['espadas', 'ouros', 'paus'].entries()) await apostar(gente[i + 1], n);
  const t = await telao();
  assert.equal(t.corrida.total, 4);
  assert.equal(t.corrida.apostas.copas.length, 1);
  assert.equal(t.corrida.eventos, undefined, 'o roteiro só existe depois da largada');
  assert.equal((await adm('largar')).status, 200);
  assert.equal((await apostar(gente[0], 'espadas')).status, 409, 'largou: aposta trancada');
  const c = (await telao()).corrida;
  assert.equal(c.estado, 'correndo');
  assert.ok(c.eventos.length >= corrida.CHEGADA);
  assert.equal(c.laterais.length, corrida.CASAS);
});

test('fim: pontos para 1º (+500) e 2º (+200); quem apostou no último toma um shot', async () => {
  // Pula a animação: a corrida "começou" há muito tempo.
  const cfg = await corrida.config();
  await festa.gravar('corrida', { ...cfg, inicioEm: Date.now() - 10 * 60 * 1000 });
  const t = (await telao()).corrida;
  assert.equal(t.estado, 'fim');
  const naipeDe = { 0: 'copas', 1: 'espadas', 2: 'ouros', 3: 'paus' };
  for (const [i, c] of gente.entries()) {
    const lugar = cfg.ordem.indexOf(naipeDe[i]) + 1;
    const esperado = lugar === 1 ? 500 : lugar === 2 ? 200 : 0;
    assert.equal(await h.pontosDe(c.token), esperado, `${c.nome} apostou no ${lugar}º`);
    const r = (await s.req('GET', '/api/festa', { token: c.token })).json.corrida.resultado;
    assert.equal(r.lugar, lugar);
    assert.equal(r.shot, cfg.ultimos.includes(naipeDe[i]));
  }
  assert.ok(t.ganhadores.length === 1);
  assert.ok(t.shot.length >= 1);
  // Ler de novo não dá ponto duas vezes
  await telao();
  assert.ok((await h.pontosDe(gente[0].token)) <= 500);
  // Nova rodada
  assert.equal((await adm('apostas')).status, 200);
  assert.equal((await corrida.config()).rodada, 2);
  assert.equal((await adm('cancelar')).status, 200);
  assert.equal((await corrida.config()).rodada, 1);
});
