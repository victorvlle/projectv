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
    // Confrontos de verdade em cima; bye ao lado de um confronto sempre que der (enfrenta um vencedor)
    const tipos = r1.map((p) => (p.bye ? 'B' : 'R'));
    const primeiroBye = tipos.indexOf('B');
    if (primeiroBye >= 0) {
      const nR = tipos.filter((x) => x === 'R').length; const nB = tipos.length - nR;
      const mistos = r1.length === 1 ? 0 : Array.from({ length: r1.length / 2 }, (_, i) => tipos[2 * i] !== tipos[2 * i + 1]).filter(Boolean).length;
      if (r1.length > 1) assert.equal(mistos, Math.min(nR, nB), `${n}: byes contra vencedores (${tipos.join('')})`);
      assert.ok(tipos.slice(0, Math.max(0, nR - Math.min(nR, nB))).every((x) => x === 'R'), `${n}: confrontos em cima (${tipos.join('')})`);
    }
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
  // Enquanto o telão mostra o sorteio, o celular não conta o time (sem spoiler)
  const durante = (await s.req('GET', '/api/festa', { token: gente[0].token })).json.beerpong;
  assert.equal(durante.estado, 'sorteando');
  assert.equal(durante.meuTime, undefined);
  const cfgBp = await bp.config();
  await require('../server/dados/festa').gravar('beerpong', { ...cfgBp, sorteioEm: cfgBp.sorteioEm - 10 * 60 * 1000 });
  assert.ok((await s.req('GET', '/api/festa', { token: gente[0].token })).json.beerpong.meuTime, 'depois do telão, o celular mostra o time');
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

test('fakes: só em teste, de 0 a 28, entram no sorteio, não ganham pontos e somem fora do teste', async () => {
  const banco = require('../server/dados/banco');
  const put = (quantos) => s.req('PUT', '/api/admin/beerpong/fakes', { token: admin, corpo: { quantos } });
  assert.equal((await put(5)).status, 409, 'liberado (não teste): sem fakes');
  await h.liberar('beerpong', 'teste');
  assert.equal((await put(29)).status, 400);
  assert.equal((await put(-1)).status, 400);
  assert.equal((await put(28)).status, 200);
  let j = await jogos();
  assert.equal(j.fakes, 28);
  const reais = j.inscritos.filter((p) => !p.fake).length;
  assert.equal(j.inscritos.length, reais + 28);
  assert.equal((await s.req('DELETE', `/api/admin/beerpong/inscritos/fake-01`, { token: admin })).status, 409);
  // Diminui para 9 e sorteia
  assert.equal((await put(9)).status, 200);
  assert.equal((await adm('sortear')).status, 200);
  assert.equal((await put(3)).status, 409, 'sorteado: não muda');
  const tel = (await s.req('GET', '/api/admin/telao', { token: admin })).json.beerpong;
  assert.equal(tel.revelacao.length, reais + 9);
  assert.ok(tel.revelacao.some((r) => r.nome === 'Drácula'), 'fake aparece no telão');
  // Marca tudo até o fim: fakes não ganham pontos (e nada quebra)
  for (;;) {
    const ch = (await jogos()).chave;
    const p = ch.partidas.find((x) => x.a && x.b && !x.vencedor);
    if (!p) break;
    assert.equal((await adm(`partida/${p.id}/a`)).status, 200);
  }
  const fakesComPontos = await banco.um("SELECT COUNT(*) AS n FROM pontos_log WHERE convidado_id LIKE 'fake-%'");
  assert.equal(Number(fakesComPontos.n), 0);
  // Ranking e lista de convidados não têm fakes
  const rank = (await s.req('GET', '/api/ranking', { token: gente[0].token })).json.ranking;
  assert.ok(!JSON.stringify(rank).includes('Fake'));
  // Recomeçar mantém a quantidade
  assert.equal((await adm('recomecar')).status, 200);
  assert.equal((await jogos()).fakes, 9);
  // Fora do teste, os fakes não contam
  await h.liberar('beerpong');
  j = await jogos();
  assert.equal(j.fakes, 0);
  assert.ok(j.inscritos.every((p) => !p.fake));
  // Apagar dados de teste zera
  await h.liberar('beerpong', 'teste');
  assert.equal((await jogos()).fakes, 9);
  await s.req('POST', '/api/admin/teste/apagar', { token: admin });
  await h.liberar('beerpong', 'teste');
  assert.equal((await jogos()).fakes, 0);
});
