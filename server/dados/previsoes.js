// Previsões: cada convidado aposta nas 10 perguntas enquanto estiverem abertas.
//
// ESTADOS
//  - aguardando: a atividade ainda não abriu (agendada para sexta 30/10, 00:00).
//  - aberta: dá para responder e trocar a resposta.
//  - encerrada: fechou (início da festa ou o admin encerrou); ninguém muda mais nada.
//  - publicada: o admin publicou os resultados; pontos calculados (+1000 por acerto).
//
// MODO TESTE: com a atividade "Em teste", só os testadores respondem; os palpites e pontos
// ficam marcados e o "Apagar dados de teste" volta tudo ao que era (inclusive respostas oficiais).
//
// PRIVACIDADE
//  - Enquanto estiver aberta, cada um só vê as próprias respostas (nem contagem de votos).
//  - Os outros convidados aparecem por um apelido opaco, nunca pelo id interno.

const crypto = require('crypto');
const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const pontos = require('./pontos');
const convidados = require('./convidados');
const { ErroValidacao } = convidados;
const { PONTOS_PREVISAO } = require('../jogos/conteudo');

const apelido = (id) => `p${crypto.createHash('sha256').update(`pv-previsoes:${id}`).digest('hex').slice(0, 12)}`;

async function config() {
  return { fechaEm: null, publicadas: false, ...((await festa.ler('previsoes')) || {}) };
}

// `veTeste`: quem pergunta enxerga a atividade em teste (testador ou admin).
async function situacao(agora = Date.now(), veTeste = true) {
  const [cfg, info, liberadaDeVerdade, linha] = await Promise.all([
    config(), festa.info(), atividades.estaLiberada('previsoes', agora),
    banco.um("SELECT estado, abre_em FROM atividades WHERE id = 'previsoes'"),
  ]);
  const emTeste = Boolean(linha) && linha.estado === 'teste';
  const liberada = liberadaDeVerdade || (emTeste && veTeste);
  const fechaEm = cfg.fechaEm != null ? Number(cfg.fechaEm) : info.inicioMs;
  let estado;
  if (cfg.publicadas) estado = 'publicada';
  else if (!liberada) estado = 'aguardando';
  else if (agora < fechaEm) estado = 'aberta';
  else estado = 'encerrada';
  const abreEm = linha && linha.estado === 'agendada' && linha.abre_em != null ? Number(linha.abre_em) : null;
  return { estado, fechaEm, abreEm, publicadas: Boolean(cfg.publicadas), teste: emTeste };
}
// Ação do admin feita com a atividade em teste: marca para o "Apagar dados de teste" desfazer.
async function marcarTeste() {
  if (!(await atividades.emTeste('previsoes'))) return;
  const cfg = await config();
  if (!cfg.teste) await festa.gravar('previsoes', { ...cfg, teste: true });
}

async function perguntas() {
  const linhas = await banco.tudo('SELECT * FROM previsoes_perguntas ORDER BY ordem');
  return linhas.map((l) => ({ id: l.id, ordem: Number(l.ordem), texto: l.texto, tipo: l.tipo, opcoes: JSON.parse(l.opcoes), resposta: l.resposta }));
}

function rotuloEscolha(p, escolha, pessoasPorId) {
  if (escolha == null) return null;
  if (p.tipo === 'opcoes') return (p.opcoes.find((o) => o.id === escolha) || {}).nome || null;
  const c = pessoasPorId.get(escolha);
  return c ? c.nome : null;
}

// Visão do convidado.
async function paraConvidado(euId, agora = Date.now(), testador = false) {
  const [sit, lista, pessoas, meus] = await Promise.all([
    situacao(agora, testador), perguntas(), convidados.confirmados(),
    banco.tudo('SELECT pergunta_id, escolha FROM previsoes_palpites WHERE convidado_id = ?', [euId]),
  ]);
  const minhas = new Map(meus.map((m) => [m.pergunta_id, m.escolha]));
  const porId = new Map(pessoas.map((c) => [c.id, c]));
  const publicada = sit.estado === 'publicada';
  const saida = lista.map((p) => {
    const minha = minhas.get(p.id) ?? null;
    const base = {
      id: p.id, ordem: p.ordem, texto: p.texto, tipo: p.tipo, opcoes: p.opcoes,
      minha: p.tipo === 'convidado' && minha ? apelido(minha) : minha,
      minhaNome: rotuloEscolha(p, minha, porId),
    };
    if (publicada) {
      base.resposta = p.resposta ? (p.tipo === 'convidado' ? apelido(p.resposta) : p.resposta) : null;
      base.respostaNome = rotuloEscolha(p, p.resposta, porId);
      base.acertei = Boolean(p.resposta && minha === p.resposta);
    }
    return base;
  });
  const respondidas = saida.filter((p) => p.minha).length;
  const acertos = publicada ? saida.filter((p) => p.acertei).length : null;
  return {
    ...sit, pontosPorAcerto: PONTOS_PREVISAO, perguntas: saida, respondidas, total: saida.length, acertos,
    pessoas: pessoas.map((c) => ({ id: apelido(c.id), nome: c.nome, avatar: c.avatar, souEu: c.id === euId })),
  };
}

async function responder(euId, perguntaId, escolha, agora = Date.now(), testador = false) {
  const sit = await situacao(agora, testador);
  if (sit.estado !== 'aberta') {
    throw new ErroValidacao(sit.estado === 'aguardando' ? 'As Previsões ainda não abriram.' : 'As Previsões já fecharam. Não dá mais para mudar.', 409);
  }
  const p = (await perguntas()).find((x) => x.id === String(perguntaId));
  if (!p) throw new ErroValidacao('Pergunta não encontrada.', 404);
  let valor = null;
  if (escolha !== null && escolha !== '') {
    if (p.tipo === 'opcoes') {
      if (!p.opcoes.some((o) => o.id === escolha)) throw new ErroValidacao('Escolha uma das opções.');
      valor = escolha;
    } else {
      const alvo = (await convidados.confirmados()).find((c) => apelido(c.id) === escolha);
      if (!alvo) throw new ErroValidacao('Escolha uma pessoa da lista.');
      valor = alvo.id;
    }
  }
  if (valor === null) {
    await banco.rodar('DELETE FROM previsoes_palpites WHERE convidado_id = ? AND pergunta_id = ?', [euId, p.id]);
  } else {
    await banco.rodar(
      `INSERT INTO previsoes_palpites (convidado_id, pergunta_id, escolha, atualizado_em, teste) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(convidado_id, pergunta_id) DO UPDATE SET escolha = excluded.escolha, atualizado_em = excluded.atualizado_em, teste = excluded.teste`,
      [euId, p.id, valor, agora, sit.teste ? 1 : 0]);
  }
}

// ------------------------------------------------------------------- admin
async function contagens() {
  const linhas = await banco.tudo('SELECT pergunta_id, escolha, COUNT(*) AS n FROM previsoes_palpites GROUP BY pergunta_id, escolha');
  const mapa = new Map();
  for (const l of linhas) {
    if (!mapa.has(l.pergunta_id)) mapa.set(l.pergunta_id, []);
    mapa.get(l.pergunta_id).push({ escolha: l.escolha, n: Number(l.n) });
  }
  return mapa;
}

async function paraAdmin(agora = Date.now()) {
  const [sit, lista, pessoas, cont, participantes, maldicoes] = await Promise.all([
    situacao(agora), perguntas(), convidados.confirmados(), contagens(),
    banco.um('SELECT COUNT(DISTINCT convidado_id) AS n FROM previsoes_palpites'),
    banco.tudo("SELECT convidado_id, COUNT(*) AS n FROM maldicoes WHERE estado != 'cancelada' GROUP BY convidado_id ORDER BY n DESC LIMIT 3"),
  ]);
  const porId = new Map(pessoas.map((c) => [c.id, c]));
  return {
    ...sit,
    participantes: Number(participantes.n),
    pessoas: pessoas.map((c) => ({ id: c.id, nome: c.nome, avatar: c.avatar })),
    perguntas: lista.map((p) => ({
      ...p,
      respostaNome: rotuloEscolha(p, p.resposta, porId),
      votos: (cont.get(p.id) || []).map((v) => ({ ...v, nome: rotuloEscolha(p, v.escolha, porId) || '(pessoa removida)' }))
        .sort((a, b) => b.n - a.n),
    })),
    // Ajuda para a pergunta "mais amaldiçoado": quem mais foi sorteado até agora.
    sugestoes: { 'mais-amaldicoado': maldicoes.map((m) => ({ id: m.convidado_id, nome: (porId.get(m.convidado_id) || {}).nome, n: Number(m.n) })) },
  };
}

async function encerrar(agora = Date.now()) {
  await marcarTeste();
  const cfg = await config();
  await festa.gravar('previsoes', { ...cfg, fechaEm: agora });
}

async function reabrir() {
  const cfg = await config();
  if (cfg.publicadas) throw new ErroValidacao('Os resultados já foram publicados. Despublique antes de reabrir.', 409);
  await festa.gravar('previsoes', { ...cfg, fechaEm: null });
}

async function definirResposta(perguntaId, resposta) {
  const p = (await perguntas()).find((x) => x.id === String(perguntaId));
  if (!p) throw new ErroValidacao('Pergunta não encontrada.', 404);
  let valor = null;
  if (resposta !== null && resposta !== '') {
    if (p.tipo === 'opcoes' && !p.opcoes.some((o) => o.id === resposta)) throw new ErroValidacao('Resposta inválida.');
    if (p.tipo === 'convidado' && !(await convidados.confirmados()).some((c) => c.id === resposta)) throw new ErroValidacao('Pessoa inválida.');
    valor = resposta;
  }
  await marcarTeste();
  await banco.rodar('UPDATE previsoes_perguntas SET resposta = ? WHERE id = ?', [valor, p.id]);
  // Já publicado: recalcula na hora (correção de resposta não deixa ponto errado para trás).
  if ((await config()).publicadas) await calcularPontos();
}

// Recalcula todos os pontos das Previsões numa transação: apaga e grava de novo.
// Rodar 1 ou 10 vezes dá o mesmo resultado.
async function calcularPontos() {
  return banco.transacao(async (tx) => {
    await tx.execute({ sql: "DELETE FROM pontos_log WHERE atividade = 'previsoes'", args: [] });
    const certos = await tx.execute({
      sql: `SELECT p.convidado_id, p.teste, q.id AS pergunta_id, q.texto FROM previsoes_palpites p
              JOIN previsoes_perguntas q ON q.id = p.pergunta_id AND q.resposta IS NOT NULL AND q.resposta = p.escolha
              JOIN convidados c ON c.id = p.convidado_id`, args: [] });
    for (const l of certos.rows) {
      await pontos.conceder({ convidadoId: l.convidado_id, atividade: 'previsoes', pontos: PONTOS_PREVISAO,
        motivo: `Acertou: ${l.texto}`, chave: `previsao:${l.pergunta_id}:${l.convidado_id}`, teste: Boolean(Number(l.teste)) }, tx);
    }
    return certos.rows.length;
  });
}

async function publicar(agora = Date.now()) {
  const sit = await situacao(agora);
  if (sit.estado === 'aberta' || sit.estado === 'aguardando') throw new ErroValidacao('Encerre as Previsões antes de publicar os resultados.', 409);
  await marcarTeste();
  const acertos = await calcularPontos();
  const cfg = await config();
  await festa.gravar('previsoes', { ...cfg, fechaEm: cfg.fechaEm ?? sit.fechaEm, publicadas: true });
  return { acertos };
}

async function despublicar() {
  const cfg = await config();
  await banco.rodar("DELETE FROM pontos_log WHERE atividade = 'previsoes'");
  await festa.gravar('previsoes', { ...cfg, publicadas: false });
}

// Telão: uma pergunta por vez, com a distribuição dos palpites (só depois de fechar).
async function paraTelao(indice, agora = Date.now()) {
  const sit = await situacao(agora);
  if (sit.estado === 'aberta' || sit.estado === 'aguardando') return { estado: sit.estado, fechaEm: sit.fechaEm };
  const [lista, pessoas, cont, palpites] = await Promise.all([
    perguntas(), convidados.confirmados(), contagens(),
    banco.tudo('SELECT convidado_id, pergunta_id, escolha FROM previsoes_palpites'),
  ]);
  const i = Math.max(0, Math.min(lista.length - 1, Number(indice) || 0));
  const p = lista[i];
  const porId = new Map(pessoas.map((c) => [c.id, c]));
  const revelada = Boolean(p.resposta);
  const acertaram = revelada ? palpites.filter((x) => x.pergunta_id === p.id && x.escolha === p.resposta)
    .map((x) => porId.get(x.convidado_id)).filter(Boolean).map((c) => ({ nome: c.nome, avatar: c.avatar })) : [];
  const resposta = revelada ? rotuloEscolha(p, p.resposta, porId) : null;
  const respostaAvatar = revelada && p.tipo === 'convidado' ? (porId.get(p.resposta) || {}).avatar || null : null;
  return {
    estado: sit.estado, indice: i, total: lista.length, texto: p.texto, revelada, resposta, respostaAvatar, acertaram,
    votos: (cont.get(p.id) || []).map((v) => {
      const c = p.tipo === 'convidado' ? porId.get(v.escolha) : null;
      return { nome: rotuloEscolha(p, v.escolha, porId) || '?', avatar: c ? c.avatar : null, n: v.n, certa: revelada && v.escolha === p.resposta };
    }).sort((a, b) => b.n - a.n).slice(0, 6),
  };
}

module.exports = {
  situacao, perguntas, paraConvidado, responder, paraAdmin, encerrar, reabrir, definirResposta, calcularPontos,
  publicar, despublicar, paraTelao, apelido, config,
};
