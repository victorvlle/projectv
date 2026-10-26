// Tela do convidado: bloqueio, perfil e a página pré-festa.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const telas = ['tela-carregando', 'tela-bloqueio', 'tela-perfil', 'tela-principal', 'tela-contribuicoes',
    'tela-playlist', 'tela-caronas', 'tela-chegar', 'tela-pos'];
  let telaAtual = 'tela-carregando';
  function mostrar(qual) { telaAtual = qual; telas.forEach((t) => $(t).classList.toggle('oculto', t !== qual)); }

  let token = PV.guardado.ler('pv.token');
  let eu = null;
  let avatares = [];
  let estado = null;
  let liberadasAntes = null; // para animar o cadeado quebrando só no que acabou de abrir
  let socket = null;

  const emojiDe = (id) => (avatares.find((a) => a.id === id) || {}).emoji || '❔';

  function bloquear() {
    PV.guardado.apagar('pv.token');
    token = null;
    if (socket) socket.disconnect();
    mostrar('tela-bloqueio');
  }

  async function api(metodo, url, corpo) {
    try {
      return await PV.chamar(metodo, url, { token, corpo });
    } catch (erro) {
      if (erro.status === 401) bloquear();
      throw erro;
    }
  }

  // ---------------------------------------------------------------- perfil
  let escolhido = null;
  function desenharAvatares() {
    $('grade-avatares').innerHTML = avatares.map((a) => `
      <button type="button" class="opcao-avatar" role="radio" aria-checked="${a.id === escolhido}" data-id="${a.id}">
        <span>${a.emoji}</span>${PV.esc(a.nome)}
      </button>`).join('');
  }
  $('grade-avatares').addEventListener('click', (e) => {
    const b = e.target.closest('.opcao-avatar');
    if (!b) return;
    escolhido = b.dataset.id;
    desenharAvatares();
  });

  function abrirPerfil(editando) {
    escolhido = eu.avatar;
    $('perfil-saudacao').textContent = editando
      ? 'Troque o seu monstro.'
      : `Olá, ${eu.nome}! Escolha o seu monstro para a festa.`;
    $('salvar-perfil').textContent = editando ? 'Salvar' : 'Entrar na festa';
    $('cancelar-perfil').classList.toggle('oculto', !editando);
    desenharAvatares();
    mostrar('tela-perfil');
    window.scrollTo(0, 0);
  }

  $('form-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!escolhido) return PV.avisar('Escolha um monstro.', 'erro');
    const botao = $('salvar-perfil');
    botao.disabled = true;
    try {
      const r = await api('PUT', '/api/eu/perfil', { avatar: escolhido });
      eu = r.eu;
      await carregarFesta();
      irPara(location.hash);
      PV.avisar('Perfil salvo.', 'ok');
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  });
  $('cancelar-perfil').addEventListener('click', () => irPara(location.hash));
  $('botao-eu').addEventListener('click', () => abrirPerfil(true));

  // ------------------------------------------------------------- principal
  async function carregarFesta() {
    const r = await api('GET', '/api/festa');
    PV.relogio.sincronizar(r.agora);
    estado = r;
    desenhar();
  }

  function desenhar() {
    if (!estado || !eu) return;
    $('eu-avatar').textContent = emojiDe(eu.avatar);
    $('eu-nome').textContent = eu.nome || '';
    $('hero-data').textContent = PV.periodo(estado.festa.inicioMs, estado.festa.fimMs);
    tic();

    const agora = PV.relogio.agora();
    const liberadasAgora = new Set(estado.atividades.filter((a) => a.estado === 'liberada').map((a) => a.id));
    const b = estado.bebidas;
    const faltaTotal = b ? b.itens.reduce((s, i) => s + (i.falta > 0 ? 1 : 0), 0) : 0;
    const cardContrib = `<a class="atividade contrib" href="#contribuicoes">
        <div class="icone">🍻</div>
        <div><div class="nome">Contribuições</div>
        <div class="quando">${faltaTotal ? `Liberado · ${faltaTotal} ${faltaTotal === 1 ? 'item precisa' : 'itens precisam'} de alguém` : 'Liberado · tudo garantido'}</div></div>
      </a>`;
    const extras = window.PVExtras ? window.PVExtras.cards(estado) : '';
    $('atividades').innerHTML = cardContrib + extras + estado.atividades.map((a) => {
      const recem = liberadasAntes && liberadasAgora.has(a.id) && !liberadasAntes.has(a.id);
      if (a.estado === 'liberada') {
        // Atividade que já tem tela vira link; as outras abrem na festa.
        const tag = TELAS_ATIVIDADE[a.id] ? `a href="#${a.id}"` : 'article';
        return `<${tag} class="atividade liberada ${recem ? 'recem-aberta' : ''}">
          <div class="icone">${a.icone}</div>
          <div><div class="nome">${PV.esc(a.nome)}</div><div class="quando">Liberado</div></div>
        </${tag.split(' ')[0]}>`;
      }
      const quando = a.abreEm && a.abreEm > agora ? `Abre ${PV.dataCurta(a.abreEm)}` : 'Abre na festa';
      return `<article class="atividade bloqueada">
        <div class="icone">🔒</div>
        <div><div class="nome">${PV.esc(a.enigma)}</div><div class="quando">${PV.esc(quando)}</div></div>
      </article>`;
    }).join('');
    liberadasAntes = liberadasAgora;

    desenharBebidas();
    if (window.PVExtras) window.PVExtras.desenhar(estado);

    const f = estado.festa;
    const itens = [['Quando', PV.periodo(f.inicioMs, f.fimMs)],
      ['Onde', f.local], ['Dress code', f.dressCode], ['O que levar', f.oQueLevar], ['Regras da casa', f.regras]]
      .filter(([, v]) => v);
    $('info').innerHTML = itens.map(([k, v]) => `<div><dt>${PV.esc(k)}</dt><dd>${PV.esc(v)}</dd></div>`).join('');

    $('total-confirmados').textContent = `(${estado.confirmados.length})`;
    $('confirmados').innerHTML = estado.confirmados.length
      ? estado.confirmados.map((c) => `<div class="confirmado ${c.souEu ? 'sou-eu' : ''}">
          <span class="avatar">${emojiDe(c.avatar)}</span><span class="nome-conf">${PV.esc(c.nome)}</span></div>`).join('')
      : '<p class="fraco">Ninguém por aqui ainda… seja o primeiro.</p>';
  }

  // ------------------------------------------------------- lista de bebidas
  // Quantidade que o próprio convidado está mudando agora (ainda não salva no
  // servidor). Tem prioridade sobre o que vem do servidor, para o número não
  // "voltar" enquanto a pessoa toca no + várias vezes.
  const pendentes = new Map();
  const timersBebida = new Map();

  function quantoLevo(item) {
    if (pendentes.has(item.id)) return pendentes.get(item.id);
    const meu = item.quem.find((q) => q.souEu);
    return meu ? meu.quantidade : 0;
  }

  // "1 garrafas de 2 L" -> "1 garrafa de 2 L"
  function unid(u, q) {
    if (q !== 1) return u;
    const [primeira, ...resto] = String(u).split(' ');
    return [primeira.length > 3 && primeira.endsWith('s') ? primeira.slice(0, -1) : primeira, ...resto].join(' ');
  }

  function chipPessoa(q) {
    const av = q.avatar ? emojiDe(q.avatar) : '👤';
    return `<span class="pessoa-chip ${q.souEu ? 'eu' : ''}"><span class="avatar">${av}</span>${PV.esc(q.souEu ? 'Você' : q.nome)} ×${q.quantidade}</span>`;
  }

  function desenharBebidas() {
    const b = estado.bebidas;
    if (!b) return;
    const aberta = b.aberta;
    $('bebidas-fechada').classList.toggle('oculto', aberta);
    $('form-outra').classList.toggle('oculto', !aberta);

    // Minha parte
    const minhas = b.minhas.map((m) => (m.itemId != null && pendentes.has(m.itemId) ? { ...m, quantidade: pendentes.get(m.itemId) } : m))
      .filter((m) => m.quantidade > 0);
    $('bebidas-minha').classList.toggle('oculto', !minhas.length);
    $('bebidas-minha').innerHTML = minhas.length ? `<h3>Você vai levar</h3><ul>${minhas.map((m) => `
      <li><span><b>${m.quantidade}</b> ${PV.esc(unid(m.unidade, m.quantidade))} de ${PV.esc(m.nome)}</span>
        ${aberta ? `<button class="tirar" type="button" data-tirar="${m.id}" aria-label="Tirar ${PV.esc(m.nome)}">✕</button>` : ''}</li>`).join('')}</ul>` : '';

    // O que mais falta (até 4, do que falta mais para o que falta menos)
    // Os totais já contam o que eu acabei de tocar, antes mesmo de salvar.
    const comFalta = b.itens.map((i) => {
      const meuServidor = (i.quem.find((q) => q.souEu) || { quantidade: 0 }).quantidade;
      const total = i.total - meuServidor + quantoLevo(i);
      return { ...i, total, falta: i.meta > 0 ? Math.max(0, i.meta - total) : 0 };
    });
    const top = comFalta.filter((i) => i.falta > 0).sort((x, y) => y.falta / y.meta - x.falta / x.meta).slice(0, 4);
    $('bebidas-falta').innerHTML = top.map((i) =>
      `<button class="chip-falta" type="button" data-ir="${i.id}">${PV.esc(i.nome)} · <b>faltam ${i.falta}</b></button>`).join('');

    $('bebidas-lista').innerHTML = comFalta.map((i) => {
      const levo = quantoLevo(i);
      const completa = i.meta > 0 && i.falta === 0;
      const pct = i.meta > 0 ? Math.min(100, Math.round((i.total / i.meta) * 100)) : (i.total > 0 ? 100 : 0);
      let status;
      if (i.meta > 0) {
        status = completa
          ? `<span class="b-status ok">Garantido ✓ ${i.total}/${i.meta}</span>`
          : `<span class="b-status falta">${i.total} de ${i.meta} ${PV.esc(i.unidade)} · faltam ${i.falta}</span>`;
      } else {
        status = `<span class="b-status">${i.total} ${PV.esc(unid(i.unidade, i.total))}</span>`;
      }
      const quem = i.quem.map((q) => (q.souEu ? { ...q, quantidade: levo } : q)).filter((q) => q.quantidade > 0);
      if (levo > 0 && !quem.some((q) => q.souEu)) quem.push({ souEu: true, avatar: eu.avatar, nome: eu.nome, quantidade: levo });
      return `<article class="bebida ${completa ? 'completa' : ''} ${levo > 0 ? 'minha' : ''}" id="bebida-${i.id}">
        <div class="b-topo"><span class="b-nome">${PV.esc(i.nome)}</span>${status}</div>
        ${i.meta > 0 ? `<div class="progresso"><i style="width:${pct}%"></i></div>` : ''}
        <div class="b-quem">${quem.map(chipPessoa).join('')}</div>
        ${aberta ? `<div class="b-eu"><span>Eu levo</span>
          <div class="passo ${pendentes.has(i.id) ? 'salvando' : ''}" data-item="${i.id}">
            <button type="button" data-delta="-1" ${levo <= 0 ? 'disabled' : ''} aria-label="Menos">−</button>
            <output>${levo}</output>
            <button type="button" data-delta="1" ${levo >= 99 ? 'disabled' : ''} aria-label="Mais">+</button>
            <small>${PV.esc(unid(i.unidade, levo))}</small>
          </div></div>` : ''}
      </article>`;
    }).join('');

    $('bebidas-outras').innerHTML = b.outras.length ? `<h3 class="fraco" style="margin:8px 0 0">Outras bebidas</h3>` + b.outras.map((o) => `
      <article class="bebida">
        <div class="b-topo"><span class="b-nome">${PV.esc(o.nome)}</span><span class="b-status">${o.total} ${PV.esc(unid(o.unidade, o.total))}</span></div>
        <div class="b-quem" style="margin-top:8px">${o.quem.map(chipPessoa).join('')}</div>
      </article>`).join('') : '';
  }

  function salvarItemDepois(itemId) {
    clearTimeout(timersBebida.get(itemId));
    timersBebida.set(itemId, setTimeout(async () => {
      const valor = pendentes.get(itemId);
      try {
        const r = await api('PUT', `/api/bebidas/itens/${itemId}`, { quantidade: valor });
        if (pendentes.get(itemId) === valor) pendentes.delete(itemId);
        estado.bebidas = r.bebidas;
      } catch (erro) {
        pendentes.delete(itemId);
        if (erro.status !== 401) PV.avisar(erro.message, 'erro');
        carregarFesta().catch(() => {});
      }
      desenharBebidas();
    }, 600));
  }

  $('sec-bebidas').addEventListener('click', async (e) => {
    const passo = e.target.closest('.passo button[data-delta]');
    if (passo) {
      const itemId = Number(passo.closest('.passo').dataset.item);
      const item = estado.bebidas.itens.find((i) => i.id === itemId);
      if (!item) return;
      const novo = Math.max(0, Math.min(99, quantoLevo(item) + Number(passo.dataset.delta)));
      pendentes.set(itemId, novo);
      desenharBebidas();
      salvarItemDepois(itemId);
      return;
    }
    const ir = e.target.closest('[data-ir]');
    if (ir) {
      const alvo = $(`bebida-${ir.dataset.ir}`);
      if (alvo) {
        alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        alvo.classList.remove('destaque'); void alvo.offsetWidth; alvo.classList.add('destaque');
      }
      return;
    }
    const tirar = e.target.closest('[data-tirar]');
    if (tirar) {
      const id = Number(tirar.dataset.tirar);
      const minha = estado.bebidas.minhas.find((m) => m.id === id);
      try {
        if (minha && minha.itemId != null) {
          pendentes.delete(minha.itemId);
          clearTimeout(timersBebida.get(minha.itemId));
        }
        const r = await api('DELETE', `/api/bebidas/minhas/${id}`);
        estado.bebidas = r.bebidas;
        desenharBebidas();
      } catch (erro) {
        if (erro.status !== 401) PV.avisar(erro.message, 'erro');
      }
    }
  });

  $('form-outra').addEventListener('submit', async (e) => {
    e.preventDefault();
    const botao = e.target.querySelector('button');
    botao.disabled = true;
    try {
      const r = await api('POST', '/api/bebidas/outras', {
        nome: $('outra-nome').value, quantidade: Number($('outra-qtd').value), unidade: $('outra-unidade').value,
      });
      estado.bebidas = r.bebidas;
      $('outra-nome').value = ''; $('outra-qtd').value = '1'; $('outra-unidade').value = '';
      desenharBebidas();
      PV.avisar('Anotado! 🍻', 'ok');
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  });

  const dois = (n) => String(n).padStart(2, '0');
  function tic() {
    if (!estado) return;
    const c = PV.contagem(estado.festa.inicioMs - PV.relogio.agora());
    $('relogio').classList.toggle('oculto', c.acabou);
    $('hero-sub').classList.toggle('oculto', c.acabou);
    $('portoes').classList.toggle('oculto', !c.acabou);
    $('portoes').textContent = PV.relogio.agora() >= estado.festa.fimMs ? 'Até a próxima edição' : 'Os portões estão abertos';
    if (!c.acabou) {
      $('r-dias').textContent = c.dias;
      $('r-horas').textContent = dois(c.horas);
      $('r-min').textContent = dois(c.minutos);
      $('r-seg').textContent = dois(c.segundos);
    }
  }
  setInterval(tic, 1000);

  // Botões "Recarregar" (sem onclick embutido, por causa da política de conteúdo).
  document.addEventListener('click', (e) => { if (e.target.closest('[data-recarregar]')) location.reload(); });

  // ------------------------------------------------------------- navegação
  // #contribuicoes abre a tela de contribuições; o "voltar" do celular funciona.
  const TELAS_ATIVIDADE = { pos: true };
  // Telas extras: hash -> id da tela. #pos só abre quando a atividade foi liberada.
  const TELAS = {
    '#contribuicoes': 'tela-contribuicoes', '#playlist': 'tela-playlist',
    '#caronas': 'tela-caronas', '#chegar': 'tela-chegar', '#pos': 'tela-pos',
  };
  function irPara(hash) {
    if (!eu || !eu.perfilCompleto) return;
    let tela = TELAS[hash];
    if (hash === '#pos' && !(estado && estado.pos && estado.pos.liberada)) tela = null;
    if (tela) {
      if (telaAtual !== tela) window.scrollTo(0, 0);
      mostrar(tela);
    } else {
      mostrar('tela-principal');
    }
  }
  window.addEventListener('hashchange', () => irPara(location.hash));
  // Tocar num card cujo # já está na barra não dispara "hashchange": abre direto.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]:not(.voltar)');
    if (link && link.getAttribute('href') === location.hash) { e.preventDefault(); irPara(location.hash); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.voltar')) return;
    e.preventDefault();
    if (history.length > 1 && TELAS[location.hash]) history.back();
    else { location.hash = ''; irPara(''); }
  });

  // Ponte para extras.js (playlist, caronas, como chegar, pós).
  window.PVConvidado = {
    api, emojiDe,
    eu: () => eu,
    estado: () => estado,
    recarregar: () => carregarFesta().catch(() => {}),
  };

  // ------------------------------------------------------------------ início
  async function iniciar() {
    // Atalho da tela inicial (iPhone) abre com ?c=<código>: troca por uma sessão nova.
    const params = new URLSearchParams(location.search);
    const codigo = params.get('c');
    if (codigo) {
      try {
        const r = await PV.chamar('POST', '/api/entrar', { corpo: { codigo } });
        token = r.token;
        PV.guardado.gravar('pv.token', token);
      } catch (_) { /* código inválido: segue com o que tiver */ }
      history.replaceState(null, '', '/' + location.hash);
    }
    if (!token) return mostrar('tela-bloqueio');
    try {
      const [r, a] = await Promise.all([api('GET', '/api/eu'), PV.chamar('GET', '/api/avatares')]);
      eu = r.eu;
      avatares = a.avatares;
    } catch (erro) {
      if (erro.status === 401) return; // bloquear() já cuidou
      $('tela-carregando').innerHTML = `<p class="mudo" style="text-align:center;padding:24px">${PV.esc(erro.message)}<br><br>
        <button class="botao" data-recarregar>Tentar de novo</button></p>`;
      return;
    }

    if (!eu.perfilCompleto) abrirPerfil(false);

    const recarregar = PV.adiar(() => carregarFesta().catch(() => {}));
    socket = PV.conectar({
      tipo: 'convidado',
      token,
      aoConectar: () => {
        carregarFesta()
          .then(() => { if (eu.perfilCompleto && telaAtual === 'tela-carregando') irPara(location.hash); })
          .catch(() => {});
      },
      aoNegar: bloquear,
      eventos: {
        atualizar: recarregar,
        'sessao:encerrada': bloquear,
      },
    });
  }

  // Se algo inesperado quebrar na abertura, nunca deixa o convidado preso no
  // carregando: mostra um aviso com botão para tentar de novo.
  iniciar().catch((erro) => {
    console.error(erro);
    mostrar('tela-carregando');
    $('tela-carregando').innerHTML = `<p class="mudo" style="text-align:center;padding:24px">
      Não consegui abrir a página. Tente recarregar.<br><br>
      <button class="botao" data-recarregar>Recarregar</button></p>`;
  });
})();
