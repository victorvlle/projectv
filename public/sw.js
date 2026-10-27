// Service worker do Project V: só cuida das notificações (não guarda páginas em cache,
// para nunca servir versão velha do site).

// Telas que um toque na notificação pode abrir (a mesma lista do servidor).
const DESTINOS = ['/', '/#contribuicoes', '/#playlist', '/#caronas', '/#chegar', '/#pos', '/#avisos'];
const destinoSeguro = (u) => (DESTINOS.includes(u) ? u : '/');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (evento) => {
  let dados = {};
  try { dados = evento.data ? evento.data.json() : {}; } catch (_) { dados = { corpo: evento.data && evento.data.text() }; }
  const titulo = dados.titulo || '🎃 Project V';
  evento.waitUntil(self.registration.showNotification(titulo, {
    body: dados.corpo || '',
    icon: '/icones/icone-192.png',
    badge: '/icones/badge-96.png',
    tag: dados.tag || 'projectv',
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url: destinoSeguro(dados.url) },
  }));
});

// Tocar na notificação abre (ou traz para frente) o site na tela certa.
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = new URL(destinoSeguro(evento.notification.data && evento.notification.data.url), self.location.origin).href;
  evento.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const aba of abas) {
      if (new URL(aba.url).origin === self.location.origin) {
        await aba.focus();
        try { await aba.navigate(destino); } catch (_) { /* algumas plataformas não deixam */ }
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
