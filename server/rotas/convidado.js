// Rotas do convidado: entrar pelo link, perfil e tudo o que a tela pré-festa mostra.

const express = require('express');
const convidados = require('../dados/convidados');
const festa = require('../dados/festa');
const atividades = require('../dados/atividades');
const bebidas = require('../dados/bebidas');
const playlist = require('../dados/playlist');
const caronas = require('../dados/caronas');
const pos = require('../dados/pos');
const notificacoes = require('../notificacoes');
const seg = require('../seguranca');
const { AVATARES } = require('../avatares');
const { avisar } = require('../tempo-real');
const { assincrono, soConvidado } = require('./util');

const router = express.Router();

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
router.post('/eu/push', soConvidado, freiarPush, assincrono(async (req, res) => {
  await notificacoes.inscrever(req.convidado.id, (req.body || {}).inscricao);
  res.json({ ok: true });
  // Confirmação no próprio aparelho: prova na hora que está funcionando.
  notificacoes.enviar({
    titulo: '🔔 Notificações ativadas!',
    corpo: 'Você vai receber os avisos do Project V. Te espero lá. 💀',
    para: { ids: [req.convidado.id] },
    tag: 'boas-vindas',
  }).catch((e) => console.error('[push]', e.message));
}));
router.post('/eu/push/situacao', soConvidado, assincrono(async (req, res) => {
  res.json({ ok: true, inscrito: await notificacoes.estaInscrito(req.convidado.id, (req.body || {}).endpoint) });
}));
router.delete('/eu/push', soConvidado, freiarPush, assincrono(async (req, res) => {
  await notificacoes.desinscrever(req.convidado.id, (req.body || {}).endpoint);
  res.json({ ok: true });
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
router.get('/festa', soConvidado, assincrono(async (req, res) => {
  const eu = req.convidado.id;
  const [info, ativs, lista, beb, musicas, carros, noite] = await Promise.all([
    festa.info(), atividades.paraConvidado(), convidados.confirmados(), bebidas.paraConvidado(eu),
    playlist.listar(eu), caronas.listar(eu), pos.paraConvidado(eu),
  ]);
  // O id interno dos outros convidados não sai: só nome, monstro e "sou eu".
  const confirmados = lista.map((c) => ({ nome: c.nome, avatar: c.avatar, souEu: c.id === req.convidado.id }));
  res.json({
    ok: true, agora: Date.now(), festa: info, atividades: ativs, confirmados, bebidas: beb,
    playlist: musicas, caronas: carros, pos: noite,
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

module.exports = router;
