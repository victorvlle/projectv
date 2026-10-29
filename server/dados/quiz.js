// Quiz de Terror Relâmpago: o admin lança uma pergunta por vez; ela aparece no telão e no
// celular de quem pode jogar. Cada pessoa tem UMA resposta por pergunta, dentro do tempo.
//
// FASES de uma pergunta (relógio do servidor):
//   nao-lancada · respondendo (até lancada_em + tempo) · tempo-esgotado · revelada
// A resposta certa nunca sai do servidor antes de "revelada". Os pontos (+500) entram ao revelar.
//
// MODO TESTE: com a atividade "Em teste", só os testadores respondem; a pergunta e as respostas
// ficam marcadas e o "Apagar dados de teste" volta a pergunta para "não lançada".

const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const pontos = require('./pontos');
const { ErroValidacao, limparTexto } = require('./convidados');
const { PONTOS_QUIZ, QUIZ_TEMPO_PADRAO_S } = require('../jogos/conteudo');

const LETRAS = ['A', 'B', 'C', 'D'];

async function config() {
  return { atual: null, tempoS: QUIZ_TEMPO_PADRAO_S, ...((await festa.ler('quiz')) || {}) };
}

function montar(l, tempoS, agora) {
  const lancadaEm = l.lancada_em != null ? Number(l.lancada_em) : null;
  const fimEm = lancadaEm != null ? lancadaEm + tempoS * 1000 : null;
  let fase = 'nao-lancada';
  if (l.revelada_em != null) fase = 'revelada';
  else if (lancadaEm != null) fase = agora < fimEm ? 'respondendo' : 'tempo-esgotado';
  return {
    id: l.id, ordem: Number(l.ordem), texto: l.texto, opcoes: JSON.parse(l.opcoes), correta: Number(l.correta),
    lancadaEm, fimEm, reveladaEm: l.revelada_em != null ? Number(l.revelada_em) : null, fase, teste: Boolean(Number(l.teste)),
  };
}

async function perguntas(agora = Date.now()) {
  const [cfg, linhas] = await Promise.all([config(), banco.tudo('SELECT * FROM quiz_perguntas ORDER BY ordem')]);
  return { cfg, lista: linhas.map((l) => montar(l, cfg.tempoS, agora)) };
}

async function contagem(perguntaId) {
  const linhas = await banco.tudo('SELECT escolha, COUNT(*) AS n FROM quiz_respostas WHERE pergunta_id = ? GROUP BY escolha', [perguntaId]);
  const porOpcao = [0, 0, 0, 0];
  for (const l of linhas) if (porOpcao[Number(l.escolha)] !== undefined) porOpcao[Number(l.escolha)] = Number(l.n);
  return { porOpcao, total: porOpcao.reduce((a, b) => a + b, 0) };
}

// ------------------------------------------------------------- convidado
async function paraConvidado(euId, agora = Date.now()) {
  const { cfg, lista } = await perguntas(agora);
  const minhas = new Map((await banco.tudo('SELECT pergunta_id, escolha FROM quiz_respostas WHERE convidado_id = ?', [euId]))
    .map((l) => [l.pergunta_id, Number(l.escolha)]));
  const ver = (q) => {
    const minha = minhas.has(q.id) ? minhas.get(q.id) : null;
    const base = { id: q.id, ordem: q.ordem, fase: q.fase, minha };
    if (q.fase === 'nao-lancada') return base;
    const visivel = { ...base, texto: q.texto, opcoes: q.opcoes, fimEm: q.fimEm };
    if (q.fase !== 'revelada') return visivel;
    return { ...visivel, correta: q.correta, acertei: minha === q.correta };
  };
  const atual = lista.find((q) => q.id === cfg.atual) || null;
  const reveladas = lista.filter((q) => q.fase === 'revelada');
  return {
    tempoS: cfg.tempoS, pontos: PONTOS_QUIZ, total: lista.length,
    atual: atual ? ver(atual) : null,
    historico: reveladas.filter((q) => !atual || q.id !== atual.id).map(ver),
    acertos: reveladas.filter((q) => minhas.get(q.id) === q.correta).length,
  };
}

// `eu`: a linha do convidado (id e testador).
async function responder(eu, perguntaId, escolha, agora = Date.now()) {
  const euId = eu.id;
  const { liberada, teste } = await atividades.acesso('quiz', eu, agora);
  if (!liberada) throw new ErroValidacao('O Quiz ainda não está aberto.', 403);
  const { cfg, lista } = await perguntas(agora);
  const q = lista.find((x) => x.id === String(perguntaId));
  if (!q || q.id !== cfg.atual) throw new ErroValidacao('Essa pergunta não está valendo agora.', 409);
  if (q.fase !== 'respondendo') throw new ErroValidacao('O tempo dessa pergunta acabou.', 409);
  const n = Number(escolha);
  if (!Number.isInteger(n) || n < 0 || n >= q.opcoes.length) throw new ErroValidacao('Escolha uma das opções.');
  const r = await banco.rodar(
    'INSERT OR IGNORE INTO quiz_respostas (pergunta_id, convidado_id, escolha, respondida_em, teste) VALUES (?, ?, ?, ?, ?)',
    [q.id, euId, n, agora, teste ? 1 : 0]);
  if (!r.rowsAffected) throw new ErroValidacao('Você já respondeu essa pergunta. Só vale uma resposta.', 409);
  return { escolha: n };
}

// ------------------------------------------------------------------ admin
async function paraAdmin(agora = Date.now()) {
  const [{ cfg, lista }, uso] = await Promise.all([perguntas(agora), atividades.emUso('quiz', agora)]);
  const comContagem = await Promise.all(lista.map(async (q) => ({ ...q, ...(await contagem(q.id)) })));
  return { tempoS: cfg.tempoS, atual: cfg.atual, pontos: PONTOS_QUIZ, liberada: uso.ativa, emTeste: uso.teste, perguntas: comContagem, letras: LETRAS };
}

async function lancar(perguntaId, agora = Date.now()) {
  const uso = await atividades.emUso('quiz', agora);
  if (!uso.ativa) throw new ErroValidacao('Libere o Quiz (ou coloque "Em teste") na aba Atividades antes de lançar.', 409);
  const { cfg, lista } = await perguntas(agora);
  const q = lista.find((x) => x.id === String(perguntaId));
  if (!q) throw new ErroValidacao('Pergunta não encontrada.', 404);
  if (q.fase === 'revelada') throw new ErroValidacao('Essa pergunta já foi revelada.', 409);
  const outra = lista.find((x) => x.id !== q.id && x.fase === 'respondendo');
  if (outra) throw new ErroValidacao(`A pergunta ${outra.ordem} ainda está valendo. Espere o tempo dela acabar.`, 409);
  // Relançar uma pergunta não revelada começa do zero.
  await banco.lote([
    { sql: 'DELETE FROM quiz_respostas WHERE pergunta_id = ?', args: [q.id] },
    { sql: 'UPDATE quiz_perguntas SET lancada_em = ?, revelada_em = NULL, teste = ? WHERE id = ?', args: [agora, uso.teste ? 1 : 0, q.id] },
  ]);
  await festa.gravar('quiz', { ...cfg, atual: q.id });
  await festa.definirTelao({ modo: 'quiz' });
}

async function revelar(perguntaId, agora = Date.now()) {
  const { lista } = await perguntas(agora);
  const q = lista.find((x) => x.id === String(perguntaId));
  if (!q) throw new ErroValidacao('Pergunta não encontrada.', 404);
  if (q.fase === 'nao-lancada') throw new ErroValidacao('Lance a pergunta antes de revelar.', 409);
  if (q.fase === 'respondendo') throw new ErroValidacao('Ainda tem gente respondendo. Espere o tempo acabar.', 409);
  if (q.fase === 'revelada') return { acertaram: 0, jaRevelada: true };
  return banco.transacao(async (tx) => {
    const r = await tx.execute({ sql: 'UPDATE quiz_perguntas SET revelada_em = ? WHERE id = ? AND revelada_em IS NULL', args: [agora, q.id] });
    if (!r.rowsAffected) return { acertaram: 0, jaRevelada: true };
    const certos = (await tx.execute({ sql: 'SELECT convidado_id, teste FROM quiz_respostas WHERE pergunta_id = ? AND escolha = ?', args: [q.id, q.correta] })).rows;
    for (const c of certos) {
      await pontos.conceder({ convidadoId: c.convidado_id, atividade: 'quiz', pontos: PONTOS_QUIZ,
        motivo: `Quiz: acertou a pergunta ${q.ordem}`, chave: `quiz:${q.id}:${c.convidado_id}`, teste: Boolean(Number(c.teste)) }, tx);
    }
    return { acertaram: certos.length, jaRevelada: false };
  });
}

// Desfaz o lançamento de uma pergunta ainda não revelada (lançou a errada, por exemplo).
async function cancelar(perguntaId) {
  const q = await banco.um('SELECT * FROM quiz_perguntas WHERE id = ?', [String(perguntaId)]);
  if (!q) throw new ErroValidacao('Pergunta não encontrada.', 404);
  if (q.revelada_em != null) throw new ErroValidacao('Essa pergunta já foi revelada e os pontos já foram dados.', 409);
  await banco.lote([
    { sql: 'DELETE FROM quiz_respostas WHERE pergunta_id = ?', args: [q.id] },
    { sql: 'UPDATE quiz_perguntas SET lancada_em = NULL, teste = 0 WHERE id = ?', args: [q.id] },
  ]);
  const cfg = await config();
  if (cfg.atual === q.id) await festa.gravar('quiz', { ...cfg, atual: null });
}

async function editar(perguntaId, { texto, opcoes, correta }) {
  const q = await banco.um('SELECT * FROM quiz_perguntas WHERE id = ?', [String(perguntaId)]);
  if (!q) throw new ErroValidacao('Pergunta não encontrada.', 404);
  if (q.lancada_em != null) throw new ErroValidacao('Essa pergunta já foi lançada. Cancele antes de editar.', 409);
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
  const { cfg, lista } = await perguntas(agora);
  const q = lista.find((x) => x.id === cfg.atual);
  const feitas = lista.filter((x) => x.fase === 'revelada').length;
  if (!q) return { atual: null, total: lista.length, feitas };
  const c = await contagem(q.id);
  const base = { atual: { id: q.id, ordem: q.ordem, texto: q.texto, opcoes: q.opcoes, fase: q.fase, fimEm: q.fimEm, respostas: c.total }, total: lista.length, feitas };
  if (q.fase !== 'revelada') return base;
  const acertaram = await banco.tudo(
    `SELECT c.nome, c.avatar FROM quiz_respostas r JOIN convidados c ON c.id = r.convidado_id
      WHERE r.pergunta_id = ? AND r.escolha = ? ORDER BY r.respondida_em LIMIT 24`, [q.id, q.correta]);
  return { ...base, atual: { ...base.atual, correta: q.correta, porOpcao: c.porOpcao, acertaram: acertaram.map((a) => ({ nome: a.nome, avatar: a.avatar })) } };
}

module.exports = { config, paraConvidado, responder, paraAdmin, lancar, revelar, cancelar, editar, definirTempo, paraTelao, LETRAS };
