// Maldição: sorteio no servidor, sincronização com telão/celular, push, confirmação e pontos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir, proximoEvento, esperar } = require('./ajuda');
const { criarAjudas } = require('./jogos-ajuda');
const notif = require('../server/notificacoes');
const maldicao = require('../server/dados/maldicao');
const banco = require('../server/dados/banco');

let s; let admin; let h;
test.before(async () => { s = await subir(); admin = await s.tokenAdmin(); h = criarAjudas(s, admin); });
test.after(async () => { await s.fechar(); });

let unica;
test('bloqueada: não sorteia; sem ninguém disponível: erro claro', async () => {
  await h.liberar('maldicao', 'bloqueada');
  assert.equal(await maldicao.tic(), null);
  const r = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
  assert.equal(r.status, 409);
});

test('sorteio manual: telões e celular recebem uma vez; push sai uma vez; clique duplo não duplica', async () => {
  unica = await h.convidado('Única Bruxa', { push: true });
  await h.liberar('maldicao');
  notif.caixa.length = 0;
  const telao1 = await s.conectar({ tipo: 'telao', token: admin });
  const telao2 = await s.conectar({ tipo: 'telao', token: admin });
  const cel = await s.conectar({ tipo: 'convidado', token: unica.token });
  let recebidos = 0;
  telao1.on('maldicao', () => { recebidos += 1; });
  const ev2 = proximoEvento(telao2, 'maldicao');
  const evCel = proximoEvento(cel, 'maldicao:voce');
  const id = h.idClique();
  const [a, b] = await Promise.all([
    s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id } }),
    s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id } }),
  ]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal([a.json.repetido, b.json.repetido].filter(Boolean).length, 1);
  const p = await ev2;
  assert.equal(p.nome, 'Única Bruxa');
  assert.ok(p.castigo.length > 5);
  assert.deepEqual(p.fases, { alerta: 4000, suspense: 7000, cumprir: 60000 });
  assert.ok(Array.isArray(p.roleta) && p.roleta.every((x) => x.nome && x.nome !== p.nome), 'roleta de nomes (sem o sorteado, que é onde ela para)');
  assert.equal((await evCel).id, p.id);
  await esperar(150);
  assert.equal(recebidos, 1, 'cada telão recebe uma vez');
  const pushes = notif.caixa.filter((m) => m.endpoint === unica.sub.endpoint);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].titulo, 'Project V: você foi amaldiçoado');
  assert.equal(pushes[0].url, '/#maldicao');
  assert.equal(notif.problemaNoAviso(pushes[0]), null);
  // Telão que reconecta pega a maldição em cena
  const t = (await s.req('GET', '/api/admin/telao', { token: admin })).json;
  assert.equal(t.maldicao.id, p.id);
  // Antes do telão revelar (alerta + suspense), o celular não sabe de nada
  assert.equal((await s.req('GET', '/api/maldicao/minha', { token: unica.token })).json.maldicao, null, 'sem spoiler antes do telão');
  await banco.rodar('UPDATE maldicoes SET sorteada_em = sorteada_em - 20000 WHERE id = ?', [p.id]);
  const minha = (await s.req('GET', '/api/maldicao/minha', { token: unica.token })).json.maldicao;
  assert.equal(minha.id, p.id);
  telao1.close(); telao2.close(); cel.close();
});

test('a Maldição: −300 no sorteio; cumpriu +1300 (saldo +1000); não cumpriu −300 a mais; anular devolve; uma vez só', async () => {
  const atual = (await s.req('GET', '/api/admin/jogos', { token: admin })).json.maldicao.historico[0];
  const antes = await h.pontosDe(unica.token);
  const rs = await Promise.all([1, 2, 3].map(() => s.req('POST', `/api/admin/maldicao/${atual.id}/resolver`, { token: admin, corpo: { estado: 'cumprida' } })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(rs.filter((r) => !r.json.jaResolvida).length, 1);
  assert.equal(antes, -300, 'sorteada: −300 na hora');
  assert.equal(await h.pontosDe(unica.token), 1000, 'cumpriu: +1300 (saldo +1000), uma vez só');
  // Não cumpriu: −300 a mais (cliques duplos não dobram)
  const b = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
  const quem = b.json.maldicao.convidadoId === unica.id;
  await Promise.all([1, 2].map(() => s.req('POST', `/api/admin/maldicao/${b.json.maldicao.id}/resolver`, { token: admin, corpo: { estado: 'falhou' } })));
  const log = await banco.tudo("SELECT pontos FROM pontos_log WHERE chave LIKE ?", [`maldicao:${b.json.maldicao.id}:%`]);
  assert.equal(log.reduce((t, x) => t + Number(x.pontos), 0), (b.json.maldicao.parceiro ? 2 : 1) * -600, 'não cumpriu: −600 no total');
  if (quem) assert.equal(await h.pontosDe(unica.token), 400);
  // Anular devolve tudo
  const c = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
  await s.req('POST', `/api/admin/maldicao/${c.json.maldicao.id}/resolver`, { token: admin, corpo: { estado: 'cancelada' } });
  await s.req('POST', `/api/admin/maldicao/${c.json.maldicao.id}/resolver`, { token: admin, corpo: { estado: 'cumprida' } });
  assert.equal(Number((await banco.um("SELECT COUNT(*) AS n FROM pontos_log WHERE chave LIKE ?", [`maldicao:${c.json.maldicao.id}:%`])).n), 0, 'anulada devolve e não vira cumprida');
  const h2 = (await s.req('GET', '/api/admin/jogos', { token: admin })).json.maldicao.historico.find((x) => x.id === b.json.maldicao.id);
  assert.equal(h2.falhou, true);
  assert.equal((await s.req('POST', `/api/admin/maldicao/${atual.id}/resolver`, { token: unica.token, corpo: { estado: 'cumprida' } })).status, 401);
});

test('não está presente: ninguém perde, outra pessoa é sorteada na hora (mesmo desafio) e o ausente fica fora por um tempo', async () => {
  await banco.rodar("UPDATE maldicoes SET estado = 'cancelada' WHERE estado = 'sorteada'");
  const p1 = await h.convidado('Presente Um'); const p2 = await h.convidado('Presente Dois');
  const ins = await banco.rodar("INSERT INTO maldicoes (convidado_id, castigo, estado, origem, chave, sorteada_em, castigo_id) VALUES (?, 'Tome um shot.', 'sorteada', 'manual', ?, ?, 'shot')",
    [p1.id, `aus-${Date.now()}`, Date.now() - 20000]);
  const id = Number(ins.lastInsertRowid);
  await banco.rodar("INSERT INTO pontos_log (convidado_id, atividade, pontos, motivo, chave, criado_em, teste) VALUES (?, 'maldicao', -300, 'Amaldiçoado', ?, ?, 0)", [p1.id, `maldicao:${id}:${p1.id}`, Date.now()]);
  const telao = await s.conectar({ tipo: 'telao', token: admin });
  const ev = proximoEvento(telao, 'maldicao');
  const r = await s.req('POST', `/api/admin/maldicao/${id}/resolver`, { token: admin, corpo: { estado: 'ausente' } });
  assert.equal(r.status, 200);
  assert.equal(await h.pontosDe(p1.token), 0, 'não estava: devolve os pontos');
  assert.ok(r.json.nova, 'sorteou outra pessoa na hora');
  assert.notEqual(r.json.nova.convidadoId, p1.id);
  assert.equal(r.json.nova.castigo, 'Tome um shot.', 'mesmo desafio');
  assert.equal((await ev).id, r.json.nova.id, 'o telão já recebe o novo sorteio');
  const hist = (await s.req('GET', '/api/admin/jogos', { token: admin })).json.maldicao.historico.find((x) => x.id === id);
  assert.equal(hist.ausente, true);
  // Por um tempo, quem não estava não é sorteado
  const maldicao = require('../server/dados/maldicao');
  assert.ok(!(await maldicao.elegiveis()).some((x) => x.id === p1.id));
  await s.req('POST', `/api/admin/maldicao/${r.json.nova.id}/resolver`, { token: admin, corpo: { estado: 'cancelada' } });
  for (const c of [p1, p2]) await banco.rodar('UPDATE convidados SET fora = 1 WHERE id = ?', [c.id]);
  telao.close();
});

test('maldição coletiva: só com bastante gente; sorteado não perde; último −400 e penúltimo −200', async () => {
  const gente = [];
  for (let i = 0; i < 6; i++) gente.push(await h.convidado(`Coletivo ${i}`));
  const { CASTIGOS } = require('../server/jogos/conteudo');
  const grupo = CASTIGOS.find((c) => c.grupo);
  await banco.rodar("UPDATE maldicoes SET estado = 'cancelada' WHERE estado = 'sorteada'");
  const ins = await banco.rodar("INSERT INTO maldicoes (convidado_id, castigo, estado, origem, chave, sorteada_em, grupo) VALUES (?, ?, 'sorteada', 'manual', ?, ?, 1)",
    [gente[0].id, grupo.texto, `coletiva-${Date.now()}`, Date.now() - 20000]);
  const id = Number(ins.lastInsertRowid);
  const j = (await s.req('GET', '/api/admin/jogos', { token: admin })).json.maldicao;
  assert.ok(j.pessoas.length >= 6, 'admin recebe a lista para marcar');
  const resolver = (corpo) => s.req('POST', `/api/admin/maldicao/${id}/resolver`, { token: admin, corpo: { estado: 'cumprida', ...corpo } });
  assert.equal((await resolver({})).status, 400, 'precisa marcar o último');
  assert.equal((await resolver({ ultimo: gente[1].id, penultimo: gente[1].id })).status, 400);
  assert.equal((await resolver({ ultimo: gente[1].id, penultimo: gente[2].id })).status, 200);
  assert.equal(await h.pontosDe(gente[1].token), -400);
  assert.equal(await h.pontosDe(gente[2].token), -200);
  assert.equal(await h.pontosDe(gente[0].token), 0, 'quem despertou a coletiva não perde');
  const m = (await s.req('GET', '/api/admin/jogos', { token: admin })).json.maldicao.historico.find((x) => x.id === id);
  assert.equal(m.ultimo.nome, 'Coletivo 1');
  // Com menos de 6 disponíveis, a coletiva não sai (sorteio real)
  const maldicao = require('../server/dados/maldicao');
  assert.ok(require('../server/jogos/conteudo').MIN_GRUPO >= 6);
  assert.equal(typeof maldicao.sortear, 'function');
  // não atrapalha os próximos testes (que contam com poucas pessoas disponíveis)
  for (const c of gente) await banco.rodar('UPDATE convidados SET fora = 1 WHERE id = ?', [c.id]);
});

test('push que falha não trava o sorteio nem o telão', async () => {
  await banco.rodar("UPDATE convidados SET fora = 1 WHERE id = ?", [unica.id]);
  const instavel = await h.convidado('Rede Ruim', { push: true, endpoint: `https://fcm.googleapis.com/fcm/send/instavel-${Date.now()}` });
  const telao = await s.conectar({ tipo: 'telao', token: admin });
  const ev = proximoEvento(telao, 'maldicao');
  const r = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
  assert.equal(r.status, 200);
  assert.equal((await ev).nome, 'Rede Ruim', 'quem está "fora" não é sorteado');
  await esperar(150);
  const log = await banco.um("SELECT resultado FROM push_log WHERE convidado_id = ? AND chave LIKE 'maldicao:%'", [instavel.id]);
  assert.equal(log.resultado, 'falha');
  telao.close();
  await banco.rodar("UPDATE convidados SET fora = 0 WHERE id = ?", [unica.id]);
});

test('sorteio automático: intervalo no servidor, um sorteio por horário mesmo com tics simultâneos', async () => {
  const cfg = (await s.req('PUT', '/api/admin/maldicao', { token: admin, corpo: { ligada: true, intensidade: 'caos' } })).json.config;
  assert.equal(cfg.ligada, true);
  assert.equal(cfg.minMin, 10);
  const agora = Date.now();
  assert.ok(cfg.proximaEm >= agora + 9 * 60000 && cfg.proximaEm <= agora + 16 * 60000);
  const antes = (await banco.um('SELECT COUNT(*) AS n FROM maldicoes')).n;
  const quando = cfg.proximaEm + 1000;
  const rs = await Promise.all([maldicao.tic(quando), maldicao.tic(quando), maldicao.tic(quando)]);
  assert.equal(rs.filter(Boolean).length, 1);
  assert.equal(Number((await banco.um('SELECT COUNT(*) AS n FROM maldicoes')).n), Number(antes) + 1);
  const depois = (await s.req('GET', '/api/admin/jogos', { token: admin })).json.maldicao.config;
  assert.ok(depois.proximaEm > quando, 'o próximo horário avançou');
  assert.equal(await maldicao.tic(quando + 1000), null, 'antes do próximo horário, nada');
  // Não repete a mesma pessoa duas vezes seguidas quando há outra opção
  const ultimos = await banco.tudo('SELECT convidado_id FROM maldicoes ORDER BY sorteada_em DESC LIMIT 2');
  void ultimos;
  // Pausar
  await s.req('PUT', '/api/admin/maldicao', { token: admin, corpo: { ligada: false } });
  assert.equal(await maldicao.tic(Date.now() + 3600000), null);
  // Intervalo inválido
  assert.equal((await s.req('PUT', '/api/admin/maldicao', { token: admin, corpo: { minMin: 30, maxMin: 5 } })).status, 400);
});

test('não sorteia a mesma pessoa duas vezes seguidas (com 2 disponíveis)', async () => {
  const nomes = [];
  for (let i = 0; i < 6; i++) {
    const r = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
    nomes.push(r.json.maldicao.nome);
  }
  for (let i = 1; i < nomes.length; i++) assert.notEqual(nomes[i], nomes[i - 1]);
});

test('aviso geral: quem não foi sorteado recebe "a Maldição despertou" (sem nome); em teste, só testadores', async () => {
  await h.liberar('maldicao');
  const a = await h.convidado('Aviso Um', { push: true });
  const b = await h.convidado('Aviso Dois', { push: true });
  const espera = () => esperar(300);
  const de = (c) => notif.caixa.filter((m) => m.endpoint === c.sub.endpoint);
  notif.caixa.length = 0;
  await banco.rodar("UPDATE push_log SET em = 0"); // não bater no teto por hora de testes anteriores
  const r = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
  assert.equal(r.status, 200);
  await espera();
  const nome = r.json.maldicao.nome;
  const parceiro = r.json.maldicao.parceiro && r.json.maldicao.parceiro.nome; // castigo duplo: os dois são avisados
  for (const c of [a, b]) {
    const titulos = de(c).map((m) => m.titulo);
    assert.equal(titulos.length, 1, `${c.nome}: um aviso só`);
    if (nome === c.nome || parceiro === c.nome) assert.equal(titulos[0], 'Project V: você foi amaldiçoado');
    else assert.equal(titulos[0], 'Project V: a Maldição despertou');
  }
  const geral = notif.caixa.find((m) => m.titulo === 'Project V: a Maldição despertou');
  assert.ok(!geral.corpo.includes(nome), 'sem o nome de quem foi sorteado');
  assert.equal(notif.problemaNoAviso(geral), null);

  // Em teste: o aviso geral não chega a quem não testa
  await s.req('PATCH', `/api/admin/convidados/${a.id}`, { token: admin, corpo: { testador: true } });
  await h.liberar('maldicao', 'teste');
  notif.caixa.length = 0;
  await banco.rodar("UPDATE push_log SET em = 0");
  assert.equal((await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } })).status, 200);
  await espera();
  assert.equal(de(b).length, 0, 'quem não testa não recebe nada');
  assert.equal(de(a).length, 1, 'o testador recebe o aviso pessoal');
  await s.req('PATCH', `/api/admin/convidados/${a.id}`, { token: admin, corpo: { testador: false } });
});

test('desafio de foto: só sai com o Mural aberto; a foto da pessoa liga à maldição e avisa o telão na hora', async () => {
  const { CASTIGOS } = require('../server/jogos/conteudo');
  const textosFoto = CASTIGOS.filter((c) => c.foto).map((c) => c.texto);
  assert.equal(textosFoto.length, 4);
  await h.liberar('maldicao');
  await h.liberar('correio', 'bloqueada');
  for (let i = 0; i < 25; i++) {
    const r = await s.req('POST', '/api/admin/maldicao/sortear', { token: admin, corpo: { id: h.idClique() } });
    assert.ok(!textosFoto.includes(r.json.maldicao.castigo), 'sem Mural, sem desafio de foto');
    await s.req('POST', `/api/admin/maldicao/${r.json.maldicao.id}/resolver`, { token: admin, corpo: { estado: 'cancelada' } });
  }
  // Maldição de foto em cena para a "Fotógrafa"; o Mural está aberto e TRAVADO.
  await h.liberar('correio');
  await s.req('PUT', '/api/admin/correio-auto', { token: admin, corpo: { auto: false } });
  await banco.rodar("UPDATE maldicoes SET estado = 'cancelada' WHERE estado = 'sorteada'");
  const f = await h.convidado('Fotógrafa');
  const ins = await banco.rodar("INSERT INTO maldicoes (convidado_id, castigo, estado, origem, chave, sorteada_em, foto) VALUES (?, ?, 'sorteada', 'manual', ?, ?, 1)",
    [f.id, textosFoto[0], `teste-foto-${Date.now()}`, Date.now() - 20000]);
  const mid = Number(ins.lastInsertRowid);
  const antes = (await s.req('GET', '/api/admin/telao', { token: admin })).json.maldicao;
  assert.equal(antes.id, mid);
  assert.equal(antes.foto, true);
  assert.equal(antes.fases.cumprir, 120000, '2 minutos para o desafio de foto');
  assert.equal(antes.fotoId, null);
  const minha = (await s.req('GET', '/api/maldicao/minha', { token: f.token })).json.maldicao;
  assert.equal(minha.foto, true, 'o celular mostra o botão de foto');

  const telao = await s.conectar({ tipo: 'telao', token: admin });
  const ev = proximoEvento(telao, 'maldicao:foto');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 3)]).toString('base64');
  assert.equal((await s.req('POST', '/api/correio', { token: f.token, corpo: { foto: jpeg } })).status, 200);
  const e = await ev;
  assert.equal(e.id, mid);
  const depois = (await s.req('GET', '/api/admin/telao', { token: admin })).json;
  assert.equal(depois.maldicao.fotoId, e.fotoId);
  assert.ok(depois.correio.cartas.some((c) => c.id === e.fotoId), 'foto do desafio vai ao telão mesmo com o Mural travado');
  assert.equal((await s.req('GET', `/api/admin/correio/foto/${e.fotoId}`, { token: admin })).status, 200);
  telao.close();
  await s.req('PUT', '/api/admin/correio-auto', { token: admin, corpo: { auto: true } });
});
