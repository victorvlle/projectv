// Monta o app (Express + Socket.IO) sem começar a ouvir. Separado do index.js
// para os testes subirem um servidor de verdade numa porta aleatória.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const tempoReal = require('./tempo-real');
const socket = require('./socket');
const banco = require('./dados/banco');
const { tratarErros } = require('./rotas/util');

const PUBLICO = path.join(__dirname, '..', 'public');
const pagina = (arquivo) => (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLICO, arquivo));
};

function criarApp() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    // Celular na festa troca de Wi-Fi para 4G: reconexão tolerante.
    pingInterval: 20000,
    pingTimeout: 25000,
    // Sem connectionStateRecovery de propósito: toda reconexão passa de novo pela
    // conferência de credencial e o cliente rebusca o estado no banco.
  });

  app.set('trust proxy', 1); // Render fica atrás de um proxy: req.ip e protocolo corretos
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); // o código do convite fica na URL
    res.setHeader('X-Frame-Options', 'DENY');
    // Segunda tranca contra script injetado: só roda JavaScript vindo do próprio site.
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self' ws: wss:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '));
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  // Corpo JSON pequeno por padrão; só a restauração de backup aceita arquivo grande.
  const jsonPequeno = express.json({ limit: '32kb' });
  const jsonFoto = express.json({ limit: '1300kb' }); // foto do Mural (já reduzida no celular)
  app.use((req, res, next) => {
    if (req.path === '/api/admin/restaurar') return next();
    if (req.path === '/api/correio' && req.method === 'POST') return jsonFoto(req, res, next);
    return jsonPequeno(req, res, next);
  });

  // Cada acesso também serve de relógio para os avisos agendados (no máximo 1x a cada 30 s):
  // com o Render free dormindo, quem acorda o servidor já dispara o que estiver na hora.
  const notificacoes = require('./notificacoes');
  app.use((req, _res, next) => {
    if (req.path === '/saude' || req.path.startsWith('/api/')) notificacoes.tocar();
    next();
  });

  // Defesa extra: ação que muda dados só vale vindo do próprio site. (As sessões já vão
  // no cabeçalho Authorization, então outro site não consegue agir em nome de ninguém;
  // isto fecha a porta mesmo que algum dia se use cookie.)
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origem = req.get('origin');
    if (!origem) return next(); // apps e testes sem navegador não mandam Origin
    let host = '';
    try { host = new URL(origem).host; } catch (_) { /* origem inválida */ }
    if (host && host === req.get('host')) return next();
    return res.status(403).json({ ok: false, erro: 'Origem não permitida.' });
  });

  app.get('/saude', async (_req, res) => {
    try {
      await banco.um('SELECT 1 AS ok');
      res.json({ ok: true, banco: banco.ondeEsta() });
    } catch (e) {
      res.status(503).json({ ok: false, erro: 'banco indisponível' });
    }
  });

  app.use('/api', require('./rotas/convidado'));
  app.use('/api/admin', require('./rotas/admin'));
  app.use('/api', (_req, res) => res.status(404).json({ ok: false, erro: 'Rota não encontrada.' }));

  // Páginas. O código do convite é lido pelo JavaScript da página, não pelo servidor.
  app.get('/manifest/:codigo.webmanifest', (req, res) => {
    const { codigoValido } = require('./seguranca');
    if (!codigoValido(req.params.codigo)) return res.status(404).end();
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      name: 'Project V — Halloween',
      short_name: 'Project V',
      start_url: `/?c=${req.params.codigo}`,
      scope: '/',
      display: 'standalone',
      background_color: '#120D17',
      theme_color: '#120D17',
      icons: [
        { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    });
  });
  app.get('/', pagina('convidado/index.html'));
  app.get('/c/:codigo', pagina('convidado/entrar.html'));
  app.get('/telao', pagina('telao/index.html'));
  app.get('/admin', pagina('admin/index.html'));
  app.get('/painel', pagina('painel/index.html'));
  // Sem cache longo: a cada deploy o celular precisa pegar o HTML e o JS da MESMA
  // versão. Com "no-cache" o navegador revalida (ETag) e só baixa de novo o que mudou.
  app.use(express.static(PUBLICO, {
    index: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));

  app.use(tratarErros);

  tempoReal.ligar(io);
  socket.registrar(io);

  return { app, server, io };
}

module.exports = { criarApp };
