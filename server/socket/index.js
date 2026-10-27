// Porta de entrada do tempo real. Ninguém conecta sem credencial:
//   convidado -> auth { tipo: 'convidado', token }
//   telão/admin -> auth { tipo: 'telao' | 'admin', token } (sessão de admin)
//
// Ao (re)conectar, o cliente sempre busca o estado completo por HTTP. Assim uma
// queda de Wi-Fi ou um reinício do servidor nunca deixa a tela desatualizada:
// a verdade está no banco, não na memória da conexão.

const { convidadoDoToken } = require('../rotas/util');
const seg = require('../seguranca');
const notificacoes = require('../notificacoes');

function registrar(io) {
  io.use(async (socket, next) => {
    try {
      const { tipo, token } = socket.handshake.auth || {};
      if (tipo === 'convidado') {
        const c = await convidadoDoToken(token);
        if (!c) return next(new Error('sem-acesso'));
        socket.data = { tipo, convidadoId: c.id };
        return next();
      }
      if ((tipo === 'admin' || tipo === 'telao') && seg.sessaoAdminValida(token)) {
        socket.data = { tipo };
        return next();
      }
      return next(new Error('sem-acesso'));
    } catch (erro) {
      console.error('[socket] falha ao conferir credencial:', erro.message);
      return next(new Error('indisponivel'));
    }
  });

  io.on('connection', (socket) => {
    const { tipo, convidadoId } = socket.data;
    if (tipo === 'convidado') {
      socket.join('convidados');
      socket.join(`c:${convidadoId}`);
      // Qual tela a pessoa está olhando agora (null = aba escondida). Só usado para
      // não mandar aviso de "música nova" para quem já está vendo a playlist.
      socket.on('tela', (tela) => {
        notificacoes.marcarTela(socket.id, convidadoId, typeof tela === 'string' && /^[a-z]{1,20}$/.test(tela) ? tela : null);
      });
      socket.on('disconnect', () => notificacoes.sairTela(socket.id));
    } else {
      socket.join(tipo); // 'admin' ou 'telao'
    }
    // Relógio do servidor para a contagem regressiva.
    socket.on('hora', (responder) => {
      if (typeof responder === 'function') responder(Date.now());
    });
  });
}

module.exports = { registrar };
