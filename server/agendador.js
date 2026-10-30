// Abre atividades agendadas na hora certa e avisa as telas.
//
// Não depende de um setTimeout longo (que se perderia num reinício): a cada
// verificação, consulta o banco. Se o servidor estava dormindo na hora marcada,
// a primeira verificação depois de acordar abre a atividade - e o estado
// "efetivo" já a trata como liberada desde o horário, mesmo antes disso.

const banco = require('./dados/banco');
const { avisar } = require('./tempo-real');

const INTERVALO_MS = 5000;
let timer = null;

// A cada volta: abre atividades agendadas e roda o sorteio da Maldição.
async function verificar(agora = Date.now()) {
  const abertas = await abrirAgendadas(agora);
  const m = await require('./dados/maldicao').tic(agora);
  if (m) await require('./jogos/anunciar').maldicaoSorteada(m);
  // Quiz: pontos das perguntas cujo tempo acabou (mesmo se ninguém estiver olhando).
  if (await require('./dados/quiz').sincronizar(agora)) avisar.atualizar('ranking');
  // Corrida: fecha e dá os pontos quando a animação termina.
  if (await require('./dados/corrida').sincronizar(agora)) { avisar.atualizar('ranking'); avisar.atualizar('corrida'); }
  return abertas;
}

async function abrirAgendadas(agora = Date.now()) {
  const abrindo = await banco.tudo(
    "SELECT id FROM atividades WHERE estado = 'agendada' AND abre_em IS NOT NULL AND abre_em <= ?", [agora]);
  if (!abrindo.length) return 0;
  const r = await banco.rodar(
    "UPDATE atividades SET estado = 'liberada', atualizado_em = ? WHERE estado = 'agendada' AND abre_em IS NOT NULL AND abre_em <= ?",
    [agora, agora],
  );
  if (r.rowsAffected > 0) {
    console.log(`[agendador] ${r.rowsAffected} atividade(s) liberada(s) no horário`);
    avisar.atualizar('atividades');
    const { porId } = require('./atividades/catalogo');
    const notificacoes = require('./notificacoes');
    for (const { id } of abrindo) {
      const a = porId(id);
      if (a) notificacoes.atividadeLiberada(a).catch((e) => console.error('[push]', e.message));
    }
  }
  return r.rowsAffected;
}

function iniciar() {
  if (timer) return;
  timer = setInterval(() => {
    verificar().catch((e) => console.error('[agendador]', e.message));
  }, INTERVALO_MS);
  timer.unref();
  verificar().catch((e) => console.error('[agendador]', e.message));
}

function parar() { clearInterval(timer); timer = null; }

module.exports = { iniciar, parar, verificar };
