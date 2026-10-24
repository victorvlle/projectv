// Rotas do painel admin (e do telão, que usa a mesma sessão de admin).
//
// Travas: sem ADMIN_SEGREDO o login sempre falha; senha comparada em tempo
// constante; freio de tentativas erradas por IP; sessão assinada que expira.

const express = require('express');
const convidados = require('../dados/convidados');
const festa = require('../dados/festa');
const atividades = require('../dados/atividades');
const backup = require('../dados/backup');
const bebidas = require('../dados/bebidas');
const banco = require('../dados/banco');
const seg = require('../seguranca');
const { avisar } = require('../tempo-real');
const { assincrono, soAdmin } = require('./util');

const router = express.Router();
const freioLogin = seg.criarFreio({ maximo: 8, janelaMs: 60 * 1000 });

function baseUrl(req) {
  return (process.env.URL_PUBLICA || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

const comLink = (req, c) => ({ ...c, link: `${baseUrl(req)}/c/${c.codigo}` });

router.post('/entrar', (req, res) => {
  if (!seg.adminLigado()) return res.status(503).json({ ok: false, erro: 'Painel desligado: defina ADMIN_SEGREDO no servidor.' });
  const senha = String((req.body && req.body.senha) || '');
  if (seg.senhaAdminConfere(senha)) {
    freioLogin.zerar(req.ip);
    return res.json({ ok: true, token: seg.criarSessaoAdmin() });
  }
  // Só tentativa ERRADA conta para o freio.
  if (!freioLogin.tentar(req.ip)) {
    return res.status(429).json({ ok: false, erro: 'Muitas tentativas erradas. Espere um minuto.' });
  }
  return res.status(401).json({ ok: false, erro: 'Senha incorreta.' });
});

router.use(soAdmin);

router.get('/estado', assincrono(async (req, res) => {
  const [lista, info, ativs, telao] = await Promise.all([
    convidados.listarParaAdmin(), festa.info(), atividades.paraAdmin(), festa.telao(),
  ]);
  res.json({
    ok: true,
    agora: Date.now(),
    banco: banco.ondeEsta(),
    convidados: lista.map((c) => comLink(req, c)),
    festa: info,
    atividades: ativs,
    telao,
  });
}));

// ------------------------------------------------------------- convidados
// Aceita um nome ou vários (um por linha) para cadastrar a lista de pagantes de uma vez.
router.post('/convidados', assincrono(async (req, res) => {
  const corpo = req.body || {};
  const nomes = Array.isArray(corpo.nomes)
    ? corpo.nomes
    : String(corpo.nome || '').split(/\r?\n/);
  const validos = nomes.map((n) => String(n).trim()).filter(Boolean).slice(0, 200);
  if (!validos.length) return res.status(400).json({ ok: false, erro: 'Informe pelo menos um nome.' });
  const criados = [];
  for (const nome of validos) {
    const c = await convidados.criar(nome);
    criados.push(comLink(req, convidados.paraAdmin(c)));
  }
  avisar.atualizar('convidados');
  res.status(201).json({ ok: true, criados });
}));

router.patch('/convidados/:id', assincrono(async (req, res) => {
  const permitidos = ['nome', 'apelido', 'avatar', 'ativo', 'fora', 'exibir'];
  const campos = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => permitidos.includes(k)));
  const c = await convidados.editar(req.params.id, campos);
  if (campos.ativo === false) avisar.expulsar(req.params.id);
  avisar.atualizar('convidados');
  res.json({ ok: true, convidado: comLink(req, convidados.paraAdmin(c)) });
}));

router.post('/convidados/:id/regenerar', assincrono(async (req, res) => {
  const c = await convidados.regenerarLink(req.params.id);
  avisar.expulsar(req.params.id);
  avisar.atualizar('convidados');
  res.json({ ok: true, convidado: comLink(req, convidados.paraAdmin(c)) });
}));

router.delete('/convidados/:id', assincrono(async (req, res) => {
  await convidados.excluir(req.params.id);
  avisar.expulsar(req.params.id);
  avisar.atualizar('convidados');
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- festa
router.put('/festa', assincrono(async (req, res) => {
  const info = await festa.editar(req.body || {});
  avisar.atualizar('festa');
  res.json({ ok: true, festa: info });
}));

router.put('/atividades/:id', assincrono(async (req, res) => {
  await atividades.definir(req.params.id, req.body || {});
  avisar.atualizar('atividades');
  res.json({ ok: true, atividades: await atividades.paraAdmin() });
}));

router.put('/telao', assincrono(async (req, res) => {
  const t = await festa.definirTelao(req.body || {});
  avisar.atualizar('telao');
  res.json({ ok: true, telao: t });
}));

// Dados do telão (mesma sessão do admin; o telão roda no notebook do organizador).
router.get('/telao', assincrono(async (req, res) => {
  const [info, ativs, lista, telao] = await Promise.all([
    festa.info(), atividades.paraConvidado(), convidados.confirmados(), festa.telao(),
  ]);
  res.json({ ok: true, agora: Date.now(), festa: info, atividades: ativs, confirmados: lista, telao });
}));

// ------------------------------------------------------- lista de bebidas
async function responderBebidas(res, status = 200) {
  avisar.atualizar('bebidas');
  res.status(status).json({ ok: true, bebidas: await bebidas.paraAdmin() });
}

router.get('/bebidas', assincrono(async (_req, res) => {
  res.json({ ok: true, bebidas: await bebidas.paraAdmin() });
}));

router.post('/bebidas/itens', assincrono(async (req, res) => {
  const { nome, unidade, meta } = req.body || {};
  await bebidas.criarItem({ nome, unidade, meta });
  await responderBebidas(res, 201);
}));

router.patch('/bebidas/itens/:id', assincrono(async (req, res) => {
  const { nome, unidade, meta } = req.body || {};
  await bebidas.editarItem(req.params.id, { nome, unidade, meta });
  await responderBebidas(res);
}));

router.delete('/bebidas/itens/:id', assincrono(async (req, res) => {
  await bebidas.excluirItem(req.params.id);
  await responderBebidas(res);
}));

router.delete('/bebidas/compromissos/:id', assincrono(async (req, res) => {
  await bebidas.removerCompromisso(req.params.id);
  await responderBebidas(res);
}));

router.put('/bebidas/aberta', assincrono(async (req, res) => {
  await bebidas.definirAberta((req.body || {}).aberta !== false);
  await responderBebidas(res);
}));

// ---------------------------------------------------------------- backup
router.get('/backup', assincrono(async (_req, res) => {
  const dados = await backup.exportar();
  const nome = `projectv-backup-${dados.geradoEm.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.json(dados);
}));

router.post('/restaurar', express.json({ limit: '200mb' }), assincrono(async (req, res) => {
  const r = await backup.restaurar(req.body);
  avisar.atualizar('tudo');
  res.json({ ok: true, ...r });
}));

module.exports = router;
