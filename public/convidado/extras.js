// Telas extras do convidado: Playlist da Noite, Caronas, Como chegar e O Pós.
// Usa a ponte window.PVConvidado (api, estado, recarregar) criada em convidado.js.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = () => window.PVConvidado;
  const esc = PV.esc;

  async function acao(fn, sucesso) {
    try {
      await fn();
      if (sucesso) PV.avisar(sucesso, 'ok');
      await C().recarregar();
      return true;
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
      return false;
    }
  }

  // ---------------------------------------------------------------- cards
  function cards(estado) {
    const p = estado.playlist || { musicas: [] };
    const k = estado.caronas || { caronas: [] };
    const livres = k.caronas.reduce((s, c) => s + c.livres, 0);
    const card = (href, icone, nome, quando) => `<a class="atividade contrib" href="${href}">
      <div class="icone">${icone}</div>
      <div><div class="nome">${nome}</div><div class="quando">${quando}</div></div></a>`;
    return card('#playlist', '🎵', 'Playlist da Noite', `Liberado · ${p.musicas.length} ${p.musicas.length === 1 ? 'música' : 'músicas'}`)
      + card('#caronas', '🚗', 'Caronas', `Liberado · ${k.caronas.length ? `${livres} ${livres === 1 ? 'vaga livre' : 'vagas livres'}` : 'ninguém ofereceu ainda'}`)
      + card('#chegar', '📍', 'Como chegar', 'Liberado');
  }

  // ------------------------------------------------------------- playlist
  function desenharPlaylist(p) {
    $('musicas-contador').textContent = `(${p.minhas} de ${p.max})`;
    $('form-musica').querySelector('button').disabled = p.minhas >= p.max;
    $('lista-musicas').innerHTML = p.musicas.length ? p.musicas.map((m, i) => `
      <article class="item-extra ${m.minha ? 'minha' : ''}">
        <div class="pos-num">${i + 1}</div>
        <div class="item-extra-corpo">
          <div class="b-nome">${esc(m.titulo)}</div>
          <div class="fraco">${esc(m.artista)} · sugerida por ${m.minha ? 'você' : esc(m.autor)}</div>
        </div>
        <button type="button" class="voto ${m.votei ? 'votei' : ''}" data-votar="${m.id}" data-quer="${m.votei ? '0' : '1'}"
          aria-label="${m.votei ? 'Tirar voto' : 'Votar'}">🔥 ${m.votos}</button>
        ${m.minha ? `<button type="button" class="tirar" data-tirar-musica="${m.id}" aria-label="Tirar sugestão">✕</button>` : ''}
      </article>`).join('') : '<p class="fraco">Nenhuma música ainda. Comece a playlist!</p>';
  }

  $('form-musica').addEventListener('submit', async (e) => {
    e.preventDefault();
    const botao = e.target.querySelector('button');
    botao.disabled = true;
    try {
      const r = await C().api('POST', '/api/playlist', { titulo: $('musica-titulo').value, artista: $('musica-artista').value });
      $('musica-titulo').value = ''; $('musica-artista').value = '';
      PV.avisar(r.jaExistia ? 'Essa já estava na lista: seu voto foi somado. 🔥' : 'Música sugerida! 🎵', 'ok');
      await C().recarregar();
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  });

  // Voto instantâneo: a tela muda na hora e o servidor confirma por trás. Se der erro, desfaz.
  // Enquanto houver voto a caminho, as atualizações gerais da tela não bagunçam a lista.
  let votosPendentes = 0;
  async function votar(id, quer) {
    const p = C().estado().playlist;
    const m = p.musicas.find((x) => x.id === id);
    if (!m || m.votei === quer) return;
    m.votei = quer;
    m.votos += quer ? 1 : -1;
    desenharPlaylist(p);
    votosPendentes += 1;
    try {
      await C().api('PUT', `/api/playlist/${id}/voto`, { voto: quer });
    } catch (erro) {
      m.votei = !quer;
      m.votos += quer ? -1 : 1;
      desenharPlaylist(p);
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
    } finally {
      votosPendentes -= 1;
    }
  }
  const votando = () => votosPendentes > 0;

  $('lista-musicas').addEventListener('click', (e) => {
    const v = e.target.closest('[data-votar]');
    if (v) return votar(Number(v.dataset.votar), v.dataset.quer === '1');
    const t = e.target.closest('[data-tirar-musica]');
    if (t && confirm('Tirar essa música das suas sugestões?')) return acao(() => C().api('DELETE', `/api/playlist/${t.dataset.tirarMusica}`), 'Sugestão retirada.');
    return null;
  });

  // -------------------------------------------------------------- caronas
  function pessoa(p) {
    const av = p.avatar ? C().emojiDe(p.avatar) : '👤';
    return `<span class="pessoa-chip ${p.souEu ? 'eu' : ''}"><span class="avatar">${av}</span>${esc(p.souEu ? 'Você' : p.nome)}</span>`;
  }

  function desenharCaronas(k) {
    const minha = k.caronas.find((c) => c.minha);
    const reservada = k.caronas.find((c) => c.id === k.reservaEm);
    let topo = '';
    if (minha) {
      topo = `<div class="minha-parte"><h3>Você vai de carro</h3>
        <p style="margin:0 0 8px">${minha.passageiros.length ? `Com você: ${minha.passageiros.map(pessoa).join(' ')}` : 'Ninguém reservou ainda.'}</p>
        <button class="botao perigo pequeno" type="button" data-cancelar-oferta>Cancelar minha carona</button></div>`;
    } else if (reservada) {
      topo = `<div class="minha-parte"><h3>Sua carona</h3>
        <p style="margin:0 0 8px">Com <b>${esc(reservada.motorista)}</b> · ${esc(reservada.trajetoTexto)} · saindo de ${esc(reservada.saindo)}</p>
        <button class="botao secundario pequeno" type="button" data-cancelar-reserva>Cancelar reserva</button></div>`;
    }
    $('minha-carona').innerHTML = topo;

    const outros = k.caronas.filter((c) => !c.minha);
    $('lista-caronas').innerHTML = outros.length ? outros.map((c) => {
      const podeReservar = !minha && !k.reservaEm && c.livres > 0;
      const souPassageiro = c.id === k.reservaEm;
      return `<article class="bebida carona ${c.livres === 0 ? 'completa' : ''} ${souPassageiro ? 'minha' : ''}">
        <div class="b-topo">
          <span class="b-nome"><span class="avatar" style="width:28px;height:28px;font-size:16px;vertical-align:middle">${C().emojiDe(c.avatar)}</span> ${esc(c.motorista)}</span>
          <span class="b-status ${c.livres ? 'falta' : 'ok'}">${c.livres ? `${c.livres} de ${c.vagas} ${c.vagas === 1 ? 'vaga' : 'vagas'} livre${c.livres === 1 ? '' : 's'}` : 'Lotado'}</span>
        </div>
        <div class="fraco" style="margin:6px 0">${esc(c.trajetoTexto)} · saindo de ${esc(c.saindo)}${c.obs ? ` · ${esc(c.obs)}` : ''}</div>
        <div class="b-quem">${c.passageiros.map(pessoa).join('')}</div>
        ${podeReservar ? `<button class="botao pequeno" type="button" data-reservar="${c.id}" style="margin-top:10px">Reservar uma vaga</button>` : ''}
      </article>`;
    }).join('') : (minha ? '' : '<p class="fraco">Ninguém ofereceu carona ainda.</p>');

    // Formulário: some para quem já reservou; vira "editar" para o motorista.
    $('form-carona').classList.toggle('oculto', Boolean(reservada));
    $('form-carona-titulo').textContent = minha ? 'Editar minha carona' : 'Vou de carro';
    $('carona-salvar').textContent = minha ? 'Salvar' : 'Oferecer carona';
    if (minha && document.activeElement && !$('form-carona').contains(document.activeElement)) {
      $('carona-vagas').value = String(minha.vagas);
      $('carona-trajeto').value = minha.trajeto;
      $('carona-saindo').value = minha.saindo;
      $('carona-obs').value = minha.obs || '';
    }
  }

  $('form-carona').addEventListener('submit', (e) => {
    e.preventDefault();
    acao(() => C().api('PUT', '/api/caronas/minha', {
      vagas: Number($('carona-vagas').value), trajeto: $('carona-trajeto').value,
      saindo: $('carona-saindo').value, obs: $('carona-obs').value,
    }), 'Carona salva! 🚗');
  });

  $('tela-caronas').addEventListener('click', (e) => {
    const r = e.target.closest('[data-reservar]');
    if (r) return acao(() => C().api('POST', `/api/caronas/${r.dataset.reservar}/reserva`), 'Vaga reservada! 🚗');
    if (e.target.closest('[data-cancelar-reserva]') && confirm('Cancelar sua reserva?')) {
      return acao(() => C().api('DELETE', '/api/caronas/reserva'), 'Reserva cancelada.');
    }
    if (e.target.closest('[data-cancelar-oferta]') && confirm('Cancelar sua carona? Quem reservou vai ficar sem.')) {
      return acao(() => C().api('DELETE', '/api/caronas/minha'), 'Carona cancelada.');
    }
    return null;
  });

  // ---------------------------------------------------------- como chegar
  function desenharChegar(f) {
    const ch = f.chegada || {};
    const itens = [['Endereço', ch.endereco], ['Quando', PV.periodo(f.inicioMs, f.fimMs)], ['Onde', f.local],
      ['Na portaria', ch.portaria], ['Estacionamento', ch.estacionamento], ['Importante', ch.obs]].filter(([, v]) => v);
    $('chegar-info').innerHTML = itens.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    const q = encodeURIComponent(ch.endereco || f.local || '');
    $('link-maps').href = `https://www.google.com/maps/search/?api=1&query=${q}`;
    $('link-waze').href = `https://waze.com/ul?q=${q}&navigate=yes`;
  }

  // ------------------------------------------------------------------ pós
  function desenharPos(p) {
    if (!p || !p.liberada) return;
    const fecha = PV.dataHora(p.fechaEm, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const lider = p.opcoes.filter((o) => p.lideres.includes(o.id));
    if (p.encerrada) {
      $('pos-status').innerHTML = lider.length === 1
        ? `Votação encerrada. O pós de hoje é: <b>${esc(lider[0].nome)}</b> 👑`
        : (lider.length ? `Votação encerrada com empate: <b>${lider.map((o) => esc(o.nome)).join(' e ')}</b>` : 'Votação encerrada sem votos.');
    } else {
      $('pos-status').textContent = `A festa acaba à meia-noite. Para onde a noite continua? Vote até as ${fecha}. Dá para trocar o voto.`;
    }
    $('pos-opcoes').innerHTML = p.opcoes.map((o) => {
      const pct = p.total ? Math.round((o.votos / p.total) * 100) : 0;
      const meu = p.meuVoto === o.id;
      const ganhando = p.lideres.includes(o.id);
      return `<article class="bebida opcao-pos ${meu ? 'minha' : ''} ${ganhando ? 'completa' : ''}">
        <div class="b-topo"><span class="b-nome">${ganhando ? '👑 ' : ''}${esc(o.nome)}</span>
          <span class="b-status">${o.votos} ${o.votos === 1 ? 'voto' : 'votos'} · ${pct}%</span></div>
        <div class="progresso"><i style="width:${pct}%"></i></div>
        ${p.aberta ? `<button type="button" class="botao ${meu ? 'secundario' : ''} pequeno" data-pos="${o.id}" ${meu ? 'disabled' : ''}>${meu ? 'Seu voto ✓' : 'Votar aqui'}</button>` : ''}
      </article>`;
    }).join('');
  }

  $('pos-opcoes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pos]');
    if (b) acao(() => C().api('PUT', '/api/pos/voto', { opcaoId: Number(b.dataset.pos) }), 'Voto registrado! 🌙');
  });

  function desenhar(estado) {
    if (estado.playlist && !votando()) desenharPlaylist(estado.playlist);
    if (estado.caronas) desenharCaronas(estado.caronas);
    desenharChegar(estado.festa);
    desenharPos(estado.pos);
  }

  window.PVExtras = { cards, desenhar };
})();
