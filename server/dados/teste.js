// "Apagar dados de teste": desfaz tudo o que foi feito com atividades "Em teste".
// Remove pontos, respostas, votos, cartas e maldições marcados como teste, devolve o Quiz,
// o Concurso e as Previsões ao estado de antes, e tira as atividades do modo teste
// (voltam para "agendada" se tinham horário futuro; senão, "bloqueada").
// Não toca em nada real (enigmas, músicas, caronas, bebidas, palpites de verdade).

const banco = require('./banco');
const festa = require('./festa');

async function apagarDadosDeTeste(agora = Date.now()) {
  const contar = async (sql) => Number((await banco.um(sql)).n);
  const antes = {
    pontos: await contar('SELECT COUNT(*) AS n FROM pontos_log WHERE teste = 1'),
    quiz: await contar('SELECT COUNT(*) AS n FROM quiz_respostas WHERE teste = 1'),
    votos: await contar('SELECT COUNT(*) AS n FROM concurso_votos WHERE teste = 1'),
    cartas: await contar('SELECT COUNT(*) AS n FROM correio WHERE teste = 1'),
    maldicoes: await contar('SELECT COUNT(*) AS n FROM maldicoes WHERE teste = 1'),
    palpites: await contar('SELECT COUNT(*) AS n FROM previsoes_palpites WHERE teste = 1'),
  };
  const [prev, conc, quiz, mald, emTeste] = await Promise.all([
    festa.ler('previsoes'), festa.ler('concurso'), festa.ler('quiz'), festa.ler('maldicao'),
    banco.tudo("SELECT id, abre_em FROM atividades WHERE estado = 'teste'"),
  ]);
  const ids = new Set(emTeste.map((a) => a.id));
  const comandos = [
    { sql: 'DELETE FROM pontos_log WHERE teste = 1', args: [] },
    { sql: 'DELETE FROM quiz_respostas WHERE teste = 1', args: [] },
    { sql: 'DELETE FROM quiz_sala WHERE teste = 1', args: [] },
    { sql: 'UPDATE quiz_perguntas SET lancada_em = NULL, revelada_em = NULL, teste = 0 WHERE teste = 1', args: [] },
    { sql: 'DELETE FROM concurso_votos WHERE teste = 1', args: [] },
    { sql: 'DELETE FROM correio WHERE teste = 1', args: [] },
    { sql: 'DELETE FROM maldicoes WHERE teste = 1', args: [] },
    { sql: 'DELETE FROM previsoes_palpites WHERE teste = 1', args: [] },
    { sql: 'DELETE FROM previsoes_envios WHERE teste = 1', args: [] },
  ];
  // Previsões que foram encerradas/publicadas/respondidas em teste: voltam ao começo.
  if ((prev && prev.teste) || ids.has('previsoes')) {
    comandos.push({ sql: 'UPDATE previsoes_perguntas SET resposta = NULL', args: [] });
    comandos.push({ sql: "DELETE FROM pontos_log WHERE atividade = 'previsoes'", args: [] });
  }
  for (const a of emTeste) {
    const volta = a.abre_em != null && Number(a.abre_em) > agora ? 'agendada' : 'bloqueada';
    comandos.push({ sql: 'UPDATE atividades SET estado = ?, abre_em = ?, atualizado_em = ? WHERE id = ?',
      args: [volta, volta === 'agendada' ? Number(a.abre_em) : null, agora, a.id] });
  }
  await banco.lote(comandos);
  if ((prev && prev.teste) || ids.has('previsoes')) await festa.gravar('previsoes', { ...(prev || {}), fechaEm: null, publicadas: false, teste: false });
  if ((conc && conc.teste) || ids.has('concurso')) {
    await banco.rodar("DELETE FROM pontos_log WHERE atividade = 'concurso'");
    await festa.gravar('concurso', { estado: 'fechado', teste: false });
  }
  if (quiz && (ids.has('quiz') || (quiz.sessao && quiz.sessao.teste))) await festa.gravar('quiz', { ...quiz, sessao: null });
  if (ids.has('maldicao') || antes.maldicoes) await festa.gravar('maldicao', { ...(mald || {}), ligada: false, proximaEm: null });
  return { ...antes, atividades: [...ids] };
}

module.exports = { apagarDadosDeTeste };
