// Rotas do convidado: entrar pelo link, perfil e tudo o que a tela pré-festa mostra.

const express = require('express');
const convidados = require('../dados/convidados');
const festa = require('../dados/festa');
const atividades = require('../dados/atividades');
const bebidas = require('../dados/bebidas');
const seg = require('../seguranca');
const { AVATARES } = require('../avatares');
const { avisar } = require('../tempo-real');
const { assincrono, soConvidado } = require('./util');

const router = express.Router();

// 20 tentativas de código por minuto por IP: suficiente para uma festa inteira no
// mesmo Wi-Fi, inútil para quem quer chutar códigos.
const freioEntrada = seg.criarFreio({ maximo: 20, janelaMs: 60 * 1000 });
const freioPerfil = seg.criarFreio({ maximo: 10, janelaMs: 60 * 1000 });
const freioBebidas = seg.criarFreio({ maximo: 40, janelaMs: 60 * 1000 });

router.get('/avatares', (_req, res) => res.json({ ok: true, avatares: AVATARES }));

router.post('/entrar', assincrono(async (req, res) => {
  if (!freioEntrada.tentar(req.ip)) {
    return res.status(429).json({ ok: false, erro: 'Muitas tentativas. Espere um minuto.' });
  }
  const codigo = String((req.body && req.body.codigo) || '').trim().toLowerCase();
  const c = await convidados.buscarPorCodigo(codigo);
  if (!c || !c.ativo) {
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
  res.json({ ok: true, eu: convidados.paraProprio(req.convidado) });
});

router.put('/eu/perfil', soConvidado, assincrono(async (req, res) => {
  if (!freioPerfil.tentar(req.convidado.id)) {
    return res.status(429).json({ ok: false, erro: 'Calma! Espere um pouco antes de mudar de novo.' });
  }
  const { avatar, exibir } = req.body || {};
  const atualizado = await convidados.atualizarPerfil(req.convidado.id, { avatar, exibir: exibir !== false });
  avisar.atualizar('confirmados');
  res.json({ ok: true, eu: convidados.paraProprio(atualizado) });
}));

// Tudo o que a tela do convidado precisa, numa ida só. `agora` é o relógio do
// servidor: a contagem regressiva calcula a diferença e ignora o relógio do celular.
router.get('/festa', soConvidado, assincrono(async (req, res) => {
  const [info, ativs, lista, beb] = await Promise.all([
    festa.info(), atividades.paraConvidado(), convidados.confirmados(), bebidas.paraConvidado(req.convidado.id),
  ]);
  res.json({ ok: true, agora: Date.now(), festa: info, atividades: ativs, confirmados: lista, bebidas: beb });
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

module.exports = router;
