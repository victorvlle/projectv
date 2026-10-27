// Anuncia uma maldição recém-sorteada: telão (tempo real), admin, celular do sorteado (tempo real)
// e notificação push. O telão nunca depende do push: a falha do push só vai para o log.

const { avisar } = require('../tempo-real');
const maldicao = require('../dados/maldicao');

async function maldicaoSorteada(m) {
  const payload = await maldicao.paraTelao(m);
  avisar.telao('maldicao', payload);
  avisar.admin('atualizar', { oque: 'maldicao' });
  for (const id of [m.convidadoId, m.parceiro && m.parceiro.id].filter(Boolean)) {
    avisar.convidado(id, 'maldicao:voce', { id: m.id, castigo: m.castigo, sorteadaEm: m.sorteadaEm, fases: payload.fases });
  }
  require('../notificacoes').amaldicoado(m).catch((e) => console.error('[push] maldição:', e.message));
  return payload;
}

function maldicaoResolvida(m) {
  avisar.telao('maldicao:resolvida', { id: m.id, estado: m.estado });
  avisar.admin('atualizar', { oque: 'maldicao' });
  avisar.atualizar('ranking');
}

module.exports = { maldicaoSorteada, maldicaoResolvida };
