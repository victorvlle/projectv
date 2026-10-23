// Rotas do convidado: entrar pelo link, perfil e tudo o que a tela pré-festa mostra.

const express = require('express');
const convidados = require('../dados/convidados');
const festa = require('../dados/festa');
const atividades = require('../dados/atividades');
const seg = require('../seguranca');
const { AVATARES } = require('../avatares');
const { avisar } = require('../tempo-real');
const { assincrono, soConvidado } = require('./util');

const router = express.Router();

// 20 tentativas de código por minuto por IP: suficiente para uma festa inteira no
// mesmo Wi-Fi, inútil para quem quer chutar códigos.
const freioEntrada = seg.criarFreio({ maximo: 20, janelaMs: 60 * 1000 });
const freioPerfil = seg.criarFreio({ maximo: 10, janelaMs: 60 * 1000 });

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
  const { apelido, avatar, exibir } = req.body || {};
  const atualizado = await convidados.atualizarPerfil(req.convidado.id, { apelido, avatar, exibir: exibir !== false });
  avisar.atualizar('confirmados');
  res.json({ ok: true, eu: convidados.paraProprio(atualizado) });
}));

// Tudo o que a tela do convidado precisa, numa ida só. `agora` é o relógio do
// servidor: a contagem regressiva calcula a diferença e ignora o relógio do celular.
router.get('/festa', soConvidado, assincrono(async (req, res) => {
  const [info, ativs, lista] = await Promise.all([
    festa.info(), atividades.paraConvidado(), convidados.confirmados(),
  ]);
  res.json({ ok: true, agora: Date.now(), festa: info, atividades: ativs, confirmados: lista });
}));

module.exports = router;
