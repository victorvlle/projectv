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

async function verificar(agora = Date.now()) {
  const r = await banco.rodar(
    "UPDATE atividades SET estado = 'liberada', atualizado_em = ? WHERE estado = 'agendada' AND abre_em IS NOT NULL AND abre_em <= ?",
    [agora, agora],
  );
  if (r.rowsAffected > 0) {
    console.log(`[agendador] ${r.rowsAffected} atividade(s) liberada(s) no horário`);
    avisar.atualizar('atividades');
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
