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
  window.PVTelao = { emojiDe, token: () => token };

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

  let vezRanking = 0; // cada vez que o ranking aparece no telão, o pódio é revelado com suspense
  function trocarCena(cena) {
    if (cena === cenaAtual) return;
    cenaAtual = cena;
    document.body.dataset.cena = cena; // gancho visual (ex.: o Mural deixa o cabeçalho discreto)
    if (cena === 'ranking') { vezRanking += 1; if (estado) desenharRanking(estado.ranking || []); }
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
      `<span class="avatar" title="${PV.esc(c.nome)}" style="animation-delay:${(i % 8) * 0.4}s">${emojiDe(c.avatar)}</span>`).join('');
    $('almas').innerHTML = lista.map((c, i) =>
      `<div class="alma" style="animation-delay:${Math.min(i, 30) * 0.04}s"><span class="avatar">${emojiDe(c.avatar)}</span><span class="nome-conf">${PV.esc(c.nome)}</span></div>`).join('');
    $('cadeados').innerHTML = estado.atividades.map((a) => (a.estado === 'liberada'
      ? `<div class="cadeado aberto"><div class="ic">${a.icone}</div><div class="n">${PV.esc(a.nome)}</div></div>`
      : `<div class="cadeado"><div class="ic">🔒</div><div class="n">${PV.esc(a.enigma)}</div></div>`)).join('');
    $('mensagem').textContent = estado.telao.mensagem || '';
    const p = estado.pos;
    if (p) {
      $('pos-telao').innerHTML = p.opcoes.map((o) => {
        const pct = p.total ? Math.round((o.votos / p.total) * 100) : 0;
        const lider = p.lideres.includes(o.id);
        return `<div class="pos-linha ${lider ? 'lider' : ''}">
          <div class="pos-nome">${lider ? '👑 ' : ''}${PV.esc(o.nome)}</div>
          <div class="pos-barra"><i style="width:${pct}%"></i></div>
          <div class="pos-num">${o.votos}</div></div>`;
      }).join('');
      $('pos-telao-rodape').textContent = p.encerrada ? 'Votação encerrada!' : p.aberta ? `${p.total} ${p.total === 1 ? 'voto' : 'votos'} · vote pelo celular` : 'A votação abre às 23h';
    }
    desenharPrevisao(estado.previsao);
    desenharRanking(estado.ranking || []);
    if (window.PVTelaoFesta) window.PVTelaoFesta.desenhar(estado);
    trocarCena(estado.telao.modo);
    if (estado.maldicao && window.PVMaldicao) window.PVMaldicao.iniciar(estado.maldicao);
    tic();
  }

  // Previsões: uma pergunta por vez (o admin avança). Votos só aparecem depois de fechar.
  function desenharPrevisao(p) {
    if (!p) return;
    if (p.estado === 'aberta' || p.estado === 'aguardando') {
      $('prev-rotulo').textContent = 'Previsões';
      $('prev-pergunta').textContent = p.estado === 'aberta' ? 'As apostas estão abertas' : 'As Previsões abrem em breve';
      $('prev-corpo').innerHTML = `<p class="prev-dica">${p.estado === 'aberta' ? `Aposte pelo celular até ${PV.esc(PV.dataCurta(p.fechaEm))}. Cada acerto vale 1.000 pontos.` : 'Fique de olho no site.'}</p>`;
      return;
    }
    $('prev-rotulo').textContent = `Previsão ${p.indice + 1} de ${p.total}`;
    $('prev-pergunta').textContent = p.texto;
    const total = p.votos.reduce((s, v) => s + v.n, 0) || 1;
    const barras = p.votos.map((v) => `<div class="pos-linha ${v.certa ? 'lider' : ''}">
        <div class="pos-nome">${v.avatar ? `<span class="avatar mini">${emojiDe(v.avatar)}</span>` : ''}${v.certa ? '✓ ' : ''}${PV.esc(v.nome)}</div>
        <div class="pos-barra"><i style="width:${Math.round((v.n / total) * 100)}%"></i></div>
        <div class="pos-num">${v.n}</div></div>`).join('') || '<p class="prev-dica">Ninguém apostou nesta.</p>';
    const revelacao = p.revelada ? `<div class="prev-revela">
        ${p.respostaAvatar ? `<span class="avatar grande">${emojiDe(p.respostaAvatar)}</span>` : ''}
        <div><small>Resposta</small><b>${PV.esc(p.resposta)}</b>
        <p>${p.acertaram.length ? `Acertaram: ${p.acertaram.map((a) => PV.esc(a.nome)).join(', ')}` : 'Ninguém acertou!'}</p></div></div>` : '';
    $('prev-corpo').innerHTML = `${revelacao}<div class="grade-pos">${barras}</div>`;
  }

  function desenharRanking(r) {
    if (!r.some((x) => x.pontos > 0)) {
      $('podio').innerHTML = '<p class="prev-dica">Ninguém pontuou ainda.</p>';
    } else {
      const top = r.filter((x) => x.posicao <= 3 && x.pontos > 0);
      const grupos = [1, 2, 3].map((pos) => ({ posicao: pos, pessoas: top.filter((x) => x.posicao === pos)
        .map((x) => ({ nome: x.nome, avatar: x.avatar, detalhe: `${x.pontos.toLocaleString('pt-BR')} pts` })) })).filter((g) => g.pessoas.length);
      window.PVPodio.montar($('podio'), grupos, { chave: `ranking:${vezRanking}`, animar: cenaAtual === 'ranking' });
    }
    $('rank-telao').innerHTML = r.filter((x) => x.posicao > 3).slice(0, 7).map((x) => `<li><span class="p">${x.posicao}º</span>
      <span class="avatar">${emojiDe(x.avatar)}</span><span class="n">${PV.esc(x.nome)}</span><span class="pts">${x.pontos.toLocaleString('pt-BR')}</span></li>`).join('');
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
    window.PVTelaoRecarregar = recarregar;
    socket = PV.conectar({
      tipo: 'telao', token,
      aoConectar: recarregar,
      aoNegar: pedirLogin,
      eventos: {
        atualizar: recarregar,
        maldicao: (m) => window.PVMaldicao && window.PVMaldicao.iniciar(m),
        'maldicao:resolvida': (d) => window.PVMaldicao && window.PVMaldicao.resolvida(d),
        'quiz:resposta': recarregar,
        'quiz:sala': recarregar,
      },
    });
    if (window.PVMaldicao) window.PVMaldicao.mostrarBotaoSom();
  }

  if (token) ligar();
  else $('tela-login').classList.remove('oculto');
})();
