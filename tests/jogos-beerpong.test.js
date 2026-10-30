// Beer Pong: times de 3 (mínimo 2), chave com bye, só o organizador marca, pontos de campeão e vice.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { criarAjudas } = require('./jogos-ajuda');
const bp = require('../server/dados/beerpong');

test('times: de 3 em 3; quem sobra sozinho ganha companhia; ninguém fica de fora', () => {
  for (let n = 4; n <= 40; n++) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const times = bp.montarTimes(ids);
    assert.ok(times.every((t) => t.membros.length >= 2 && t.membros.length <= 3), `${n}: ${times.map((t) => t.membros.length)}`);
    assert.equal(times.flatMap((t) => t.membros).length, n);
    assert.equal(new Set(times.flatMap((t) => t.membros)).size, n);
    const { partidas, rodadas } = bp.montarChave(times);
    assert.equal(2 ** rodadas >= times.length, true);
    const r1 = partidas.filter((p) => p.rodada === 1);
    assert.equal(new Set(r1.flatMap((p) => [p.a, p.b]).filter(Boolean)).size, times.length, 'todos na chave');
    // Bye só para quem tem menos gente primeiro
    const byes = r1.filter((p) => p.bye).map((p) => times.find((t) => t.id === p.vencedor).membros.length);
    const menores = times.filter((t) => t.membros.length === 2).length;
    if (byes.length && menores) assert.ok(byes.filter((x) => x === 2).length === Math.min(byes.length, menores), `${n}: bye para os times menores`);
    // Nenhuma partida da 1ª rodada sem ninguém
    assert.ok(r1.every((p) => p.a || p.b));
  }
});

let s; let admin; let h;
const gente = [];
test.before(async () => {
  s = await subir(); admin = await s.tokenAdmin(); h = criarAjudas(s, admin);
  for (let i = 0; i < 7; i++) gente.push(await h.convidado(`Jogador ${i + 1}`));
});
test.after(async () => { await s.fechar(); });

const adm = (url) => s.req('POST', `/api/admin/beerpong/${url}`, { token: admin });
const inscrever = (c, quero = true) => s.req('PUT', '/api/beerpong/inscricao', { token: c.token, corpo: { quero } });
const jogos = async () => (await s.req('GET', '/api/admin/jogos', { token: admin })).json.beerpong;

test('fluxo: inscrição, sorteio (7 → 3+2+2, um bye), só o admin marca, telão mostra quem avançou, pontos no fim', async () => {
  assert.equal((await inscrever(gente[0])).status, 403);
  await h.liberar('beerpong');
  for (const c of gente.slice(0, 3)) assert.equal((await inscrever(c)).status, 200);
  assert.equal((await adm('sortear')).status, 409, 'menos de 4: não sorteia');
  for (const c of gente.slice(3)) await inscrever(c);
  assert.equal((await jogos()).inscritos.length, 7);
  assert.equal((await adm('sortear')).status, 200);
  assert.equal((await inscrever(gente[0], false)).status, 409, 'sorteado: inscrição fechada');
  const tel = (await s.req('GET', '/api/admin/telao', { token: admin })).json;
  assert.equal(tel.telao.modo, 'beerpong', 'telão troca sozinho para o sorteio');
  assert.equal(tel.beerpong.revelacao.length, 7);
  const ch = tel.beerpong.chave;
  assert.deepEqual(ch.times.map((t) => t.membros.length).sort(), [2, 2, 3]);
  assert.equal(ch.rodadas, 2);
  const bye = ch.partidas.find((p) => p.rodada === 1 && p.bye);
  assert.ok(bye && ch.times.find((t) => t.id === bye.vencedor).membros.length === 2, 'bye para time de 2');
  // Convidado não marca resultado
  const r1 = ch.partidas.find((p) => p.rodada === 1 && !p.bye);
  assert.equal((await s.req('POST', `/api/admin/beerpong/partida/${r1.id}/a`, { token: gente[0].token })).status, 401);
  // Final ainda sem dois times: não dá para marcar
  const final = ch.partidas.find((p) => p.rodada === 2);
  assert.equal((await adm(`partida/${final.id}/a`)).status, 409);
  assert.equal((await adm(`partida/${r1.id}/a`)).status, 200);
  let tel2 = (await s.req('GET', '/api/admin/telao', { token: admin })).json.beerpong;
  assert.equal(tel2.chave.ultimo.time, r1.a, 'telão sabe quem acabou de avançar');
  assert.ok([tel2.chave.partidas.find((p) => p.id === final.id).a, tel2.chave.partidas.find((p) => p.id === final.id).b].includes(r1.a));
  // Desfazer a semi com a final sem resultado: pode
  assert.equal((await adm(`desfazer/${r1.id}`)).status, 200);
  assert.equal((await adm(`partida/${r1.id}/b`)).status, 200);
  tel2 = (await s.req('GET', '/api/admin/telao', { token: admin })).json.beerpong;
  const f = tel2.chave.partidas.find((p) => p.id === final.id);
  assert.ok(f.a && f.b);
  assert.equal((await adm(`partida/${final.id}/a`)).status, 200);
  assert.equal((await adm(`desfazer/${r1.id}`)).status, 409, 'final decidida: não desfaz a semi');
  const fim = await jogos();
  assert.equal(fim.estado, 'fim');
  // Pontos: campeões +1000, vice +500 (por pessoa)
  const banco = require('../server/dados/banco');
  const cfg = await bp.config();
  const membros = (id) => cfg.times.find((t) => t.id === id).membros;
  const pts = async (id) => Number((await banco.um("SELECT COALESCE(SUM(pontos), 0) AS p FROM pontos_log WHERE atividade = 'beerpong' AND convidado_id = ?", [id])).p);
  for (const m of membros(f.a)) assert.equal(await pts(m), 1000);
  for (const m of membros(f.b)) assert.equal(await pts(m), 500);
  const cel = (await s.req('GET', '/api/festa', { token: gente[0].token })).json.beerpong;
  assert.ok(cel.meuTime && cel.resultado);
  // Desfazer a final tira os pontos
  assert.equal((await adm(`desfazer/${final.id}`)).status, 200);
  for (const m of membros(f.a)) assert.equal(await pts(m), 0);
  // Recomeçar volta às inscrições (inscritos continuam)
  assert.equal((await adm('recomecar')).status, 200);
  const j = await jogos();
  assert.equal(j.estado, 'inscricao');
  assert.equal(j.inscritos.length, 7);
});
