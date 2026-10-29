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
const playlist = require('../dados/playlist');
const caronas = require('../dados/caronas');
const pos = require('../dados/pos');
const previsoes = require('../dados/previsoes');
const maldicao = require('../dados/maldicao');
const enigmas = require('../dados/enigmas');
const pontos = require('../dados/pontos');
const colaboracao = require('../dados/colaboracao');
const quiz = require('../dados/quiz');
const concurso = require('../dados/concurso');
const correio = require('../dados/correio');
const teste = require('../dados/teste');
const anunciar = require('../jogos/anunciar');
const notificacoes = require('../notificacoes');
const { porId } = require('../atividades/catalogo');
const banco = require('../dados/banco');
const seg = require('../seguranca');
const { avisar } = require('../tempo-real');
const { assincrono, soAdmin } = require('./util');

const router = express.Router();
const freioAvisos = seg.criarFreio({ maximo: 10, janelaMs: 60 * 1000 });
// Dois freios para a senha do admin, contando só tentativas ERRADAS:
//  - por IP: 8 erros por minuto;
//  - geral: 30 erros por minuto somando todo mundo. Esse segundo existe porque o IP
//    pode ser forjado (cabeçalho X-Forwarded-For) dependendo do proxy da hospedagem.
// O bloqueio é conferido ANTES da senha: bloqueado, nem o chute certo passa.
const freioLogin = seg.criarFreio({ maximo: 8, janelaMs: 60 * 1000 });
const freioLoginGeral = seg.criarFreio({ maximo: 30, janelaMs: 60 * 1000 });

function baseUrl(req) {
  return (process.env.URL_PUBLICA || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

const comLink = (req, c) => ({ ...c, link: `${baseUrl(req)}/c/${c.codigo}` });

router.post('/entrar', (req, res) => {
  if (!seg.adminLigado()) return res.status(503).json({ ok: false, erro: 'Painel desligado: defina ADMIN_SEGREDO no servidor.' });
  if (freioLogin.estourou(req.ip) || freioLoginGeral.estourou('*')) {
    return res.status(429).json({ ok: false, erro: 'Muitas tentativas erradas. Espere um minuto.' });
  }
  const senha = String((req.body && req.body.senha) || '');
  if (seg.senhaAdminConfere(senha)) {
    freioLogin.zerar(req.ip);
    return res.json({ ok: true, token: seg.criarSessaoAdmin() });
  }
  freioLogin.tentar(req.ip);
  freioLoginGeral.tentar('*');
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
  const permitidos = ['nome', 'avatar', 'ativo', 'fora', 'testador'];
  const campos = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => permitidos.includes(k)));
  const c = await convidados.editar(req.params.id, campos);
  if (campos.ativo === false) {
    avisar.expulsar(req.params.id);
    await notificacoes.removerDoConvidado(req.params.id);
  }
  avisar.atualizar('convidados');
  res.json({ ok: true, convidado: comLink(req, convidados.paraAdmin(c)) });
}));

router.post('/convidados/:id/regenerar', assincrono(async (req, res) => {
  const c = await convidados.regenerarLink(req.params.id);
  avisar.expulsar(req.params.id);
  // Link repassado: o aparelho de quem recebeu o link antigo para de receber avisos.
  await notificacoes.removerDoConvidado(req.params.id);
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
  const antes = (await atividades.paraAdmin()).find((a) => a.id === req.params.id);
  await atividades.definir(req.params.id, req.body || {});
  const depois = (await atividades.paraAdmin()).find((a) => a.id === req.params.id);
  if (antes && depois && antes.efetivo !== 'liberada' && depois.efetivo === 'liberada') {
    notificacoes.atividadeLiberada(porId(depois.id)).catch((e) => console.error('[push]', e.message));
  }
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
  const [info, ativs, lista, telao, rank, mal, qz, conc, cartas] = await Promise.all([
    festa.info(), atividades.paraConvidado(), convidados.confirmados(), festa.telao(), pontos.ranking(), maldicao.atual(),
    quiz.paraTelao(), concurso.paraTelao(), correio.paraTelao(),
  ]);
  const confirmados = lista.map((c) => ({ nome: c.nome, avatar: c.avatar }));
  res.json({
    ok: true, agora: Date.now(), festa: info, atividades: ativs, confirmados, telao, pos: await pos.resultado(),
    previsao: await previsoes.paraTelao(telao.previsao),
    ranking: rank.slice(0, 10).map((r) => ({ nome: r.nome, avatar: r.avatar, pontos: r.pontos, posicao: r.posicao })),
    maldicao: mal, quiz: qz, concurso: conc, correio: cartas,
  });
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

// ------------------------------------------- playlist, caronas e o pós
router.get('/extras', assincrono(async (_req, res) => {
  const [musicas, carros, noite] = await Promise.all([playlist.listar(null), caronas.listar(null), pos.resultado()]);
  res.json({ ok: true, playlist: musicas, caronas: carros, pos: noite });
}));
const pronto = (oque) => (res) => { avisar.atualizar(oque); res.json({ ok: true }); };
router.delete('/playlist/:id', assincrono(async (req, res) => { await playlist.remover(req.params.id); pronto('playlist')(res); }));
router.delete('/caronas/:id', assincrono(async (req, res) => { await caronas.removerOferta(req.params.id); pronto('caronas')(res); }));
router.post('/pos/opcoes', assincrono(async (req, res) => { await pos.criarOpcao((req.body || {}).nome); pronto('pos')(res); }));
router.patch('/pos/opcoes/:id', assincrono(async (req, res) => { await pos.renomearOpcao(req.params.id, (req.body || {}).nome); pronto('pos')(res); }));
router.delete('/pos/opcoes/:id', assincrono(async (req, res) => { await pos.removerOpcao(req.params.id); pronto('pos')(res); }));

// --------------------------------------------------------------- avisos
router.get('/avisos', assincrono(async (_req, res) => {
  const [resumo, programados, historico, inscritos, registro] = await Promise.all([
    notificacoes.resumo(), notificacoes.programados(), notificacoes.historico(), notificacoes.inscritos(), notificacoes.registro24h()]);
  res.json({ ok: true, resumo, programados, historico, inscritos, registro, maxPorHora: notificacoes.MAX_POR_HORA });
}));
// `id` vem do painel (um por envio): clicar duas vezes ou repetir a requisição não manda de novo.
const ID_ENVIO = /^[A-Za-z0-9-]{8,64}$/;
router.post('/avisos', assincrono(async (req, res) => {
  const b = req.body || {};
  if (!ID_ENVIO.test(String(b.id || ''))) return res.status(400).json({ ok: false, erro: 'Envio sem identificação. Recarregue o painel.' });
  if (!freioAvisos.tentar('admin')) return res.status(429).json({ ok: false, erro: 'Muitos avisos seguidos. Espere um minuto.' });
  const { limparTexto } = require('../dados/convidados');
  // Todo aviso se identifica: "Project V: <título>" (o Chrome mostra só o domínio).
  let titulo = limparTexto(b.titulo, 48);
  titulo = !titulo ? 'Project V' : /^Project V\b/i.test(titulo) ? titulo.replace(/^project v/i, 'Project V') : `Project V: ${titulo}`;
  const corpo = limparTexto(b.corpo, 180);
  if (corpo.length < 2) return res.status(400).json({ ok: false, erro: 'Escreva a mensagem.' });
  const url = notificacoes.DESTINOS.has(b.url) ? b.url : '/';
  const r = await notificacoes.enviar({ titulo, corpo, url, tag: `aviso-${b.id}`, chave: `manual:${b.id}` });
  res.json({ ok: true, ...r });
}));
// Teste para uma pessoa só (todos os aparelhos dela). Não entra na trava de envio único.
router.post('/avisos/teste', assincrono(async (req, res) => {
  if (!freioAvisos.tentar('admin')) return res.status(429).json({ ok: false, erro: 'Muitos avisos seguidos. Espere um minuto.' });
  const id = String((req.body || {}).convidadoId || '');
  const alvo = (await notificacoes.inscritos()).find((i) => i.id === id);
  if (!alvo) return res.status(404).json({ ok: false, erro: 'Essa pessoa não tem avisos ativados.' });
  // No máximo 1 teste a cada 10 min por pessoa (trava no banco).
  const r = await notificacoes.enviar({
    titulo: 'Project V: teste do organizador', corpo: 'O organizador está conferindo se os avisos da festa chegam no seu aparelho.',
    url: '/#avisos', tag: 'teste-admin', para: { ids: [id] },
    chave: `teste:admin:${id}:${Math.floor(Date.now() / notificacoes.ESPERA_TESTE_MS)}`,
  });
  if (r.pulado) return res.status(429).json({ ok: false, erro: `Já foi um teste para ${alvo.nome} há pouco. Espere alguns minutos.` });
  return res.json({ ok: true, nome: alvo.nome, ...r });
}));

// ----------------------------------------------------------------- jogos
router.get('/jogos', assincrono(async (_req, res) => {
  const [prev, mal, enig, rank, beb, qz, conc, cartas] = await Promise.all([
    previsoes.paraAdmin(), maldicao.paraAdmin(), enigmas.paraAdmin(), pontos.ranking(), colaboracao.bebidasParaAdmin(),
    quiz.paraAdmin(), concurso.paraAdmin(), correio.paraAdmin(),
  ]);
  res.json({ ok: true, agora: Date.now(), previsoes: prev, maldicao: mal, enigmas: enig, ranking: rank, bebidas: beb, quiz: qz, concurso: conc, correio: cartas });
}));
const jogosMudou = (res, oque = 'jogos') => { avisar.atualizar(oque); res.json({ ok: true }); };

router.post('/previsoes/encerrar', assincrono(async (_req, res) => { await previsoes.encerrar(); jogosMudou(res, 'previsoes'); }));
router.post('/previsoes/reabrir', assincrono(async (_req, res) => { await previsoes.reabrir(); jogosMudou(res, 'previsoes'); }));
router.put('/previsoes/:id/resposta', assincrono(async (req, res) => {
  await previsoes.definirResposta(req.params.id, (req.body || {}).resposta ?? null);
  jogosMudou(res, 'previsoes');
}));
router.post('/previsoes/publicar', assincrono(async (_req, res) => {
  const r = await previsoes.publicar();
  avisar.atualizar('ranking');
  res.json({ ok: true, ...r });
}));
router.post('/previsoes/despublicar', assincrono(async (_req, res) => { await previsoes.despublicar(); jogosMudou(res, 'ranking'); }));

router.put('/maldicao', assincrono(async (req, res) => {
  const b = req.body || {};
  const cfg = await maldicao.configurar({ ligada: b.ligada, intensidade: b.intensidade, minMin: b.minMin, maxMin: b.maxMin });
  avisar.admin('atualizar', { oque: 'maldicao' });
  res.json({ ok: true, config: cfg });
}));
// `id` vem do painel, um por clique: clique duplo não sorteia duas vezes.
router.post('/maldicao/sortear', assincrono(async (req, res) => {
  const id = String((req.body || {}).id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return res.status(400).json({ ok: false, erro: 'Clique sem identificação. Recarregue o painel.' });
  const r = await maldicao.sortear({ origem: 'manual', chave: `manual:${id}` });
  if (!r.repetido) await anunciar.maldicaoSorteada(r.maldicao);
  return res.json({ ok: true, repetido: r.repetido, maldicao: r.maldicao });
}));
router.post('/maldicao/:id/resolver', assincrono(async (req, res) => {
  const r = await maldicao.resolver(req.params.id, (req.body || {}).estado);
  if (!r.jaResolvida) anunciar.maldicaoResolvida(r.maldicao);
  res.json({ ok: true, ...r });
}));

router.put('/enigmas/:id', assincrono(async (req, res) => { await enigmas.editar(req.params.id, req.body || {}); jogosMudou(res, 'enigmas'); }));
router.put('/enigmas-bonus', assincrono(async (req, res) => { await enigmas.definirBonus((req.body || {}).bonus); jogosMudou(res); }));
router.put('/enigmas-tempo', assincrono(async (req, res) => { await enigmas.definirTempo((req.body || {}).segundos); jogosMudou(res, 'enigmas'); }));

router.put('/colaboracao/bebida/:convidadoId', assincrono(async (req, res) => {
  const r = await colaboracao.confirmarBebida(req.params.convidadoId, (req.body || {}).levou === true);
  avisar.atualizar('ranking');
  res.json({ ok: true, ...r });
}));

// ----------------------------------------------------------------- quiz
router.post('/quiz/iniciar', assincrono(async (req, res) => { await quiz.iniciar({ quantas: (req.body || {}).quantas }); jogosMudou(res, 'quiz'); }));
router.post('/quiz/encerrar', assincrono(async (_req, res) => { await quiz.encerrar(); avisar.atualizar('ranking'); jogosMudou(res, 'quiz'); }));
router.post('/quiz/recomecar', assincrono(async (_req, res) => { await quiz.recomecar(); avisar.atualizar('ranking'); jogosMudou(res, 'quiz'); }));
router.put('/quiz/:id', assincrono(async (req, res) => { await quiz.editar(req.params.id, req.body || {}); jogosMudou(res, 'quiz'); }));
router.put('/quiz-tempo', assincrono(async (req, res) => { await quiz.definirTempo((req.body || {}).segundos); jogosMudou(res, 'quiz'); }));

// ------------------------------------------------------------- concurso
router.post('/concurso/:estado', assincrono(async (req, res) => {
  const e = req.params.estado;
  if (e === 'desfile') await concurso.mudar('desfile');
  else if (e === 'abrir') await concurso.mudar('aberto');
  else if (e === 'encerrar') await concurso.mudar('encerrado');
  else if (e === 'publicar') { const r = await concurso.publicar(); avisar.atualizar('ranking'); return res.json({ ok: true, ...r }); }
  else if (e === 'despublicar') { await concurso.despublicar(); avisar.atualizar('ranking'); }
  else return res.status(404).json({ ok: false, erro: 'Ação desconhecida.' });
  return jogosMudou(res, 'concurso');
}));

// --------------------------------------------------------------- correio
router.post('/correio/:id/:estado', assincrono(async (req, res) => {
  const estado = { aprovar: 'aprovada', recusar: 'recusada' }[req.params.estado];
  if (!estado) return res.status(404).json({ ok: false, erro: 'Ação desconhecida.' });
  await correio.moderar(req.params.id, estado);
  avisar.admin('atualizar', { oque: 'correio' });
  avisar.telao('atualizar', { oque: 'correio' });
  avisar.atualizar('correio');
  return res.json({ ok: true });
}));

// ---------------------------------------------------------- modo teste
router.post('/teste/apagar', assincrono(async (_req, res) => {
  const r = await teste.apagarDadosDeTeste();
  avisar.atualizar('tudo');
  res.json({ ok: true, ...r });
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
