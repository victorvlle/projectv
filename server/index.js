// Ponto de entrada: abre (e migra) o banco ANTES de ouvir a porta.

const banco = require('./dados/banco');
const agendador = require('./agendador');
const notificacoes = require('./notificacoes');
const seg = require('./seguranca');
const { criarApp } = require('./app');

const PORT = Number(process.env.PORT) || 3002;

async function main() {
  await banco.abrir();
  const { server } = criarApp();

  server.on('error', (erro) => {
    if (erro.code === 'EADDRINUSE') {
      console.error(`\n  A porta ${PORT} já está em uso. Feche o outro servidor ou use outra porta (PORT=4000).\n`);
      process.exit(1);
    }
    throw erro;
  });

  agendador.iniciar();
  notificacoes.iniciar();
  server.listen(PORT, () => {
    const onde = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log(`\n  Project V rodando em ${onde}  (banco: ${banco.ondeEsta()})`);
    if (!seg.adminLigado()) console.log('  ATENÇÃO: ADMIN_SEGREDO não definido - o painel /admin não aceita login.');
    if (process.env.NODE_ENV === 'production' && banco.ondeEsta() === 'arquivo' && !process.env.BANCO_CAMINHO) {
      console.warn('  ATENÇÃO: banco em arquivo local padrão. No Render free isso é APAGADO a cada reinício. Configure TURSO_URL.');
    }
    console.log('');
  });

  // Desligamento limpo (Render manda SIGTERM no deploy).
  const encerrar = () => {
    console.log('[servidor] encerrando...');
    agendador.parar();
    notificacoes.parar();
    server.close(() => banco.fechar().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);
}

main().catch((erro) => {
  console.error('\n  Não consegui iniciar:', erro.message);
  console.error('  Confira TURSO_URL e TURSO_TOKEN (ou BANCO_CAMINHO, no ambiente local).\n');
  process.exit(1);
});
