// Rotas do convidado: entrar pelo link, perfil e tudo o que a tela pré-festa mostra.

const express = require('express');
const convidados = require('../dados/convidados');
const festa = require('../dados/festa');
const atividades = require('../dados/atividades');
const bebidas = require('../dados/bebidas');
const playlist = require('../dados/playlist');
const caronas = require('../dados/caronas');
const pos = require('../dados/pos');
const previsoes = require('../dados/previsoes');
const enigmas = require('../dados/enigmas');
const pontos = require('../dados/pontos');
const maldicao = require('../dados/maldicao');
const quiz = require('../dados/quiz');
const concurso = require('../dados/concurso');
const correio = require('../dados/correio');
const notificacoes = require('../notificacoes');
const seg = require('../seguranca');
const { AVATARES } = require('../avatares');
const { avisar } = require('../tempo-real');
const { assincrono, soConvidado } = require('./util');

const router = express.Router();
// Versão no ar: muda a cada deploy (o Render informa o commit; sem ele, a hora em que o servidor subiu).
// A página compara e se atualiza sozinha quando sai uma versão nova.
const VERSAO = (process.env.RENDER_GIT_COMMIT || `inicio-${Date.now()}`).slice(0, 40);

// 20 tentativas de código por minuto por IP: suficiente para uma festa inteira no
// mesmo Wi-Fi, inútil para quem quer chutar códigos.
const freioEntrada = seg.criarFreio({ maximo: 20, janelaMs: 60 * 1000 });
// Freio geral de códigos ERRADOS (todos os IPs somados), porque o IP pode ser forjado.
// 120 erros/min não atrapalha ninguém e torna o chute impossível (31^10 códigos).
const freioEntradaGeral = seg.criarFreio({ maximo: 120, janelaMs: 60 * 1000 });
const freioPerfil = seg.criarFreio({ maximo: 10, janelaMs: 60 * 1000 });
const freioBebidas = seg.criarFreio({ maximo: 40, janelaMs: 60 * 1000 });
const freioExtras = seg.criarFreio({ maximo: 40, janelaMs: 60 * 1000 });

router.get('/avatares', (_req, res) => res.json({ ok: true, avatares: AVATARES }));

router.post('/entrar', assincrono(async (req, res) => {
  if (!freioEntrada.tentar(req.ip) || freioEntradaGeral.estourou('*')) {
    return res.status(429).json({ ok: false, erro: 'Muitas tentativas. Espere um minuto.' });
  }
  const codigo = String((req.body && req.body.codigo) || '').trim().toLowerCase();
  const c = await convidados.buscarPorCodigo(codigo);
  if (!c || !c.ativo) {
    freioEntradaGeral.tentar('*');
    return res.status(404).json({ ok: false, erro: 'Esse link de convite não é válido. Fale com o Victor.' });
  }
  await convidados.marcarAcesso(c.id);
  res.json({
    ok: true,
    token: seg.criarSessaoConvidado(c.id, Number(c.sessao_versao)),
    eu: convidados.paraProprio(c),
  });
}));

router.get('/eu', soConvidado, (req, res) => {
  // O próprio código vai só para o dono (usado no atalho de tela inicial do iPhone).
  res.json({ ok: true, eu: { ...convidados.paraProprio(req.convidado), codigo: req.convidado.codigo } });
});

// ------------------------------------------------------------- notificações
const freioPush = seg.criarFreio({ maximo: 20, janelaMs: 60 * 1000 });
function freiarPush(req, res, next) {
  if (freioPush.tentar(req.convidado.id)) return next();
  return res.status(429).json({ ok: false, erro: 'Calma! Espere um pouco.' });
}
router.get('/push/chave', soConvidado, assincrono(async (_req, res) => {
  res.json({ ok: true, chave: await notificacoes.chavePublica() });
}));
// Ativar neste aparelho. Só responde "ok" depois que a inscrição está gravada no banco.
router.post('/eu/push', soConvidado, freiarPush, assincrono(async (req, res) => {
  const corpo = req.body || {};
  const r = await notificacoes.inscrever(req.convidado.id, corpo.inscricao, {
    ua: req.get('user-agent') || '', instalado: corpo.instalado === true,
  });
  if (r.limite) {
    return res.status(409).json({
      ok: false, codigo: 'limite', maximo: r.maximo, aparelhos: r.aparelhos,
      erro: `Você já tem ${r.maximo} aparelhos recebendo avisos. Remova um para ativar neste.`,
    });
  }
  // Sem notificação automática aqui: o teste só sai quando a pessoa pede.
  return res.json({ ok: true, novo: r.novo, aparelhos: r.aparelhos });
}));
router.post('/eu/push/situacao', soConvidado, assincrono(async (req, res) => {
  res.json({ ok: true, ...(await notificacoes.situacao(req.convidado.id, (req.body || {}).endpoint)) });
}));
router.post('/eu/push/teste', soConvidado, freiarPush, assincrono(async (req, res) => {
  const teste = await notificacoes.testarAparelho(req.convidado.id, (req.body || {}).endpoint);
  if (teste.entregue) return res.json({ ok: true, teste });
  const respostas = {
    'nao-inscrito': [404, 'Este aparelho não está recebendo avisos. Ative de novo.'],
    expirada: [404, 'Precisamos reconectar este aparelho para continuar enviando os avisos.'],
    espera: [429, 'Você testou há pouco. Para não encher seu celular, o próximo teste fica liberado em alguns minutos.'],
  };
  const [status, erro] = respostas[teste.motivo] || [502, 'Não conseguimos enviar o teste agora. Tente de novo em instantes.'];
  return res.status(status).json({ ok: false, codigo: teste.motivo, erro, teste });
}));
router.delete('/eu/push', soConvidado, freiarPush, assincrono(async (req, res) => {
  await notificacoes.desinscrever(req.convidado.id, (req.body || {}).endpoint);
  res.json({ ok: true });
}));
router.delete('/eu/push/aparelhos/:id', soConvidado, freiarPush, assincrono(async (req, res) => {
  const removido = await notificacoes.removerAparelho(req.convidado.id, req.params.id);
  if (!removido) return res.status(404).json({ ok: false, erro: 'Aparelho não encontrado.' });
  return res.json({ ok: true });
}));

router.put('/eu/perfil', soConvidado, assincrono(async (req, res) => {
  if (!freioPerfil.tentar(req.convidado.id)) {
    return res.status(429).json({ ok: false, erro: 'Calma! Espere um pouco antes de mudar de novo.' });
  }
  const { avatar } = req.body || {};
  const atualizado = await convidados.atualizarPerfil(req.convidado.id, { avatar });
  avisar.atualizar('confirmados');
  res.json({ ok: true, eu: convidados.paraProprio(atualizado) });
}));

// Tudo o que a tela do convidado precisa, numa ida só. `agora` é o relógio do
// servidor: a contagem regressiva calcula a diferença e ignora o relógio do celular.
// Jogos da festa: só saem para quem pode jogar (liberado, ou testador com a atividade em teste).
const testador = (req) => Boolean(Number(req.convidado.testador));
async function seLiberado(id, req, montar) {
  const a = await atividades.acesso(id, req.convidado);
  return a.liberada ? { ...(await montar()), teste: a.teste } : null;
}
async function jogosDaFesta(req) {
  const eu = req.convidado.id;
  const [q, c, k, f] = await Promise.all([
    seLiberado('quiz', req, () => quiz.paraConvidado(eu)),
    seLiberado('concurso', req, () => concurso.paraConvidado(eu)),
    seLiberado('correio', req, () => correio.paraConvidado(eu)),
    seLiberado('fotos', req, () => correio.galeria()),
  ]);
  return { quiz: q, concurso: c, correio: k, fotos: f };
}

router.get('/festa', soConvidado, assincrono(async (req, res) => {
  const eu = req.convidado.id;
  await quiz.sincronizar(); // pontos do quiz em dia antes de montar o ranking
  const t = testador(req);
  const [info, ativs, lista, beb, musicas, carros, noite, prev, enig, rank, jogos] = await Promise.all([
    festa.info(), atividades.paraConvidado(Date.now(), t), convidados.confirmados(), bebidas.paraConvidado(eu),
    playlist.listar(eu), caronas.listar(eu), pos.paraConvidado(eu), previsoes.paraConvidado(eu, Date.now(), t), enigmas.paraConvidado(eu),
    pontos.paraConvidado(eu, t), jogosDaFesta(req),
  ]);
  // O id interno dos outros convidados não sai: só nome, monstro e "sou eu".
  const confirmados = lista.map((c) => ({ nome: c.nome, avatar: c.avatar, souEu: c.id === req.convidado.id }));
  res.json({
    ok: true, versao: VERSAO, agora: Date.now(), festa: info, atividades: ativs, confirmados, bebidas: beb,
    playlist: musicas, caronas: carros, pos: noite, previsoes: prev, enigmas: enig, ranking: rank, ...jogos,
  });
}));

// ------------------------------------------------------- lista de bebidas
// Aberta desde já (não é uma atividade com cadeado). Toda mudança avisa as telas.
function freiarBebidas(req, res, next) {
  if (freioBebidas.tentar(req.convidado.id)) return next();
  return res.status(429).json({ ok: false, erro: 'Calma! Espere um pouco antes de mudar de novo.' });
}

async function responderBebidas(req, res) {
  avisar.atualizar('bebidas');
  res.json({ ok: true, bebidas: await bebidas.paraConvidado(req.convidado.id) });
}

router.put('/bebidas/itens/:id', soConvidado, freiarBebidas, assincrono(async (req, res) => {
  await bebidas.definirItem(req.convidado.id, req.params.id, (req.body || {}).quantidade);
  await responderBebidas(req, res);
}));

router.post('/bebidas/outras', soConvidado, freiarBebidas, assincrono(async (req, res) => {
  const { nome, quantidade, unidade } = req.body || {};
  await bebidas.adicionarOutra(req.convidado.id, { nome, quantidade, unidade });
  await responderBebidas(req, res);
}));

router.delete('/bebidas/minhas/:id', soConvidado, freiarBebidas, assincrono(async (req, res) => {
  await bebidas.removerMinha(req.convidado.id, req.params.id);
  await responderBebidas(req, res);
}));

// ------------------------------------------- playlist, caronas e o pós
function freiarExtras(req, res, next) {
  if (freioExtras.tentar(req.convidado.id)) return next();
  return res.status(429).json({ ok: false, erro: 'Calma! Espere um pouco antes de mudar de novo.' });
}
const ok = (oque) => (req, res) => { avisar.atualizar(oque); res.json({ ok: true }); };

router.post('/playlist', soConvidado, freiarExtras, assincrono(async (req, res, next) => {
  const { titulo, artista } = req.body || {};
  const r = await playlist.sugerir(req.convidado.id, { titulo, artista });
  avisar.atualizar('playlist');
  res.json({ ok: true, jaExistia: r.jaExistia });
  void next;
}));
router.put('/playlist/:id/voto', soConvidado, freiarExtras, assincrono(async (req, res, next) => {
  await playlist.votar(req.convidado.id, req.params.id, (req.body || {}).voto === true);
  ok('playlist')(req, res, next);
}));
router.delete('/playlist/:id', soConvidado, freiarExtras, assincrono(async (req, res, next) => {
  await playlist.remover(req.params.id, req.convidado.id);
  ok('playlist')(req, res, next);
}));

router.put('/caronas/minha', soConvidado, freiarExtras, assincrono(async (req, res, next) => {
  const { vagas, trajeto, saindo, obs } = req.body || {};
  await caronas.oferecer(req.convidado.id, { vagas, trajeto, saindo, obs });
  ok('caronas')(req, res, next);
}));
router.delete('/caronas/minha', soConvidado, freiarExtras, assincrono(async (req, res, next) => {
  await caronas.cancelarOferta(req.convidado.id);
  ok('caronas')(req, res, next);
}));
router.post('/caronas/:id/reserva', soConvidado, freiarExtras, assincrono(async (req, res, next) => {
  await caronas.reservar(req.convidado.id, req.params.id);
  ok('caronas')(req, res, next);
}));
router.delete('/caronas/reserva', soConvidado, freiarExtras, assincrono(async (req, res, next) => {
  await caronas.cancelarReserva(req.convidado.id);
  ok('caronas')(req, res, next);
}));

router.put('/pos/voto', soConvidado, freiarExtras, assincrono(async (req, res, next) => {
  await pos.votar(req.convidado.id, (req.body || {}).opcaoId);
  ok('pos')(req, res, next);
}));

// -------------------------------------------------------------- jogos
const freioJogos = seg.criarFreio({ maximo: 30, janelaMs: 60 * 1000 });
function freiarJogos(req, res, next) {
  if (freioJogos.tentar(req.convidado.id)) return next();
  return res.status(429).json({ ok: false, erro: 'Calma! Espere um pouco e tente de novo.' });
}

router.get('/previsoes', soConvidado, assincrono(async (req, res) => {
  res.json({ ok: true, previsoes: await previsoes.paraConvidado(req.convidado.id, Date.now(), testador(req)) });
}));
router.put('/previsoes/:id', soConvidado, freiarJogos, assincrono(async (req, res) => {
  await previsoes.responder(req.convidado.id, req.params.id, (req.body || {}).escolha ?? null, Date.now(), testador(req));
  res.json({ ok: true, previsoes: await previsoes.paraConvidado(req.convidado.id, Date.now(), testador(req)) });
}));

router.post('/previsoes/enviar', soConvidado, freiarJogos, assincrono(async (req, res) => {
  await previsoes.enviar(req.convidado.id, Date.now(), testador(req));
  avisar.admin('atualizar', { oque: 'previsoes' });
  res.json({ ok: true, previsoes: await previsoes.paraConvidado(req.convidado.id, Date.now(), testador(req)) });
}));

router.get('/enigmas', soConvidado, assincrono(async (req, res) => {
  res.json({ ok: true, enigmas: await enigmas.paraConvidado(req.convidado.id) });
}));
// Revelar começa o relógio do servidor; sair da página com o enigma aberto encerra para a pessoa.
router.post('/enigmas/:id/revelar', soConvidado, freiarJogos, assincrono(async (req, res) => {
  res.json({ ok: true, enigmas: await enigmas.revelar(req.convidado.id, req.params.id) });
}));
router.post('/enigmas/:id/saiu', soConvidado, assincrono(async (req, res) => {
  const encerrou = await enigmas.saiu(req.convidado.id, req.params.id);
  res.json({ ok: true, encerrou });
}));
router.post('/enigmas/:id/resposta', soConvidado, freiarJogos, assincrono(async (req, res) => {
  const r = await enigmas.responder(req.convidado.id, req.params.id, (req.body || {}).resposta);
  if (r.acertou && !r.jaTinha) avisar.atualizar('ranking');
  res.json({ ok: true, resultado: r, enigmas: await enigmas.paraConvidado(req.convidado.id) });
}));

router.get('/ranking', soConvidado, assincrono(async (req, res) => {
  await quiz.sincronizar();
  res.json({ ok: true, ranking: await pontos.paraConvidado(req.convidado.id, testador(req)) });
}));

// ------------------------------------------- quiz, concurso e correio
const proibido = (res, nome) => res.status(403).json({ ok: false, erro: `${nome} ainda não está aberto.` });
router.get('/quiz', soConvidado, assincrono(async (req, res) => {
  const q = await seLiberado('quiz', req, () => quiz.paraConvidado(req.convidado.id));
  if (!q) return proibido(res, 'O Quiz');
  return res.json({ ok: true, quiz: q });
}));
router.post('/quiz/entrar', soConvidado, freiarJogos, assincrono(async (req, res) => {
  if (await quiz.entrar(req.convidado)) { avisar.telao('quiz:sala', {}); avisar.admin('atualizar', { oque: 'quiz' }); }
  res.json({ ok: true, quiz: { ...(await quiz.paraConvidado(req.convidado.id)), teste: (await atividades.acesso('quiz', req.convidado)).teste } });
}));
router.post('/quiz/:id/resposta', soConvidado, freiarJogos, assincrono(async (req, res) => {
  await quiz.responder(req.convidado, req.params.id, (req.body || {}).escolha);
  avisar.admin('atualizar', { oque: 'quiz' });
  avisar.telao('quiz:resposta', {});
  res.json({ ok: true, quiz: { ...(await quiz.paraConvidado(req.convidado.id)), teste: (await atividades.acesso('quiz', req.convidado)).teste } });
}));

router.get('/concurso', soConvidado, assincrono(async (req, res) => {
  const c = await seLiberado('concurso', req, () => concurso.paraConvidado(req.convidado.id));
  if (!c) return proibido(res, 'O Concurso');
  return res.json({ ok: true, concurso: c });
}));
router.put('/concurso/desfilar', soConvidado, freiarJogos, assincrono(async (req, res) => {
  await concurso.desfilar(req.convidado, (req.body || {}).quero === true);
  avisar.admin('atualizar', { oque: 'concurso' });
  avisar.telao('atualizar', { oque: 'concurso' });
  res.json({ ok: true, concurso: await seLiberado('concurso', req, () => concurso.paraConvidado(req.convidado.id)) });
}));
router.put('/concurso/voto', soConvidado, freiarJogos, assincrono(async (req, res) => {
  await concurso.votar(req.convidado, (req.body || {}).candidato);
  avisar.admin('atualizar', { oque: 'concurso' });
  avisar.telao('atualizar', { oque: 'concurso' });
  res.json({ ok: true, concurso: await seLiberado('concurso', req, () => concurso.paraConvidado(req.convidado.id)) });
}));

router.get('/correio', soConvidado, assincrono(async (req, res) => {
  const k = await seLiberado('correio', req, () => correio.paraConvidado(req.convidado.id));
  if (!k) return proibido(res, 'O Mural');
  return res.json({ ok: true, correio: k });
}));
router.post('/correio', soConvidado, freiarJogos, assincrono(async (req, res) => {
  const { texto, para, foto } = req.body || {};
  const r = await correio.enviar(req.convidado, { texto, para, foto });
  avisar.admin('atualizar', { oque: 'correio' });
  if (r.noTelao) avisar.telao('atualizar', { oque: 'correio' });
  res.json({ ok: true, correio: await seLiberado('correio', req, () => correio.paraConvidado(req.convidado.id)) });
}));

// A própria foto (para a pessoa ver o que mandou). Foto dos outros: 404, a não ser que as
// Fotos da festa já estejam abertas para esta pessoa (aí vale qualquer foto aprovada).
router.get('/correio/foto/:id', soConvidado, assincrono(async (req, res) => {
  const galeria = (await atividades.acesso('fotos', req.convidado)).liberada;
  const buf = await correio.foto(req.params.id, { autorId: req.convidado.id, galeria });
  if (!buf) return res.status(404).json({ ok: false, erro: 'Foto não encontrada.' });
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
  return res.send(buf);
}));

// Fotos da festa: lista e todas num .zip.
router.get('/fotos', soConvidado, assincrono(async (req, res) => {
  const f = await seLiberado('fotos', req, () => correio.galeria());
  if (!f) return res.status(403).json({ ok: false, erro: 'As fotos da festa só abrem depois da festa.' });
  return res.json({ ok: true, fotos: f });
}));
router.get('/fotos/zip', soConvidado, freiarJogos, assincrono(async (req, res) => {
  if (!(await atividades.acesso('fotos', req.convidado)).liberada) return res.status(403).json({ ok: false, erro: 'As fotos da festa só abrem depois da festa.' });
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="project-v-halloween-fotos.zip"', 'Cache-Control': 'no-store' });
  await correio.escreverZip((pedaco) => new Promise((ok) => { if (res.write(pedaco)) ok(); else res.once('drain', ok); }));
  return res.end();
}));

// Maldição em cena que é minha (para o celular mostrar o aviso depois de reconectar).
router.get('/maldicao/minha', soConvidado, assincrono(async (req, res) => {
  const a = await maldicao.atual();
  if (!a) return res.json({ ok: true, maldicao: null });
  const m = await maldicao.buscar(a.id);
  const minha = m.convidadoId === req.convidado.id || (m.parceiro && m.parceiro.id === req.convidado.id);
  return res.json({ ok: true, maldicao: minha ? { id: m.id, castigo: m.castigo, sorteadaEm: m.sorteadaEm, fases: maldicao.FASES } : null });
}));

module.exports = router;
