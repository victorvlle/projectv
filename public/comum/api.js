// Utilitários compartilhados pelas três telas (sem framework, sem build).
/* global io */
(function () {
  'use strict';

  // localStorage pode falhar (aba anônima, armazenamento bloqueado): nunca quebra a página.
  const guardado = {
    ler(chave) { try { return localStorage.getItem(chave); } catch (_) { return null; } },
    gravar(chave, valor) { try { localStorage.setItem(chave, valor); } catch (_) { /* ignora */ } },
    apagar(chave) { try { localStorage.removeItem(chave); } catch (_) { /* ignora */ } },
  };

  class ErroApi extends Error {
    constructor(mensagem, status, codigo) { super(mensagem); this.status = status; this.codigo = codigo; }
  }

  async function chamar(metodo, url, { token, corpo } = {}) {
    const opcoes = { method: metodo, headers: {} };
    if (token) opcoes.headers.Authorization = `Bearer ${token}`;
    if (corpo !== undefined) {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    }
    let resposta;
    try {
      resposta = await fetch(url, opcoes);
    } catch (_) {
      throw new ErroApi('Sem conexão com o servidor. Confira a internet e tente de novo.', 0, 'rede');
    }
    let dados = {};
    try { dados = await resposta.json(); } catch (_) { /* resposta sem JSON */ }
    if (!resposta.ok || dados.ok === false) {
      throw new ErroApi(dados.erro || `Erro ${resposta.status}`, resposta.status, dados.codigo);
    }
    return dados;
  }

  // Relógio do servidor: guarda a diferença para o relógio local.
  let deslocamento = 0;
  const relogio = {
    sincronizar(agoraServidor) { if (Number.isFinite(agoraServidor)) deslocamento = agoraServidor - Date.now(); },
    agora() { return Date.now() + deslocamento; },
  };

  function contagem(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return { dias: Math.floor(s / 86400), horas: Math.floor((s % 86400) / 3600), minutos: Math.floor((s % 3600) / 60), segundos: s % 60, acabou: ms <= 0 };
  }

  const FUSO = 'America/Manaus';
  function dataHora(ms, opcoes = {}) {
    return new Date(ms).toLocaleString('pt-BR', { timeZone: FUSO, ...opcoes });
  }
  function dataCurta(ms) {
    return dataHora(ms, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // "sábado, 31 de outubro · 17h às 00h"
  function horaCurta(ms) {
    const [h, m] = dataHora(ms, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':');
    return m === '00' ? `${h}h` : `${h}h${m}`;
  }
  function periodo(inicioMs, fimMs) {
    const dia = dataHora(inicioMs, { weekday: 'long', day: '2-digit', month: 'long' });
    return Number.isFinite(fimMs) ? `${dia} · ${horaCurta(inicioMs)} às ${horaCurta(fimMs)}` : `${dia} · ${horaCurta(inicioMs)}`;
  }

  function esc(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let timerAviso = null;
  function avisar(mensagem, tipo = '') {
    let el = document.querySelector('.aviso');
    if (!el) { el = document.createElement('div'); el.className = 'aviso'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = mensagem;
    el.className = `aviso visivel ${tipo}`;
    clearTimeout(timerAviso);
    timerAviso = setTimeout(() => el.classList.remove('visivel'), 3200);
  }

  // Socket com reconexão infinita. `aoConectar` roda em toda (re)conexão: é onde a
  // tela busca o estado completo de novo.
  function conectar({ tipo, token, aoConectar, aoNegar, eventos = {} }) {
    let faixa = document.querySelector('.conexao');
    if (!faixa) {
      faixa = document.createElement('div');
      faixa.className = 'conexao';
      faixa.textContent = 'Reconectando…';
      document.body.appendChild(faixa);
    }
    const s = io({ auth: { tipo, token }, reconnectionDelayMax: 4000 });
    let mostrarTimer = null;
    s.on('connect', () => {
      clearTimeout(mostrarTimer);
      mostrarTimer = null;
      faixa.classList.remove('visivel');
      s.emit('hora', (t) => relogio.sincronizar(t));
      if (aoConectar) aoConectar();
    });
    s.on('disconnect', () => {
      // Pequena espera: uma piscada de rede não precisa assustar ninguém.
      mostrarTimer = setTimeout(() => faixa.classList.add('visivel'), 1500);
    });
    s.on('connect_error', (erro) => {
      if (erro && erro.message === 'sem-acesso') {
        s.disconnect();
        if (aoNegar) aoNegar();
        return;
      }
      mostrarTimer = mostrarTimer || setTimeout(() => faixa.classList.add('visivel'), 1500);
    });
    for (const [evento, fn] of Object.entries(eventos)) s.on(evento, fn);
    return s;
  }

  // Agrupa vários "atualizar" seguidos numa busca só.
  function adiar(fn, ms = 250) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  window.PV = { guardado, chamar, ErroApi, relogio, contagem, dataHora, dataCurta, periodo, esc, avisar, conectar, adiar, FUSO };
})();
