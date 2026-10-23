// Ponte entre as rotas HTTP e o Socket.IO. As rotas mudam o banco e chamam
// `avisar` para empurrar a novidade às telas certas.
//
// Salas:
//   convidados -> todo convidado conectado
//   c:<id>     -> um convidado específico (todas as abas/celulares dele)
//   telao      -> telões
//   admin      -> painéis admin
//
// Regra de segurança: nada secreto vai para 'convidados'. Segredo individual
// (ex.: papel no Monstro) vai só para 'c:<id>'.

let io = null;

function ligar(instancia) { io = instancia; }

function emitir(sala, evento, dados) {
  if (io) io.to(sala).emit(evento, dados);
}

const avisar = {
  convidados: (evento, dados) => emitir('convidados', evento, dados),
  convidado: (id, evento, dados) => emitir(`c:${id}`, evento, dados),
  telao: (evento, dados) => emitir('telao', evento, dados),
  admin: (evento, dados) => emitir('admin', evento, dados),
  // "Algo mudou, busque de novo": o jeito mais robusto de manter telas em dia,
  // e o mesmo caminho usado depois de uma reconexão.
  atualizar(oque = 'tudo') {
    for (const sala of ['convidados', 'telao', 'admin']) emitir(sala, 'atualizar', { oque });
  },
  // Derruba as conexões de um convidado (link desativado ou regenerado).
  expulsar(id) {
    if (!io) return;
    io.to(`c:${id}`).emit('sessao:encerrada');
    io.in(`c:${id}`).disconnectSockets(true);
  },
};

module.exports = { ligar, avisar };
