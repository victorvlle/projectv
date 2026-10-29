// Quiz de Terror Relâmpago no estilo Kahoot.
//
// SALA: quem pode jogar toca em "Entrar na sala" no celular; o telão mostra quem entrou.
// O admin só toca em "Iniciar quiz". Daí em diante tudo anda sozinho pelo relógio do servidor:
//   preparar (5 s) → pergunta 1 (tempo) → resposta certa (7 s) → pergunta 2 → … → fim (placar do quiz)
// O cronograma é calculado a partir do horário de início: um telão ou celular que reconecta no meio
// cai na fase certa. Nenhuma pergunta futura nem a resposta certa sai do servidor antes da hora.
//
// PONTOS: +500 por acerto, dados quando a pergunta chega na fase "resposta certa" (sincronizar),
// uma vez só (chave única por pergunta e pessoa).
//
// MODO TESTE: com a atividade "Em teste", só testadores entram e respondem; tudo fica marcado e o
// "Apagar dados de teste" zera o quiz.

const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const pontos = require('./pontos');
const { ErroValidacao, limparTexto } = require('./convidados');
const { PONTOS_QUIZ, QUIZ_TEMPO_PADRAO_S } = require('../jogos/conteudo');

const LETRAS = ['A', 'B', 'C', 'D'];
const PREPARO_MS = 5000;
const REVELA_MS = 7000;

async function config() {
  return { tempoS: QUIZ_TEMPO_PADRAO_S, sessao: null, ...((await festa.ler('quiz')) || {}) };
}

async function todas() {
  const linhas = await banco.tudo('SELECT * FROM quiz_perguntas ORDER BY ordem');
  return linhas.map((l) => ({
    id: l.id, ordem: Number(l.ordem), texto: l.texto, opcoes: JSON.parse(l.opcoes), correta: Number(l.correta),
    reveladaEm: l.revelada_em != null ? Number(l.revelada_em) : null,
  }));
}

// Em que ponto do cronograma estamos.
function momento(sessao, agora) {
  if (!sessao) return { fase: 'sala' };
  const n = sessao.ids.length;
  const bloco = sessao.tempoS * 1000 + REVELA_MS;
  const inicio0 = sessao.inicioEm + PREPARO_MS;
  const inicioDe = (i) => inicio0 + i * bloco;
  const base = { n, bloco, inicioDe, tempoMs: sessao.tempoS * 1000 };
  const corte = sessao.encerradoEm != null ? Math.min(agora, sessao.encerradoEm) : agora;
  if (sessao.encerradoEm != null && agora >= sessao.encerradoEm) return { ...base, fase: 'fim', indice: n };
  if (corte < inicio0) return { ...base, fase: 'preparar', fimEm: inicio0 };
  const i = Math.floor((corte - inicio0) / bloco);
  if (i >= n) return { ...base, fase: 'fim', indice: n };
  const ini = inicioDe(i);
  if (corte < ini + base.tempoMs) return { ...base, fase: 'pergunta', indice: i, inicioEm: ini, fimEm: ini + base.tempoMs };
  return { ...base, fase: 'revelacao', indice: i, inicioEm: ini, fimEm: ini + bloco };
}

// Dá os pontos das perguntas cujo tempo já acabou. Devolve quantas foram reveladas agora.
async function sincronizar(agora = Date.now()) {
  const cfg = await config();
  const s = cfg.sessao;
  if (!s) return 0;
  const m = momento(s, agora);
  const limite = s.encerradoEm != null ? Math.min(agora, s.encerradoEm) : agora;
  const devidas = s.ids.filter((_, i) => m.inicioDe(i) + m.tempoMs <= limite);
  if (!devidas.length) return 0;
  const jaReveladas = new Set((await banco.tudo(
    `SELECT id FROM quiz_perguntas WHERE revelada_em IS NOT NULL AND id IN (${devidas.map(() => '?').join(',')})`, devidas)).map((l) => l.id));
  let novas = 0;
  for (const id of devidas.filter((x) => !jaReveladas.has(x))) {
    const i = s.ids.indexOf(id);
    const fimResposta = m.inicioDe(i) + m.tempoMs;
    const feita = await banco.transacao(async (tx) => {
      const r = await tx.execute({ sql: 'UPDATE quiz_perguntas SET lancada_em = ?, revelada_em = ?, teste = ? WHERE id = ? AND revelada_em IS NULL',
        args: [m.inicioDe(i), fimResposta, s.teste ? 1 : 0, id] });
      if (!r.rowsAffected) return false;
      const q = (await tx.execute({ sql: 'SELECT ordem, correta FROM quiz_perguntas WHERE id = ?', args: [id] })).rows[0];
      const certos = (await tx.execute({ sql: 'SELECT convidado_id, teste FROM quiz_respostas WHERE pergunta_id = ? AND escolha = ?', args: [id, q.correta] })).rows;
      for (const c of certos) {
        await pontos.conceder({ convidadoId: c.convidado_id, atividade: 'quiz', pontos: PONTOS_QUIZ,
          motivo: `Quiz: acertou a pergunta ${i + 1}`, chave: `quiz:${id}:${c.convidado_id}`, teste: Boolean(Number(c.teste)) }, tx);
      }
      return true;
    });
    if (feita) novas += 1;
  }
  return novas;
}

async function sala() {
  return banco.tudo(`SELECT c.id, c.nome, c.avatar, s.entrou_em FROM quiz_sala s JOIN convidados c ON c.id = s.convidado_id AND c.ativo = 1
    ORDER BY s.entrou_em`);
}
const iniciais = (nome) => String(nome || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

async function acertosNaSessao(s) {
  if (!s || !s.ids.length) return [];
  const linhas = await banco.tudo(
    `SELECT c.nome, c.avatar, r.convidado_id, COUNT(*) AS acertos FROM quiz_respostas r
       JOIN quiz_perguntas q ON q.id = r.pergunta_id AND q.revelada_em IS NOT NULL AND r.escolha = q.correta
       JOIN convidados c ON c.id = r.convidado_id
      WHERE r.pergunta_id IN (${s.ids.map(() => '?').join(',')})
      GROUP BY r.convidado_id, c.nome, c.avatar ORDER BY acertos DESC, c.nome COLLATE NOCASE`, s.ids);
  // Empate divide a posição (1, 1, 3…).
  let anterior = null;
  let posicao = 0;
  return linhas.map((l, i) => {
    if (Number(l.acertos) !== anterior) { posicao = i + 1; anterior = Number(l.acertos); }
    return { ...l, posicao };
  });
}

// ------------------------------------------------------------- convidado
async function paraConvidado(euId, agora = Date.now()) {
  await sincronizar(agora);
  const [cfg, lista, pessoas, minhasLinhas] = await Promise.all([
    config(), todas(), sala(),
    banco.tudo('SELECT pergunta_id, escolha FROM quiz_respostas WHERE convidado_id = ?', [euId]),
  ]);
  const s = cfg.sessao;
  const m = momento(s, agora);
  const minhas = new Map(minhasLinhas.map((l) => [l.pergunta_id, Number(l.escolha)]));
  const total = s ? s.ids.length : lista.length;
  const saida = {
    fase: m.fase, fimEm: m.fimEm || null, total, pontos: PONTOS_QUIZ, tempoS: s ? s.tempoS : cfg.tempoS,
    naSala: pessoas.some((p) => p.id === euId), naSalaTotal: pessoas.length,
  };
  if (s) {
    const porId = new Map(lista.map((q) => [q.id, q]));
    const reveladas = s.ids.slice(0, m.fase === 'fim' ? total : m.fase === 'revelacao' ? m.indice + 1 : m.indice || 0)
      .map((id) => porId.get(id)).filter((q) => q && q.reveladaEm != null);
    saida.acertos = reveladas.filter((q) => minhas.get(q.id) === q.correta).length;
    if (m.fase === 'pergunta' || m.fase === 'revelacao') {
      const q = porId.get(s.ids[m.indice]);
      const minha = minhas.has(q.id) ? minhas.get(q.id) : null;
      saida.atual = { id: q.id, numero: m.indice + 1, texto: q.texto, opcoes: q.opcoes, minha };
      if (m.fase === 'revelacao') Object.assign(saida.atual, { correta: q.correta, acertei: minha === q.correta });
      saida.proxima = m.fase === 'revelacao' && m.indice + 1 < total;
    }
    if (m.fase === 'fim') {
      const placar = await acertosNaSessao(s);
      saida.placar = placar.slice(0, 5).map((p) => ({ nome: p.nome, avatar: p.avatar, acertos: Number(p.acertos), posicao: p.posicao }));
    }
  }
  return saida;
}

async function entrar(eu, agora = Date.now()) {
  const { liberada, teste } = await atividades.acesso('quiz', eu, agora);
  if (!liberada) throw new ErroValidacao('O Quiz ainda não está aberto.', 403);
  const r = await banco.rodar('INSERT OR IGNORE INTO quiz_sala (convidado_id, entrou_em, teste) VALUES (?, ?, ?)', [eu.id, agora, teste ? 1 : 0]);
  return Boolean(r.rowsAffected);
}

// `eu`: a linha do convidado (id e testador). Responder também coloca a pessoa na sala.
async function responder(eu, perguntaId, escolha, agora = Date.now()) {
  const { liberada, teste } = await atividades.acesso('quiz', eu, agora);
  if (!liberada) throw new ErroValidacao('O Quiz ainda não está aberto.', 403);
  const cfg = await config();
  const m = momento(cfg.sessao, agora);
  if (m.fase !== 'pergunta' || cfg.sessao.ids[m.indice] !== String(perguntaId)) {
    throw new ErroValidacao('O tempo dessa pergunta acabou.', 409);
  }
  const q = (await todas()).find((x) => x.id === String(perguntaId));
  const n = Number(escolha);
  if (!Number.isInteger(n) || n < 0 || n >= q.opcoes.length) throw new ErroValidacao('Escolha uma das opções.');
  await banco.rodar('INSERT OR IGNORE INTO quiz_sala (convidado_id, entrou_em, teste) VALUES (?, ?, ?)', [eu.id, agora, teste ? 1 : 0]);
  const r = await banco.rodar(
    'INSERT OR IGNORE INTO quiz_respostas (pergunta_id, convidado_id, escolha, respondida_em, teste) VALUES (?, ?, ?, ?, ?)',
    [q.id, eu.id, n, agora, teste ? 1 : 0]);
  if (!r.rowsAffected) throw new ErroValidacao('Você já respondeu essa pergunta. Só vale uma resposta.', 409);
  return { escolha: n };
}

// ------------------------------------------------------------------ admin
async function paraAdmin(agora = Date.now()) {
  await sincronizar(agora);
  const [cfg, lista, uso, pessoas] = await Promise.all([config(), todas(), atividades.emUso('quiz', agora), sala()]);
  const m = momento(cfg.sessao, agora);
  const contagens = await banco.tudo('SELECT pergunta_id, escolha, COUNT(*) AS n FROM quiz_respostas GROUP BY pergunta_id, escolha');
  const porOpcao = (id) => [0, 1, 2, 3].map((i) => Number((contagens.find((c) => c.pergunta_id === id && Number(c.escolha) === i) || {}).n || 0));
  return {
    tempoS: cfg.tempoS, revelaS: REVELA_MS / 1000, pontos: PONTOS_QUIZ, liberada: uso.ativa, emTeste: uso.teste,
    fase: m.fase, indice: m.indice ?? null, total: cfg.sessao ? cfg.sessao.ids.length : lista.length, fimEm: m.fimEm || null,
    sala: pessoas.map((p) => ({ nome: p.nome, avatar: p.avatar })),
    perguntas: lista.map((q) => ({ ...q, porOpcao: porOpcao(q.id), respostas: porOpcao(q.id).reduce((a, b) => a + b, 0) })),
    letras: LETRAS,
  };
}

async function iniciar({ quantas } = {}, agora = Date.now()) {
  const uso = await atividades.emUso('quiz', agora);
  if (!uso.ativa) throw new ErroValidacao('Libere o Quiz (ou coloque "Em teste") na aba Atividades antes de iniciar.', 409);
  const cfg = await config();
  const m = momento(cfg.sessao, agora);
  if (m.fase !== 'sala' && m.fase !== 'fim') throw new ErroValidacao('O quiz já está rolando.', 409);
  const pessoas = await sala();
  if (!pessoas.length) throw new ErroValidacao('Ninguém entrou na sala ainda.', 409);
  // Pega as próximas perguntas ainda não jogadas: dá para fazer o quiz em rodadas (ex.: 5 agora, 5 mais tarde).
  const livres = (await todas()).filter((q) => q.reveladaEm == null);
  if (!livres.length) throw new ErroValidacao('Todas as perguntas já foram jogadas. Use "Recomeçar do zero" para jogar de novo.', 409);
  const n = Math.max(1, Math.min(livres.length, Number(quantas) || livres.length));
  const escolhidas = livres.slice(0, n);
  await banco.rodar(`DELETE FROM quiz_respostas WHERE pergunta_id IN (${escolhidas.map(() => '?').join(',')})`, escolhidas.map((q) => q.id));
  await festa.gravar('quiz', { ...cfg, sessao: { inicioEm: agora, ids: escolhidas.map((q) => q.id), tempoS: cfg.tempoS, teste: uso.teste, encerradoEm: null } });
  await festa.definirTelao({ modo: 'quiz' });
}

// Para no meio: a pergunta em andamento não vale; o telão vai para o placar.
async function encerrar(agora = Date.now()) {
  const cfg = await config();
  const m = momento(cfg.sessao, agora);
  if (m.fase === 'sala' || m.fase === 'fim') throw new ErroValidacao('O quiz não está rolando.', 409);
  await sincronizar(agora);
  await festa.gravar('quiz', { ...cfg, sessao: { ...cfg.sessao, encerradoEm: agora } });
}

// Zera o quiz: respostas, pontos do quiz, sala e perguntas jogadas (para testar de novo).
async function recomecar() {
  const cfg = await config();
  await banco.lote([
    { sql: 'DELETE FROM quiz_respostas', args: [] },
    { sql: 'DELETE FROM quiz_sala', args: [] },
    { sql: "DELETE FROM pontos_log WHERE atividade = 'quiz'", args: [] },
    { sql: 'UPDATE quiz_perguntas SET lancada_em = NULL, revelada_em = NULL, teste = 0', args: [] },
  ]);
  await festa.gravar('quiz', { ...cfg, sessao: null });
}

async function editar(perguntaId, { texto, opcoes, correta }) {
  const cfg = await config();
  if (['preparar', 'pergunta', 'revelacao'].includes(momento(cfg.sessao, Date.now()).fase)) throw new ErroValidacao('Espere o quiz acabar para editar.', 409);
  const q = await banco.um('SELECT * FROM quiz_perguntas WHERE id = ?', [String(perguntaId)]);
  if (!q) throw new ErroValidacao('Pergunta não encontrada.', 404);
  if (q.revelada_em != null) throw new ErroValidacao('Essa pergunta já foi jogada.', 409);
  const t = limparTexto(texto, 200);
  if (t.length < 5) throw new ErroValidacao('Escreva a pergunta.');
  const ops = (Array.isArray(opcoes) ? opcoes : []).map((o) => limparTexto(o, 60));
  if (ops.length !== 4 || ops.some((o) => !o)) throw new ErroValidacao('Preencha as 4 opções.');
  const c = Number(correta);
  if (!Number.isInteger(c) || c < 0 || c > 3) throw new ErroValidacao('Marque qual opção é a certa.');
  await banco.rodar('UPDATE quiz_perguntas SET texto = ?, opcoes = ?, correta = ? WHERE id = ?', [t, JSON.stringify(ops), c, q.id]);
}

async function definirTempo(segundos) {
  const s = Number(segundos);
  if (!Number.isInteger(s) || s < 10 || s > 120) throw new ErroValidacao('Tempo entre 10 e 120 segundos.');
  const cfg = await config();
  await festa.gravar('quiz', { ...cfg, tempoS: s });
}

// ------------------------------------------------------------------ telão
async function paraTelao(agora = Date.now()) {
  await sincronizar(agora);
  const [cfg, lista, pessoas] = await Promise.all([config(), todas(), sala()]);
  const s = cfg.sessao;
  const m = momento(s, agora);
  const saida = {
    fase: m.fase, fimEm: m.fimEm || null, total: s ? s.ids.length : lista.length,
    sala: pessoas.map((p) => ({ avatar: p.avatar, iniciais: iniciais(p.nome) })),
  };
  if (m.fase === 'pergunta' || m.fase === 'revelacao') {
    const q = lista.find((x) => x.id === s.ids[m.indice]);
    const cont = await banco.tudo('SELECT escolha, COUNT(*) AS n FROM quiz_respostas WHERE pergunta_id = ? GROUP BY escolha', [q.id]);
    const porOpcao = [0, 1, 2, 3].map((i) => Number((cont.find((c) => Number(c.escolha) === i) || {}).n || 0));
    saida.atual = { numero: m.indice + 1, texto: q.texto, opcoes: q.opcoes, respostas: porOpcao.reduce((a, b) => a + b, 0) };
    if (m.fase === 'revelacao') {
      const acertaram = await banco.tudo(
        `SELECT c.nome, c.avatar FROM quiz_respostas r JOIN convidados c ON c.id = r.convidado_id
          WHERE r.pergunta_id = ? AND r.escolha = ? ORDER BY r.respondida_em LIMIT 24`, [q.id, q.correta]);
      Object.assign(saida.atual, { correta: q.correta, porOpcao, acertaram });
      saida.proxima = m.indice + 1 < s.ids.length;
    }
  }
  if (m.fase === 'fim') {
    saida.placar = (await acertosNaSessao(s)).slice(0, 5).map((p) => ({ nome: p.nome, avatar: p.avatar, acertos: Number(p.acertos), posicao: p.posicao, pontos: Number(p.acertos) * PONTOS_QUIZ }));
  }
  return saida;
}

module.exports = {
  config, momento, sincronizar, paraConvidado, entrar, responder, paraAdmin, iniciar, encerrar, recomecar, editar, definirTempo, paraTelao,
  LETRAS, PREPARO_MS, REVELA_MS,
};
