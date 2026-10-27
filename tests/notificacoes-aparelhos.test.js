// Notificações (parte 2): aparelhos, limite, teste por aparelho, fila persistente, admin e origem.
// Arquivo separado: cada arquivo sobe o próprio servidor, com freios de tentativa zerados.
process.env.PUSH_LOTE_MS = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const notif = require('../server/notificacoes');
const banco = require('../server/dados/banco');

let s;
let admin;
test.before(async () => { s = await subir(); admin = await s.tokenAdmin(); });
test.after(async () => { await s.fechar(); });

const M = (iso) => Date.parse(iso); // horários em Manaus (-04:00)
let seq = 0;
function inscricao(extra = '') {
  seq += 1;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/aparelho${seq}${extra}`,
    keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
  };
}
async function convidado(nome, ativar = true) {
  const c = (await s.req('POST', '/api/admin/convidados', { token: admin, corpo: { nome } })).json.criados[0];
  const token = (await s.req('POST', '/api/entrar', { corpo: { codigo: c.codigo } })).json.token;
  await s.req('PUT', '/api/eu/perfil', { token, corpo: { avatar: 'bruxa' } });
  const sub = inscricao();
  if (ativar) {
    assert.equal((await s.req('POST', '/api/eu/push', { token, corpo: { inscricao: sub } })).status, 200);
    await new Promise((r) => setTimeout(r, 30)); // deixa sair a confirmação de boas-vindas
  }
  return { ...c, token, sub };
}
const recebeu = (sub) => notif.caixa.filter((m) => m.endpoint === sub.endpoint && m.tag !== 'boas-vindas');
const limpar = async () => { notif.caixa.length = 0; await notif._zerarSociais(); };
const idEnvio = () => `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// ------------------------------------------------------------ v2: aparelhos, limite, teste, fila

test('ativar é idempotente, não dispara notificação sozinho; teste só quando pedido, só no aparelho e com limite', async () => {
  await limpar();
  const c = await convidado('Dois Celulares', false);
  const cel1 = inscricao(); const cel2 = inscricao();
  const r1 = await s.req('POST', '/api/eu/push', { token: c.token, corpo: { inscricao: cel1, instalado: true } });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.novo, true);
  const r1b = await s.req('POST', '/api/eu/push', { token: c.token, corpo: { inscricao: cel1 } });
  assert.equal(r1b.json.novo, false, 'reativar no mesmo aparelho não duplica');
  await s.req('POST', '/api/eu/push', { token: c.token, corpo: { inscricao: cel2 } });
  assert.equal(notif.caixa.length, 0, 'nenhuma notificação automática ao ativar');
  const sit = (await s.req('POST', '/api/eu/push/situacao', { token: c.token, corpo: { endpoint: cel2.endpoint } })).json;
  assert.equal(sit.total, 2);
  assert.equal(sit.inscrito, true);
  assert.equal(sit.aparelhos.filter((a) => a.esteAparelho).length, 1);
  // Teste pedido: só no aparelho, texto específico e válido
  const t1 = await s.req('POST', '/api/eu/push/teste', { token: c.token, corpo: { endpoint: cel1.endpoint } });
  assert.equal(t1.json.teste.entregue, true);
  assert.deepEqual(notif.caixa.map((m) => m.endpoint), [cel1.endpoint]);
  const msg = notif.caixa[0];
  assert.equal(msg.titulo, 'Project V: teste de avisos');
  assert.match(msg.corpo, /^Teste pedido por você às \d{1,2}h(\d{2})?\. Os avisos da festa de Halloween/);
  assert.equal(notif.problemaNoAviso({ titulo: msg.titulo, corpo: msg.corpo, url: msg.url }), null);
  // Repetir logo em seguida: segurado (sem notificação repetida)
  for (let i = 0; i < 3; i++) {
    const de = await s.req('POST', '/api/eu/push/teste', { token: c.token, corpo: { endpoint: cel1.endpoint } });
    assert.equal(de.status, 429);
  }
  assert.equal(notif.caixa.length, 1);
  // Outro aparelho tem o próprio limite
  assert.equal((await s.req('POST', '/api/eu/push/teste', { token: c.token, corpo: { endpoint: cel2.endpoint } })).status, 200);
  const outro = await s.req('POST', '/api/eu/push/teste', { token: c.token, corpo: { endpoint: 'https://fcm.googleapis.com/fcm/send/naoeh' } });
  assert.equal(outro.status, 404);
  const log = await banco.tudo("SELECT resultado FROM push_log WHERE convidado_id = ? AND chave LIKE 'teste:%'", [c.id]);
  assert.equal(log.length, 2);
});

test('limite de 5 aparelhos: recusa o 6º, lista os aparelhos e deixa remover um', async () => {
  const c = await convidado('Muitos Aparelhos', false);
  const subs = [];
  for (let i = 0; i < 5; i++) {
    const sub = inscricao(); subs.push(sub);
    assert.equal((await s.req('POST', '/api/eu/push', { token: c.token, corpo: { inscricao: sub } })).status, 200);
  }
  const sexto = inscricao();
  const r = await s.req('POST', '/api/eu/push', { token: c.token, corpo: { inscricao: sexto } });
  assert.equal(r.status, 409);
  assert.equal(r.json.codigo, 'limite');
  assert.equal(r.json.aparelhos.length, 5);
  assert.equal(await notif.estaInscrito(c.id, subs[0].endpoint), true, 'nada foi apagado sem a pessoa escolher');
  // Outra pessoa não consegue remover aparelho dele
  const intrusa = await convidado('Intrusa', false);
  assert.equal((await s.req('DELETE', `/api/eu/push/aparelhos/${r.json.aparelhos[0].id}`, { token: intrusa.token })).status, 404);
  assert.equal((await s.req('DELETE', `/api/eu/push/aparelhos/${r.json.aparelhos[0].id}`, { token: c.token })).status, 200);
  assert.equal((await s.req('POST', '/api/eu/push', { token: c.token, corpo: { inscricao: sexto } })).status, 200);
  assert.equal(await notif.estaInscrito(c.id, subs[0].endpoint), false);
});

test('aparelho que mudou de dono sai do anterior; nomes de aparelho', async () => {
  const a = await convidado('Dono Antigo', false);
  const b = await convidado('Dono Novo', false);
  const sub = inscricao();
  await s.req('POST', '/api/eu/push', { token: a.token, corpo: { inscricao: sub } });
  await s.req('POST', '/api/eu/push', { token: b.token, corpo: { inscricao: sub } });
  assert.equal(await notif.estaInscrito(a.id, sub.endpoint), false);
  assert.equal(await notif.estaInscrito(b.id, sub.endpoint), true);
  const ua = (x) => notif.nomeDoAparelho(x);
  assert.equal(ua('Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121 Mobile Safari/537.36'), 'Android · Samsung Internet');
  assert.equal(ua('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'), 'Android · Chrome');
  assert.equal(notif.nomeDoAparelho('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', true), 'iPhone · app na tela inicial');
});

test('fila do movimento dos amigos fica no banco (sobrevive a reinício) e não avisa quem está olhando a tela', async () => {
  await limpar();
  const autor = await convidado('Autor Fila');
  const olhando = await convidado('Olhando Playlist');
  const longe = await convidado('Longe');
  await s.req('POST', '/api/playlist', { token: autor.token, corpo: { titulo: 'Persistente', artista: 'Z' } });
  const linha = await banco.um("SELECT n, autores FROM push_fila WHERE tipo = 'musica'");
  assert.equal(Number(linha.n), 1);
  assert.deepEqual(JSON.parse(linha.autores), [autor.id]);
  notif.marcarTela('sock-1', olhando.id, 'playlist');
  await notif.despacharSociais(M('2026-10-28T10:00:00-04:00'));
  notif.sairTela('sock-1');
  assert.equal(recebeu(longe.sub).length, 1);
  assert.equal(recebeu(olhando.sub).length, 0, 'quem já está na playlist não recebe');
  assert.equal(Number((await banco.um("SELECT n FROM push_fila WHERE tipo = 'musica'")).n), 0);
  // Dois despachos ao mesmo tempo (dois processos) não duplicam
  await s.req('PUT', '/api/caronas/minha', { token: autor.token, corpo: { vagas: 1, trajeto: 'ida', saindo: 'Centro' } });
  const antes = recebeu(longe.sub).length;
  await Promise.all([notif.despacharSociais(M('2026-10-28T11:00:00-04:00')), notif.despacharSociais(M('2026-10-28T11:00:00-04:00'))]);
  assert.equal(recebeu(longe.sub).length - antes, 1);
});

test('admin: envio manual com id não duplica, teste para uma pessoa, lista de inscritos e falhas no histórico', async () => {
  await limpar();
  const c = await convidado('Alvo do Teste');
  const id = idEnvio();
  const corpo = { id, titulo: 'Uma vez', corpo: 'Só uma vez, para conferir a trava.' };
  const [r1, r2] = await Promise.all([
    s.req('POST', '/api/admin/avisos', { token: admin, corpo }), s.req('POST', '/api/admin/avisos', { token: admin, corpo })]);
  assert.equal([r1.json.pulado, r2.json.pulado].filter(Boolean).length, 1);
  assert.equal(recebeu(c.sub).filter((m) => m.corpo === 'Só uma vez, para conferir a trava.').length, 1);
  assert.equal((await s.req('POST', '/api/admin/avisos', { token: admin, corpo: { corpo: 'sem id' } })).status, 400);

  const g = (await s.req('GET', '/api/admin/avisos', { token: admin })).json;
  assert.ok(g.inscritos.some((i) => i.id === c.id && i.aparelhos === 1));
  const t = await s.req('POST', '/api/admin/avisos/teste', { token: admin, corpo: { convidadoId: c.id } });
  assert.equal(t.status, 200);
  assert.equal(t.json.entregues, 1);
  assert.equal(recebeu(c.sub).at(-1).tag, 'teste-admin');
  const sem = await convidado('Sem Avisos', false);
  assert.equal((await s.req('POST', '/api/admin/avisos/teste', { token: admin, corpo: { convidadoId: sem.id } })).status, 404);
  const h = (await s.req('GET', '/api/admin/avisos', { token: admin })).json.historico;
  assert.ok(!h.some((x) => x.chave.startsWith('teste:')), 'teste não polui o histórico');
  assert.equal(typeof h[0].falhas, 'number');
});

test('endereço fora da lista que entrou por backup antigo nunca recebe requisição', async () => {
  await limpar();
  const c = await convidado('Backup Velho', false);
  await banco.rodar('INSERT INTO push_inscricoes (convidado_id, endpoint, p256dh, auth, criado_em) VALUES (?, ?, ?, ?, ?)',
    [c.id, 'https://169.254.169.254/latest', 'B'.repeat(87), 'a'.repeat(22), Date.now()]);
  const r = await notif.enviar({ titulo: 'Project V: teste interno', corpo: 'Mensagem interna de verificação da festa.', para: { ids: [c.id] } });
  assert.equal(r.entregues, 0);
  assert.equal(notif.caixa.length, 0);
  assert.equal(await notif.estaInscrito(c.id, 'https://169.254.169.254/latest'), false);
});

test('outro site não consegue mandar ação (Origin diferente)', async () => {
  const c = await convidado('Origem', false);
  const r = await s.req('POST', '/api/eu/push', { token: c.token, corpo: { inscricao: inscricao() }, cabecalhos: { Origin: 'https://golpe.com' } });
  assert.equal(r.status, 403);
});

test('a tela aberta chega pelo tempo real e some quando a pessoa sai', async () => {
  const c = await convidado('Na Playlist', false);
  const sock = await s.conectar({ tipo: 'convidado', token: c.token });
  sock.emit('tela', 'playlist');
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(notif.olhando('playlist').includes(c.id));
  sock.emit('tela', '<script>');
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(!notif.olhando('playlist').includes(c.id), 'valor inválido vira "nenhuma tela"');
  sock.emit('tela', 'caronas');
  await new Promise((r) => setTimeout(r, 80));
  sock.disconnect();
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(!notif.olhando('caronas').includes(c.id));
});
