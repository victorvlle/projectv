// Jogos do convidado: Previsões, Enigma do dia, Ranking e o aviso da Maldição no celular.
// Usa a ponte window.PVConvidado (api, estado, recarregar, atualizarParte) de convidado.js.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = () => window.PVConvidado;
  const esc = PV.esc;
  const emoji = (id) => (C() ? C().emojiDe(id) : '❔');
  const ultimaAssinatura = {};

  // Redesenha uma área só se o conteúdo mudou e ninguém está digitando nela.
  function pintar(id, html) {
    const el = $(id);
    if (!el) return;
    if (ultimaAssinatura[id] === html) return;
    // Não atrapalha quem está digitando, a menos que aquele campo vá sumir (ex.: enigma encerrado).
    const foco = document.activeElement;
    if (el.contains(foco) && foco.tagName === 'INPUT' && foco.id && html.includes(`id="${foco.id}"`)) return;
    ultimaAssinatura[id] = html;
    el.innerHTML = html;
  }

  // ---------------------------------------------------------------- cards
  function cards(estado) {
    const e = estado.enigmas;
    const r = estado.ranking;
    let enigmaQuando = 'Começa quarta';
    if (e) {
      const aberto = e.enigmas.find((x) => x.estado === 'aberto' && (x.fase === 'nao-revelado' || x.fase === 'respondendo'));
      const proximo = e.enigmas.find((x) => x.estado === 'em-breve');
      if (aberto) enigmaQuando = 'Liberado · tem enigma para resolver';
      else if (proximo) enigmaQuando = `Próximo: ${PV.dataCurta(proximo.abreEm)}`;
      else enigmaQuando = 'Liberado · todos resolvidos ou fechados';
    }
    const pos = r && r.eu ? `${r.eu.posicao}º lugar · ${r.eu.pontos.toLocaleString('pt-BR')} pts` : 'Ainda sem pontos';
    const card = (href, icone, nome, quando) => `<a class="atividade contrib" href="${href}">
      <div class="icone">${icone}</div>
      <div><div class="nome">${nome}</div><div class="quando">${esc(quando)}</div></div></a>`;
    return card('#enigma', '🧩', 'Enigma do dia', enigmaQuando) + card('#ranking', '🏆', 'Ranking', pos);
  }

  // ------------------------------------------------------------ previsões
  function statusPrevisoes(p) {
    const barra = `<div class="prev-progresso" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.respondidas}"
      aria-label="${p.respondidas} de ${p.total} respondidas"><i style="width:${Math.round((p.respondidas / p.total) * 100)}%"></i></div>`;
    if (p.estado === 'aguardando') {
      return `<section class="cartao prev-aviso"><b>🔒 Abrem ${p.abreEm ? esc(PV.dataCurta(p.abreEm)) : 'em breve'}</b>
        <p class="mudo">Dá para ler as perguntas desde já. Cada acerto vale ${p.pontosPorAcerto} pontos.</p></section>`;
    }
    if (p.estado === 'aberta') {
      return `<section class="cartao prev-aviso aberta"><b>Abertas até ${esc(PV.dataCurta(p.fechaEm))}</b>
        <p class="mudo">Toque para escolher. Dá para trocar até fechar. Ninguém vê o seu palpite. +${p.pontosPorAcerto} por acerto.</p>
        <p class="prev-contagem"><b>${p.respondidas}</b> de ${p.total} respondidas</p>${barra}</section>`;
    }
    if (p.estado === 'encerrada') {
      return `<section class="cartao prev-aviso"><b>🔒 Previsões encerradas</b>
        <p class="mudo">Você respondeu ${p.respondidas} de ${p.total}. O resultado sai na festa, no telão.</p></section>`;
    }
    return `<section class="cartao prev-aviso publicada"><b>🎉 Você acertou ${p.acertos} de ${p.total}</b>
      <p class="mudo">+${p.acertos * p.pontosPorAcerto} pontos no ranking.</p></section>`;
  }

  function cartaoPergunta(q, p) {
    const aberta = p.estado === 'aberta';
    const publicada = p.estado === 'publicada';
    let corpo;
    if (q.tipo === 'opcoes') {
      corpo = `<div class="prev-opcoes" role="group" aria-label="${esc(q.texto)}">${q.opcoes.map((o) => {
        const minha = q.minha === o.id;
        const certa = publicada && q.resposta === o.id;
        return `<button type="button" class="prev-opcao ${minha ? 'minha' : ''} ${certa ? 'certa' : ''}" data-prev="${esc(q.id)}" data-escolha="${esc(o.id)}"
          aria-pressed="${minha}" ${aberta ? '' : 'disabled'}>${esc(o.nome)}</button>`;
      }).join('')}</div>`;
    } else {
      const pessoa = q.minha ? p.pessoas.find((x) => x.id === q.minha) : null;
      corpo = `<button type="button" class="prev-pessoa ${pessoa ? 'minha' : ''}" data-escolher="${esc(q.id)}" ${aberta ? '' : 'disabled'}>
        ${pessoa ? `<span class="avatar">${emoji(pessoa.avatar)}</span><span>${esc(pessoa.souEu ? `${pessoa.nome} (você)` : pessoa.nome)}</span>`
          : `<span class="avatar vazio">?</span><span>${aberta ? 'Escolher pessoa' : 'Sem palpite'}</span>`}
        ${aberta ? '<span class="trocar">trocar</span>' : ''}</button>`;
    }
    let resultado = '';
    if (publicada) {
      resultado = q.resposta
        ? `<p class="prev-resultado ${q.acertei ? 'acertou' : 'errou'}">${q.acertei ? '✓ Você acertou' : '✗ Resposta'}: <b>${esc(q.respostaNome || '')}</b></p>`
        : '<p class="prev-resultado">Sem resultado oficial nesta pergunta.</p>';
    }
    const feita = Boolean(q.minha);
    return `<article class="prev-card ${feita ? 'feita' : ''}" id="prev-${esc(q.id)}">
      <div class="prev-topo"><span class="prev-num">${q.ordem}</span><h2>${esc(q.texto)}</h2>
        ${feita && !publicada ? '<span class="prev-ok" aria-label="Respondida">✓</span>' : ''}</div>
      ${corpo}${resultado}</article>`;
  }

  function desenharPrevisoes(p) {
    if (!p) return;
    pintar('prev-status', statusPrevisoes(p));
    pintar('prev-lista', p.perguntas.map((q) => cartaoPergunta(q, p)).join(''));
  }

  let salvando = false;
  async function responder(perguntaId, escolha) {
    if (salvando) return;
    salvando = true;
    try {
      const r = await C().api('PUT', `/api/previsoes/${encodeURIComponent(perguntaId)}`, { escolha });
      C().atualizarParte('previsoes', r.previsoes);
      PV.avisar(escolha === null ? 'Palpite retirado.' : 'Palpite salvo ✓', 'ok');
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
      if (erro.status === 409) C().recarregar();
    } finally {
      salvando = false;
    }
  }

  // Escolher pessoa: folha com busca.
  let folha = null;
  let perguntaEscolhendo = null;
  function abrirEscolha(perguntaId) {
    const p = C().estado().previsoes;
    const q = p.perguntas.find((x) => x.id === perguntaId);
    if (!q) return;
    perguntaEscolhendo = q;
    if (!folha) {
      folha = document.createElement('div');
      folha.className = 'modal-fundo oculto';
      folha.innerHTML = `<div class="modal cartao folha folha-pessoas" role="dialog" aria-modal="true" aria-labelledby="pessoas-titulo">
        <button class="fechar-folha" type="button" data-fechar-pessoas aria-label="Fechar">✕</button>
        <h3 id="pessoas-titulo"></h3>
        <input id="pessoas-busca" type="search" placeholder="Buscar nome" autocomplete="off">
        <div id="pessoas-lista" class="pessoas-lista"></div>
        <button class="botao-discreto" type="button" data-limpar-pessoa>Tirar meu palpite</button></div>`;
      document.body.appendChild(folha);
      folha.addEventListener('click', (e) => {
        if (e.target === folha || e.target.closest('[data-fechar-pessoas]')) return fecharEscolha();
        const b = e.target.closest('[data-pessoa]');
        if (b) { const id = b.dataset.pessoa; fecharEscolha(); return responder(perguntaEscolhendo.id, id); }
        if (e.target.closest('[data-limpar-pessoa]')) { fecharEscolha(); return responder(perguntaEscolhendo.id, null); }
        return null;
      });
      folha.querySelector('#pessoas-busca').addEventListener('input', listarPessoas);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !folha.classList.contains('oculto')) fecharEscolha(); });
    }
    folha.querySelector('#pessoas-titulo').textContent = q.texto;
    folha.querySelector('#pessoas-busca').value = '';
    folha.querySelector('[data-limpar-pessoa]').classList.toggle('oculto', !q.minha);
    listarPessoas();
    folha.classList.remove('oculto');
    document.body.classList.add('sem-rolagem');
    folha.querySelector('#pessoas-titulo').setAttribute('tabindex', '-1');
    folha.querySelector('#pessoas-titulo').focus({ preventScroll: true });
  }
  function listarPessoas() {
    const p = C().estado().previsoes;
    const termo = folha.querySelector('#pessoas-busca').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const lista = p.pessoas.filter((x) => !termo || x.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(termo));
    folha.querySelector('#pessoas-lista').innerHTML = lista.map((x) => `
      <button type="button" class="pessoa-opcao ${perguntaEscolhendo.minha === x.id ? 'minha' : ''}" data-pessoa="${esc(x.id)}">
        <span class="avatar">${emoji(x.avatar)}</span><span>${esc(x.nome)}${x.souEu ? ' <em>(você)</em>' : ''}</span></button>`).join('')
      || '<p class="fraco">Ninguém com esse nome.</p>';
  }
  function fecharEscolha() {
    folha.classList.add('oculto');
    document.body.classList.remove('sem-rolagem');
    const alvo = perguntaEscolhendo && document.querySelector(`[data-escolher="${perguntaEscolhendo.id}"]`);
    if (alvo) alvo.focus({ preventScroll: true });
  }

  $('prev-lista').addEventListener('click', (e) => {
    const o = e.target.closest('[data-prev]');
    if (o && !o.disabled) {
      const q = C().estado().previsoes.perguntas.find((x) => x.id === o.dataset.prev);
      return responder(o.dataset.prev, q && q.minha === o.dataset.escolha ? null : o.dataset.escolha);
    }
    const p = e.target.closest('[data-escolher]');
    if (p && !p.disabled) abrirEscolha(p.dataset.escolher);
    return null;
  });

  // -------------------------------------------------------------- enigmas
  // Modo prova: o texto só aparece ao tocar em "Revelar"; o relógio é do servidor; sair da
  // página (trocar de app/aba, bloquear a tela, recarregar) encerra o enigma para a pessoa.
  let enigmasAtuais = null;
  let relogioEnigma = null;
  let travaTela = null;

  const emAndamento = () => (enigmasAtuais ? enigmasAtuais.enigmas.filter((x) => x.fase === 'respondendo') : []);
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function cartaoEnigma(x, e) {
    const cab = `<div class="enigma-topo"><h2>${esc(x.titulo)}</h2><span class="enigma-acert">${x.acertadores} ${x.acertadores === 1 ? 'acertou' : 'acertaram'}</span></div>`;
    if (x.estado === 'em-breve') {
      return `<article class="cartao enigma bloqueado">${cab}<p class="mudo">🔒 Abre ${esc(PV.dataCurta(x.abreEm))}.</p></article>`;
    }
    if (x.estado === 'fechado') {
      return `<article class="cartao enigma fechado">${cab}<p class="enigma-texto">${esc(x.pergunta)}</p>
        <p class="mudo">Fechado. Resposta: <b>${esc(x.resposta || '')}</b>${x.resolvi ? ' · você acertou ✓' : ''}</p></article>`;
    }
    if (x.fase === 'resolvido') {
      const bonus = x.posicao ? (e.bonus[x.posicao - 1] || 0) : 0;
      return `<article class="cartao enigma resolvido">${cab}<p class="enigma-texto">${esc(x.pergunta)}</p>
        <p class="enigma-ok">✓ Você acertou${x.posicao ? ` em ${x.posicao}º lugar` : ''} · +${e.pontos + bonus} pts</p></article>`;
    }
    if (x.fase === 'saiu' || x.fase === 'tempo' || x.fase === 'sem-tentativas') {
      const motivo = { saiu: 'Você saiu da página com o enigma aberto.', tempo: 'O tempo acabou.', 'sem-tentativas': 'Suas tentativas acabaram.' }[x.fase];
      return `<article class="cartao enigma encerrado">${cab}<p class="mudo">⛔ ${motivo} Esse enigma foi encerrado para você. A resposta aparece quando os enigmas fecharem.</p></article>`;
    }
    if (x.fase === 'respondendo') {
      return `<article class="cartao enigma aberto respondendo" data-expira="${x.expiraEm}">
        <div class="enigma-topo"><h2>${esc(x.titulo)}</h2><span class="enigma-relogio" data-relogio="${esc(x.id)}" aria-live="off">${mmss(x.expiraEm - PV.relogio.agora())}</span></div>
        <p class="enigma-texto">${esc(x.pergunta)}</p>
        <form class="enigma-form" data-enigma="${esc(x.id)}">
          <label class="oculto-visual" for="enigma-${esc(x.id)}">Nome do filme</label>
          <input id="enigma-${esc(x.id)}" name="resposta" maxlength="60" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Nome do filme" required>
          <button class="botao" type="submit">Responder</button>
        </form>
        <div class="enigma-rodape"><span class="fraco">⚠️ Não saia desta página</span></div>
        <p class="enigma-retorno" role="status" id="retorno-${esc(x.id)}"></p></article>`;
    }
    // Ainda não revelado
    const min = Math.round(e.tempoS / 60 * 10) / 10;
    return `<article class="cartao enigma pronto">${cab}
      <p class="enigma-prazo">⏳ Disponível até ${esc(PV.dataCurta(x.fechaEm))}, quando abre o próximo.</p>
      <p class="enigma-regras">Ao revelar, você tem <b>${e.tempoS % 60 ? `${e.tempoS} segundos` : `${min} ${min === 1 ? 'minuto' : 'minutos'}`}</b> e ${e.maxTentativas} tentativas.
        <b>Não saia desta página</b> (nem troque de app, recarregue ou bloqueie a tela): se sair, o enigma é encerrado para você.</p>
      <button class="botao largo" type="button" data-revelar="${esc(x.id)}">Revelar enigma</button></article>`;
  }

  function desenharEnigmas(e) {
    if (!e) return;
    enigmasAtuais = e;
    const b = e.bonus;
    pintar('enigma-intro', `Enigmas de filmes de terror, dos clássicos aos de 2026: três por dia, até quinta, de manhã (8h), à tarde (13h) e à noite (19h). Cada enigma fecha quando o próximo abre. Responda com o nome do filme. Acertou: +${e.pontos} pontos; os três primeiros de cada enigma ganham bônus: 1º +${b[0]}, 2º +${b[1]}, 3º +${b[2]}.`);
    const peso = (x) => (x.fase === 'respondendo' ? -1 : x.estado === 'aberto' && x.fase === 'nao-revelado' ? 0 : x.estado === 'em-breve' ? 1 : 2);
    const ordenados = [...e.enigmas].sort((a, b2) => peso(a) - peso(b2) || (peso(a) === 2 ? b2.abreEm - a.abreEm : a.abreEm - b2.abreEm));
    const proximo = ordenados.find((x) => x.estado === 'em-breve');
    const visiveis = ordenados.filter((x) => x.estado !== 'em-breve' || x === proximo);
    pintar('enigmas', visiveis.map((x) => cartaoEnigma(x, e)).join(''));
    vigiar();
  }

  // Relógio na tela + tela acesa enquanto houver enigma revelado.
  function vigiar() {
    const ativos = emAndamento();
    clearInterval(relogioEnigma);
    if (!ativos.length) { soltarTela(); return; }
    manterTelaAcesa();
    relogioEnigma = setInterval(() => {
      for (const x of ativos) {
        const el = document.querySelector(`[data-relogio="${x.id}"]`);
        const resta = x.expiraEm - PV.relogio.agora();
        if (el) { el.textContent = mmss(resta); el.classList.toggle('acabando', resta < 20000); }
        if (resta < -3500) { clearInterval(relogioEnigma); recarregarEnigmas(); }
      }
    }, 250);
  }
  async function manterTelaAcesa() {
    try { if (!travaTela && 'wakeLock' in navigator) travaTela = await navigator.wakeLock.request('screen'); } catch (_) { /* opcional */ }
  }
  function soltarTela() { try { if (travaTela) travaTela.release(); } catch (_) { /* ignora */ } travaTela = null; }

  async function recarregarEnigmas() {
    try {
      const r = await C().api('GET', '/api/enigmas');
      C().atualizarParte('enigmas', r.enigmas);
    } catch (_) { /* tenta na próxima */ }
  }

  // Saiu da tela com enigma revelado: avisa o servidor na hora (keepalive chega mesmo fechando).
  function denunciarSaida() {
    for (const x of emAndamento()) C().sinal(`/api/enigmas/${encodeURIComponent(x.id)}/saiu`);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') denunciarSaida();
    else { travaTela = null; if (emAndamento().length) recarregarEnigmas(); }
  });
  window.addEventListener('pagehide', denunciarSaida);

  $('enigmas').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-revelar]');
    if (!b) return;
    b.disabled = true;
    try {
      const r = await C().api('POST', `/api/enigmas/${encodeURIComponent(b.dataset.revelar)}/revelar`);
      C().atualizarParte('enigmas', r.enigmas);
      const input = document.getElementById(`enigma-${b.dataset.revelar}`);
      if (input) input.focus();
    } catch (erro) {
      b.disabled = false;
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
    }
  });

  $('enigmas').addEventListener('submit', async (ev) => {
    const f = ev.target.closest('form[data-enigma]');
    if (!f) return;
    ev.preventDefault();
    const id = f.dataset.enigma;
    const input = f.querySelector('input');
    const botao = f.querySelector('button');
    const retorno = $(`retorno-${id}`);
    botao.disabled = true;
    try {
      const r = await C().api('POST', `/api/enigmas/${encodeURIComponent(id)}/resposta`, { resposta: input.value });
      const res = r.resultado;
      if (res.acertou) {
        input.blur();
        PV.avisar(res.jaTinha ? 'Você já tinha acertado.' : `Acertou em ${res.segundos}s! +${res.pontos} pontos${res.bonus ? ` (${res.posicao}º lugar)` : ''} 🎉`, 'ok');
        C().atualizarParte('enigmas', r.enigmas);
        C().recarregar();
      } else {
        retorno.textContent = res.restantes ? `Não é esse. ${res.restantes} ${res.restantes === 1 ? 'tentativa restante' : 'tentativas restantes'}.` : 'Não é esse, e as tentativas acabaram.';
        retorno.className = 'enigma-retorno erro';
        input.select();
        if (!res.restantes) recarregarEnigmas();
      }
    } catch (erro) {
      if (erro.status !== 401) { retorno.textContent = erro.message; retorno.className = 'enigma-retorno erro'; }
      if (erro.status === 409 || erro.status === 429) recarregarEnigmas();
    } finally {
      botao.disabled = false;
    }
  });

  // -------------------------------------------------------------- ranking
  function desenharRanking(r) {
    if (!r) return;
    const linha = (x) => `<li class="rank-linha ${x.souEu ? 'rank-minha' : ''} ${x.posicao <= 3 ? `top${x.posicao}` : ''}">
      <span class="rank-pos">${x.posicao <= 3 ? ['🥇', '🥈', '🥉'][x.posicao - 1] : `${x.posicao}º`}</span>
      <span class="avatar">${emoji(x.avatar)}</span><span class="rank-nome">${esc(x.souEu ? `${x.nome} (você)` : x.nome)}</span>
      <span class="rank-pts">${x.pontos.toLocaleString('pt-BR')}</span></li>`;
    const euFora = r.eu && !r.top.some((x) => x.souEu);
    const ex = r.extrato;
    pintar('ranking', `
      ${r.eu ? `<section class="cartao rank-eu"><div><small>Sua posição</small><b>${r.eu.posicao}º</b></div>
        <div><small>Seus pontos</small><b>${r.eu.pontos.toLocaleString('pt-BR')}</b></div><div><small>Na disputa</small><b>${r.total}</b></div></section>` : ''}
      <ol class="rank-lista">${r.top.map(linha).join('')}${euFora ? `<li class="rank-sep">…</li>${linha(r.eu)}` : ''}</ol>
      ${r.top.every((x) => x.pontos === 0) ? '<p class="fraco">Ninguém pontuou ainda. Resolva o enigma do dia, ofereça carona ou sugira músicas.</p>' : ''}
      <section class="cartao pref-bloco"><h2 class="titulo-secao" style="margin-top:0">De onde vêm seus pontos</h2>
        ${ex.porAtividade.length ? `<ul class="rank-extrato">${ex.porAtividade.map((a) => `<li><span>${esc(a.nome)}</span><b>${a.pontos.toLocaleString('pt-BR')}</b></li>`).join('')}</ul>` : '<p class="fraco">Nada ainda.</p>'}
        <p class="fraco">Os pontos grandes são na festa: Previsões +1000 por acerto · Quiz Relâmpago +500 por acerto · Concurso de Fantasia 1º +1000, 2º +800, 3º +500 · Maldição cumprida +500.
          Pré-festa (bônus): Enigma +10 e bônus · Carona +5 · Música +5 · Bebida levada +5 (confirmada na festa).</p>
      </section>`);
  }

  // ------------------------------------------------- maldição no celular
  let timerMaldicao = null;
  function avisoMaldicao(d) {
    let el = $('alerta-maldicao');
    if (!el) {
      el = document.createElement('div');
      el.id = 'alerta-maldicao';
      el.className = 'alerta-maldicao oculto';
      el.setAttribute('role', 'alertdialog');
      el.setAttribute('aria-live', 'assertive');
      document.body.appendChild(el);
      el.addEventListener('click', (e) => { if (e.target.closest('[data-fechar-maldicao]')) el.classList.add('oculto'); });
    }
    const revela = d.sorteadaEm + d.fases.alerta + d.fases.suspense;
    const fim = revela + d.fases.cumprir;
    function tic() {
      const agora = PV.relogio.agora();
      const resta = Math.max(0, Math.ceil((fim - agora) / 1000));
      const contagem = el.querySelector('.maldicao-tempo');
      if (contagem) contagem.textContent = agora < revela ? 'Olhe o telão…' : resta ? `${resta}s para cumprir` : 'Tempo! Agora é com o organizador.';
      if (agora > fim + 60000) { clearInterval(timerMaldicao); el.classList.add('oculto'); }
    }
    el.innerHTML = `<div class="maldicao-caixa">
      <div class="maldicao-icone" aria-hidden="true">💀</div>
      <h2>Você foi amaldiçoado!</h2>
      <p class="maldicao-castigo">${esc(d.castigo)}</p>
      <p class="maldicao-tempo"></p>
      <button class="botao largo" type="button" data-fechar-maldicao>Entendi</button></div>`;
    el.classList.remove('oculto');
    if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch (_) { /* opcional */ } }
    clearInterval(timerMaldicao);
    tic();
    timerMaldicao = setInterval(tic, 1000);
    el.querySelector('[data-fechar-maldicao]').focus({ preventScroll: true });
  }
  document.addEventListener('pv:maldicao', (e) => avisoMaldicao(e.detail));

  async function desenharMinhaMaldicao() {
    try {
      const r = await C().api('GET', '/api/maldicao/minha');
      const m = r.maldicao;
      pintar('maldicao-minha', m
        ? `<section class="cartao maldicao-cartao"><b>💀 A maldição está sobre você</b><p>${esc(m.castigo)}</p>
            <p class="fraco">Cumpra no telão. O organizador confirma e você ganha +500 pontos.</p></section>`
        : `<section class="cartao"><b>Nenhuma maldição sobre você agora.</b>
            <p class="mudo">Durante a festa, de tempos em tempos alguém é sorteado no telão para um castigo de bebida. Se for você, o celular avisa.</p></section>`);
      // Abriu o celular depois do sorteio (ex.: tocou na notificação): mostra o aviso também.
      if (m && PV.relogio.agora() < m.sorteadaEm + m.fases.alerta + m.fases.suspense + m.fases.cumprir) avisoMaldicao(m);
    } catch (_) { /* tenta de novo na próxima */ }
  }
  document.addEventListener('pv:tela', (e) => { if (e.detail === 'tela-maldicao') desenharMinhaMaldicao(); });

  function desenhar(estado) {
    desenharPrevisoes(estado.previsoes);
    desenharEnigmas(estado.enigmas);
    desenharRanking(estado.ranking);
  }

  window.PVJogos = { cards, desenhar };
})();
