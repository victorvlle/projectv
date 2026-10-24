// Telão: mostra a cena escolhida pelo admin e se atualiza em tempo real.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let token = PV.guardado.ler('pv.admin');
  let estado = null;
  let avatares = [];
  let socket = null;
  let cenaAtual = null;

  const emojiDe = (id) => (avatares.find((a) => a.id === id) || {}).emoji || '❔';

  function pedirLogin() {
    PV.guardado.apagar('pv.admin');
    token = null;
    if (socket) socket.disconnect();
    $('palco').classList.add('oculto');
    $('tela-cheia').classList.add('oculto');
    $('tela-login').classList.remove('oculto');
  }

  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await PV.chamar('POST', '/api/admin/entrar', { corpo: { senha: $('senha').value } });
      token = r.token;
      PV.guardado.gravar('pv.admin', token);
      $('senha').value = '';
      ligar();
    } catch (erro) {
      PV.avisar(erro.message, 'erro');
    }
  });

  $('tela-cheia').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });

  // Evita a tela apagar no meio da festa, onde o navegador permitir.
  async function manterAcesa() {
    try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (_) { /* opcional */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') manterAcesa(); });

  function trocarCena(cena) {
    if (cena === cenaAtual) return;
    cenaAtual = cena;
    document.querySelectorAll('.cena').forEach((s) => {
      const visivel = s.dataset.cena === cena;
      s.classList.toggle('oculto', !visivel);
      if (visivel) { s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; }
    });
  }

  function desenhar() {
    if (!estado) return;
    $('nome-festa').textContent = estado.festa.nome || '';
    const lista = estado.confirmados;
    $('n-confirmados').textContent = lista.length;
    $('n-confirmados-2').textContent = `(${lista.length})`;
    $('desfile').innerHTML = lista.slice(-40).map((c, i) =>
      `<span class="avatar" title="${PV.esc(c.apelido)}" style="animation-delay:${(i % 8) * 0.4}s">${emojiDe(c.avatar)}</span>`).join('');
    $('almas').innerHTML = lista.map((c, i) =>
      `<div class="alma" style="animation-delay:${Math.min(i, 30) * 0.04}s"><span class="avatar">${emojiDe(c.avatar)}</span><span>${PV.esc(c.apelido)}</span></div>`).join('');
    $('cadeados').innerHTML = estado.atividades.map((a) => (a.estado === 'liberada'
      ? `<div class="cadeado aberto"><div class="ic">${a.icone}</div><div class="n">${PV.esc(a.nome)}</div></div>`
      : `<div class="cadeado"><div class="ic">🔒</div><div class="n">${PV.esc(a.enigma)}</div></div>`)).join('');
    $('mensagem').textContent = estado.telao.mensagem || '';
    trocarCena(estado.telao.modo);
    tic();
  }

  const dois = (n) => String(n).padStart(2, '0');
  function tic() {
    if (!estado) return;
    const c = PV.contagem(estado.festa.inicioMs - PV.relogio.agora());
    $('relogio').classList.toggle('oculto', c.acabou);
    $('rotulo-contagem').classList.toggle('oculto', c.acabou);
    $('portoes').classList.toggle('oculto', !c.acabou);
    $('portoes').textContent = PV.relogio.agora() >= estado.festa.fimMs ? 'Até a próxima edição' : 'Os portões estão abertos';
    $('r-dias').textContent = c.dias;
    $('r-horas').textContent = dois(c.horas);
    $('r-min').textContent = dois(c.minutos);
    $('r-seg').textContent = dois(c.segundos);
  }
  setInterval(tic, 1000);

  async function carregar() {
    try {
      const r = await PV.chamar('GET', '/api/admin/telao', { token });
      PV.relogio.sincronizar(r.agora);
      estado = r;
      desenhar();
    } catch (erro) {
      if (erro.status === 401) pedirLogin();
    }
  }

  async function ligar() {
    $('tela-login').classList.add('oculto');
    $('palco').classList.remove('oculto');
    $('tela-cheia').classList.remove('oculto');
    manterAcesa();
    try { avatares = (await PV.chamar('GET', '/api/avatares')).avatares; } catch (_) { /* tenta na reconexão */ }
    await carregar();
    const recarregar = PV.adiar(carregar, 200);
    socket = PV.conectar({
      tipo: 'telao', token,
      aoConectar: recarregar,
      aoNegar: pedirLogin,
      eventos: { atualizar: recarregar },
    });
  }

  if (token) ligar();
  else $('tela-login').classList.remove('oculto');
})();
