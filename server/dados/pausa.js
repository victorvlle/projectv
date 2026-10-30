// Regra geral: durante um jogo, se a Maldição despertar, o jogo PAUSA; quando a Maldição termina, o
// jogo volta exatamente de onde parou.
//
// Só os jogos que andam sozinhos no relógio precisam disso: o Quiz (perguntas com tempo) e a Corrida
// (animação no telão). Os outros (Concurso, Beer Pong, Mural) só andam quando o organizador aperta um
// botão; a Maldição cobre o telão e, ao sair, a tela volta onde estava.
//
// COMO: ao despertar, grava { desde, ate } (ate = fim previsto da Maldição + 5 s). Enquanto pausado, o
// relógio desses jogos fica parado em `desde` (ninguém responde, a corrida congela). Ao terminar
// (organizador confirmou/cancelou, ou acabou o tempo da Maldição), o cronograma do jogo é empurrado
// pela duração da pausa: o tempo que faltava continua o mesmo e os pontos por velocidade ficam justos.

const banco = require('./banco');
const festa = require('./festa');

const FOLGA_MS = 5000; // a tela da Maldição ainda mostra "cumprida" por uns segundos

async function ler() {
  return (await festa.ler('pausa')) || null;
}

function quizAtivo(cfgQuiz, agora) {
  const s = cfgQuiz && cfgQuiz.sessao;
  if (!s || s.encerradoEm != null) return false;
  const { PREPARO_MS, REVELA_MS } = require('./quiz');
  const fim = s.inicioEm + PREPARO_MS + s.ids.length * (s.tempoS * 1000 + REVELA_MS);
  return agora < fim;
}

function corridaAtiva(cfgCorrida, agora) {
  // Minuto de apostas também para (ninguém perde a chance de escolher por causa da Maldição).
  if (cfgCorrida && cfgCorrida.estado === 'apostas' && cfgCorrida.fechaEm) return agora < cfgCorrida.fechaEm;
  if (!cfgCorrida || cfgCorrida.estado !== 'correndo' || !cfgCorrida.eventos) return false;
  const { PREPARO_MS, duracaoDe } = require('./corrida');
  return agora < cfgCorrida.inicioEm + PREPARO_MS + duracaoDe(cfgCorrida) + 1500;
}

// A Maldição despertou: pausa o que estiver correndo.
async function comecar(maldicao, agora = Date.now()) {
  const fases = maldicao.fases || {};
  const fimMaldicao = maldicao.sorteadaEm + (fases.alerta || 4000) + (fases.suspense || 5000) + (fases.cumprir || 60000) + FOLGA_MS;
  const atual = await verificar(agora);
  if (atual) { // já pausado (outra maldição): estende
    await festa.gravar('pausa', { ...atual, ate: Math.max(atual.ate, fimMaldicao), maldicaoId: maldicao.id });
    return true;
  }
  const [quiz, corrida] = await Promise.all([festa.ler('quiz'), festa.ler('corrida')]);
  const q = quizAtivo(quiz, agora);
  const c = corridaAtiva(corrida, agora);
  if (!q && !c) return false;
  await festa.gravar('pausa', { desde: agora, ate: fimMaldicao, maldicaoId: maldicao.id,
    quiz: q ? { inicioEm: quiz.sessao.inicioEm } : null,
    corrida: c ? { rodada: corrida.rodada, estado: corrida.estado, inicioEm: corrida.inicioEm || null, fechaEm: corrida.fechaEm || null } : null });
  return true;
}

// A Maldição terminou antes do previsto (organizador confirmou ou cancelou): volta logo.
async function maldicaoTerminou(maldicaoId, agora = Date.now()) {
  const p = await ler();
  if (!p || p.maldicaoId !== maldicaoId) return;
  const ate = Math.min(p.ate, agora + FOLGA_MS);
  if (ate !== p.ate) await festa.gravar('pausa', { ...p, ate });
}

// Termina a pausa (uma vez só, mesmo com chamadas simultâneas) e empurra os cronogramas.
async function retomar(p) {
  const r = await banco.rodar("DELETE FROM config WHERE chave = 'pausa' AND valor = ?", [JSON.stringify(p)]);
  if (!r.rowsAffected) return false;
  const d = Math.max(0, p.ate - p.desde);
  if (p.quiz) {
    const cfg = await festa.ler('quiz');
    if (cfg && cfg.sessao && cfg.sessao.inicioEm === p.quiz.inicioEm) {
      await festa.gravar('quiz', { ...cfg, sessao: { ...cfg.sessao, inicioEm: cfg.sessao.inicioEm + d } });
      const ids = cfg.sessao.ids;
      // As respostas dadas antes da pausa andam junto com o cronograma (a velocidade continua a mesma).
      await banco.rodar(`UPDATE quiz_respostas SET respondida_em = respondida_em + ? WHERE respondida_em <= ? AND pergunta_id IN (${ids.map(() => '?').join(',')})`,
        [d, p.desde, ...ids]);
    }
  }
  if (p.corrida) {
    const cfg = await festa.ler('corrida');
    if (cfg && cfg.rodada === p.corrida.rodada && cfg.estado === 'correndo' && cfg.inicioEm === p.corrida.inicioEm) await festa.gravar('corrida', { ...cfg, inicioEm: cfg.inicioEm + d });
    if (cfg && cfg.rodada === p.corrida.rodada && cfg.estado === 'apostas' && cfg.fechaEm === p.corrida.fechaEm) await festa.gravar('corrida', { ...cfg, fechaEm: cfg.fechaEm + d });
  }
  try {
    const { avisar } = require('../tempo-real');
    avisar.atualizar('quiz');
    avisar.atualizar('corrida');
  } catch (_) { /* sem tempo real (testes): as telas atualizam na próxima leitura */ }
  return true;
}

// Pausa ativa agora? (e encerra a que já passou da hora)
async function verificar(agora = Date.now()) {
  const p = await ler();
  if (!p) return null;
  if (agora < p.ate) return p;
  await retomar(p);
  return null;
}

// Relógio dos jogos com tempo: parado durante a pausa.
async function relogio(agora = Date.now()) {
  const p = await verificar(agora);
  return p ? Math.min(agora, p.desde) : agora;
}

module.exports = { ler, comecar, maldicaoTerminou, verificar, relogio, retomar };
