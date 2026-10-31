// Anuncia uma maldição recém-sorteada: telão (tempo real), admin, celular do sorteado (tempo real)
// e notificação push. O telão nunca depende do push: a falha do push só vai para o log.

const { avisar } = require('../tempo-real');
const maldicao = require('../dados/maldicao');

async function maldicaoSorteada(m) {
  const payload = await maldicao.paraTelao(m);
  // Regra geral: jogo com relógio (Quiz, Corrida) pausa enquanto a Maldição acontece.
  try {
    if (await require('../dados/pausa').comecar({ id: m.id, sorteadaEm: m.sorteadaEm, fases: payload.fases })) {
      avisar.atualizar('quiz');
      avisar.atualizar('corrida');
    }
  } catch (e) { console.error('[pausa]', e.message); }
  avisar.telao('maldicao', payload);
  avisar.admin('atualizar', { oque: 'maldicao' });
  // Coletiva: ninguém em especial foi amaldiçoado (o celular de todos recebe o push geral).
  for (const id of m.grupo ? [] : [m.convidadoId, m.parceiro && m.parceiro.id].filter(Boolean)) {
    avisar.convidado(id, 'maldicao:voce', { id: m.id, castigo: m.castigo, sorteadaEm: m.sorteadaEm, fases: payload.fases, foto: m.foto && id === m.convidadoId });
  }
  // O push só sai quando o telão revela quem foi (alerta + suspense): nada de spoiler no celular.
  const enviarPush = () => require('../notificacoes').amaldicoado(m).catch((e) => console.error('[push] maldição:', e.message));
  const atraso = process.env.AVISO_SEM_ATRASO === '1' ? 0 : Math.max(0, m.sorteadaEm + payload.fases.alerta + payload.fases.suspense - Date.now());
  if (atraso) setTimeout(enviarPush, atraso).unref(); else enviarPush();
  return payload;
}

function maldicaoResolvida(m) {
  require('../dados/pausa').maldicaoTerminou(m.id).catch((e) => console.error('[pausa]', e.message));
  avisar.telao('maldicao:resolvida', { id: m.id, estado: m.estado, falhou: m.falhou,
    ultimo: m.ultimo ? { nome: m.ultimo.nome, avatar: m.ultimo.avatar } : null,
    penultimo: m.penultimo ? { nome: m.penultimo.nome, avatar: m.penultimo.avatar } : null });
  avisar.admin('atualizar', { oque: 'maldicao' });
  avisar.atualizar('ranking');
}

module.exports = { maldicaoSorteada, maldicaoResolvida };
