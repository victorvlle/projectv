// Notificações no celular: ativar, desativar e o passo a passo do iPhone.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = () => window.PVConvidado;
  const caixa = $('sec-avisos');

  const ehIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalado = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const suportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  let registro = null;
  let codigo = null;
  let ativando = false;

  function base64ParaBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const bruto = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bruto, (c) => c.charCodeAt(0));
  }

  function dispensadoRecente() {
    const t = Number(PV.guardado.ler('pv.avisos.depois') || 0);
    return Date.now() - t < 24 * 3600 * 1000;
  }

  function mostrar(html, compacto = false) {
    caixa.innerHTML = html;
    caixa.classList.toggle('oculto', !html);
    caixa.classList.toggle('compacto', compacto);
  }

  // O manifesto com o código faz o atalho da tela inicial já abrir logado.
  function prepararManifesto() {
    if (!codigo || document.querySelector('link[rel="manifest"]')) return;
    const l = document.createElement('link');
    l.rel = 'manifest';
    l.href = `/manifest/${codigo}.webmanifest`;
    document.head.appendChild(l);
  }

  async function assinaturaAtual() {
    if (!registro) return null;
    try { return await registro.pushManager.getSubscription(); } catch (_) { return null; }
  }

  async function desenhar() {
    if (!caixa) return;
    // iPhone fora da tela inicial: notificação só funciona depois de "Adicionar à Tela de Início".
    if (ehIOS && !instalado()) {
      if (dispensadoRecente()) return mostrar('');
      return mostrar(`
        <div class="avisos-topo"><span class="sino">🔔</span><div>
          <b>Receba os avisos da festa</b>
          <p class="mudo">No iPhone, primeiro coloque o Project V na tela de início.</p></div></div>
        <div class="avisos-acoes">
          <button class="botao pequeno" type="button" data-avisos="ios">Como fazer</button>
          <button class="botao secundario pequeno" type="button" data-avisos="depois">Agora não</button>
        </div>`);
    }
    if (!suportado()) return mostrar('');
    if (Notification.permission === 'denied') {
      return mostrar(`<div class="avisos-topo"><span class="sino">🔕</span><div><b>Notificações bloqueadas</b>
        <p class="mudo">Você bloqueou os avisos deste site. Para receber, libere as notificações nas configurações do navegador.</p></div></div>`, true);
    }
    const sub = await assinaturaAtual();
    if (sub && Notification.permission === 'granted') {
      return mostrar(`<div class="avisos-linha">🔔 Notificações ativadas
        <button type="button" class="link" data-avisos="desativar">Desativar</button></div>`, true);
    }
    if (dispensadoRecente()) return mostrar('');
    return mostrar(`
      <div class="avisos-topo"><span class="sino">🔔</span><div>
        <b>Receba os avisos da festa</b>
        <p class="mudo">Quando um jogo abrir, alguém oferecer carona, entrar música nova… você fica sabendo na hora.</p></div></div>
      <div class="avisos-acoes">
        <button class="botao pequeno" type="button" data-avisos="ativar">Ativar notificações</button>
        <button class="botao secundario pequeno" type="button" data-avisos="depois">Agora não</button>
      </div>`);
  }

  async function ativar() {
    if (ativando) return;
    ativando = true;
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') {
        PV.avisar('Sem permissão, não dá para mandar os avisos.', 'erro');
        return;
      }
      const { chave } = await C().api('GET', '/api/push/chave');
      let sub = await assinaturaAtual();
      if (!sub) sub = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ParaBytes(chave) });
      await C().api('POST', '/api/eu/push', { inscricao: sub.toJSON() });
      PV.avisar('Notificações ativadas! 🔔', 'ok');
    } catch (erro) {
      if (erro.status !== 401) PV.avisar('Não consegui ativar as notificações neste aparelho.', 'erro');
      console.error(erro);
    } finally {
      ativando = false;
      desenhar();
    }
  }

  async function desativar() {
    const sub = await assinaturaAtual();
    if (sub) {
      try { await C().api('DELETE', '/api/eu/push', { endpoint: sub.endpoint }); } catch (_) { /* segue */ }
      try { await sub.unsubscribe(); } catch (_) { /* segue */ }
    }
    PV.avisar('Notificações desativadas.', 'ok');
    desenhar();
  }

  function passoAPasso() {
    let fundo = $('modal-ios');
    if (!fundo) {
      fundo = document.createElement('div');
      fundo.id = 'modal-ios';
      fundo.className = 'modal-fundo';
      fundo.innerHTML = `
        <div class="modal cartao" role="dialog" aria-modal="true" aria-labelledby="ios-titulo">
          <h3 id="ios-titulo">🔔 Avisos no iPhone</h3>
          <ol class="passos">
            <li>Toque em <b>Compartilhar</b> <span class="icone-ios">⬆︎</span> na barra do Safari.</li>
            <li>Role e toque em <b>Adicionar à Tela de Início</b> <span class="icone-ios">＋</span>.</li>
            <li>Toque em <b>Adicionar</b>. Vai aparecer a abóbora 🎃 do Project V na sua tela.</li>
            <li>Abra o Project V <b>pelo ícone</b> e toque em <b>Ativar notificações</b>.</li>
          </ol>
          <p class="fraco">Precisa do iOS 16.4 ou mais novo. O atalho já abre com o seu convite.</p>
          <button class="botao largo" type="button" data-avisos="fechar">Entendi</button>
        </div>`;
      document.body.appendChild(fundo);
    }
    fundo.classList.remove('oculto');
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-avisos]');
    if (!b) return;
    const acao = b.dataset.avisos;
    if (acao === 'ativar') ativar();
    if (acao === 'desativar') desativar();
    if (acao === 'ios') passoAPasso();
    if (acao === 'fechar') $('modal-ios').classList.add('oculto');
    if (acao === 'depois') { PV.guardado.gravar('pv.avisos.depois', String(Date.now())); desenhar(); }
  });

  // Se o celular já tinha permissão e inscrição mas o servidor esqueceu (link novo,
  // restauração de backup), reenvia em silêncio.
  async function ressincronizar() {
    const sub = await assinaturaAtual();
    if (!sub || Notification.permission !== 'granted') return;
    try {
      const r = await C().api('POST', '/api/eu/push/situacao', { endpoint: sub.endpoint });
      if (!r.inscrito) await C().api('POST', '/api/eu/push', { inscricao: sub.toJSON() });
    } catch (_) { /* tenta na próxima */ }
  }

  async function iniciar() {
    // Espera a tela principal existir e a sessão estar pronta.
    if (!C() || !C().eu()) { setTimeout(iniciar, 400); return; }
    try { codigo = (await C().api('GET', '/api/eu')).eu.codigo; } catch (_) { return; }
    prepararManifesto();
    if (suportado()) {
      try { registro = await navigator.serviceWorker.register('/sw.js'); } catch (e) { console.error(e); }
      ressincronizar();
    }
    desenhar();
  }
  iniciar();
})();
