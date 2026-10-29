// Jogos da festa no celular: Quiz Relâmpago, Concurso de Fantasia e Correio das Trevas.
// Usa a ponte window.PVConvidado (api, estado, atualizarParte, emojiDe) de convidado.js.
// Os dados só chegam do servidor quando o jogo está liberado (ou em teste para quem testa).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = () => window.PVConvidado;
  const esc = PV.esc;
  const emoji = (id) => (C() ? C().emojiDe(id) : '❔');
  const LETRAS = ['A', 'B', 'C', 'D'];
  const pts = (n) => Number(n).toLocaleString('pt-BR');
  const assinaturas = {};

  function pintar(id, html) {
    const el = $(id);
    if (!el || assinaturas[id] === html) return;
    assinaturas[id] = html;
    el.innerHTML = html;
  }
  const seloTeste = (x) => (x && x.teste ? '<p class="selo-teste">🧪 Modo teste: só os testadores veem isto. Os pontos somem quando o organizador apagar os dados de teste.</p>' : '');
  const telaAberta = (id) => !$(id).classList.contains('oculto');

  // ================================================================== QUIZ
  let quiz = null;
  let escolhaQuiz = null; // opção tocada, ainda não confirmada
  let relogioQuiz = null;
  let enviandoQuiz = false;
  let avisadoDe = null;

  const resta = (fimEm) => Math.max(0, Math.ceil((fimEm - PV.relogio.agora()) / 1000));

  function cartaoAtual(q, x) {
    const cab = `<p class="quiz-num">Pergunta ${x.ordem} de ${q.total}</p><h2 class="quiz-pergunta">${esc(x.texto)}</h2>`;
    const respondendo = x.fase === 'respondendo' && resta(x.fimEm) > 0;
    if (respondendo && x.minha === null) {
      const ops = x.opcoes.map((o, i) => `<button type="button" class="quiz-opcao op${i} ${escolhaQuiz === i ? 'escolhida' : ''}" data-quiz-op="${i}"
          aria-pressed="${escolhaQuiz === i}"><b>${LETRAS[i]}</b><span>${esc(o)}</span></button>`).join('');
      return `<section class="cartao quiz-cartao valendo">${cab}
        <div class="quiz-tempo"><i data-quiz-barra style="width:100%"></i></div><p class="quiz-seg" data-quiz-seg>${resta(x.fimEm)}s</p>
        <div class="quiz-opcoes">${ops}</div>
        <button class="botao largo" type="button" data-quiz-confirmar ${escolhaQuiz === null ? 'disabled' : ''}>
          ${escolhaQuiz === null ? 'Toque numa opção' : `Confirmar ${LETRAS[escolhaQuiz]}`}</button>
        <p class="fraco quiz-regra">Uma chance só: depois de confirmar, não dá para trocar.</p></section>`;
    }
    const minha = x.minha !== null ? `<b>${LETRAS[x.minha]}</b> · ${esc(x.opcoes[x.minha])}` : null;
    if (x.fase === 'revelada') {
      const certa = `<b>${LETRAS[x.correta]}</b> · ${esc(x.opcoes[x.correta])}`;
      return `<section class="cartao quiz-cartao ${x.acertei ? 'acertou' : 'errou'}">${cab}
        <p class="quiz-veredito">${x.acertei ? `✓ Você acertou! +${pts(q.pontos)} pontos` : x.minha === null ? 'Você não respondeu esta.' : '✗ Não foi dessa vez.'}</p>
        <p>Resposta certa: ${certa}</p>${minha && !x.acertei ? `<p class="fraco">Sua resposta: ${minha}</p>` : ''}</section>`;
    }
    if (respondendo) {
      return `<section class="cartao quiz-cartao registrada">${cab}
        <p class="quiz-veredito">Resposta registrada ✓</p><p>${minha}</p>
        <p class="quiz-seg" data-quiz-seg>${resta(x.fimEm)}s</p><p class="fraco">A resposta certa aparece no telão quando o tempo acabar.</p></section>`;
    }
    return `<section class="cartao quiz-cartao registrada">${cab}
      <p class="quiz-veredito">⏱️ Tempo esgotado</p>
      <p>${minha ? `Sua resposta: ${minha}` : 'Você não respondeu a tempo.'}</p><p class="fraco">Olhe o telão: a resposta certa vem aí.</p></section>`;
  }

  function desenharQuiz(q) {
    quiz = q;
    if (!q) { const f = $('faixa-quiz'); if (f) f.classList.add('oculto'); return; }
    const x = q.atual;
    if (!x || x.id !== (desenharQuiz.ultima || null)) { escolhaQuiz = null; desenharQuiz.ultima = x ? x.id : null; }
    const espera = `<section class="cartao"><b>Fique de olho no telão</b>
      <p class="mudo">As perguntas aparecem no telão durante a festa e aqui no celular ao mesmo tempo. ${q.total} perguntas,
      ${q.tempoS} segundos para cada uma e <b>uma resposta só</b>. Acertou: +${pts(q.pontos)} pontos.</p></section>`;
    const hist = q.historico.length ? `<h2 class="titulo-secao">Perguntas anteriores</h2><div class="lista">${q.historico.map((h) => `
      <div class="quiz-hist ${h.acertei ? 'acertou' : 'errou'}"><span>${h.acertei ? '✓' : '✗'}</span>
        <div><b>${h.ordem}. ${esc(h.texto)}</b><small>Certa: ${LETRAS[h.correta]} · ${esc(h.opcoes[h.correta])}</small></div></div>`).join('')}</div>` : '';
    const placar = q.historico.length || (x && x.fase === 'revelada') ? `<p class="quiz-placar">Você acertou <b>${q.acertos}</b> · +${pts(q.acertos * q.pontos)} pontos</p>` : '';
    pintar('quiz', `${seloTeste(q)}${x && x.fase !== 'nao-lancada' ? cartaoAtual(q, x) : espera}${placar}${hist}`);
    vigiarQuiz();
    avisarPerguntaNova();
  }

  function vigiarQuiz() {
    clearInterval(relogioQuiz);
    const x = quiz && quiz.atual;
    if (!x || x.fase !== 'respondendo') return;
    let virou = false;
    relogioQuiz = setInterval(() => {
      const r = resta(x.fimEm);
      const seg = document.querySelector('[data-quiz-seg]');
      if (seg) { seg.textContent = `${r}s`; seg.classList.toggle('acabando', r <= 5); }
      const barra = document.querySelector('[data-quiz-barra]');
      if (barra) barra.style.width = `${Math.max(0, Math.min(100, ((x.fimEm - PV.relogio.agora()) / (quiz.tempoS * 1000)) * 100))}%`;
      if (r <= 0 && !virou) {
        virou = true;
        clearInterval(relogioQuiz);
        x.fase = 'tempo-esgotado';
        assinaturas.quiz = null;
        desenharQuiz(quiz);
        setTimeout(() => C().recarregar(), 1500);
      }
    }, 200);
  }

  // Pergunta valendo e a pessoa em outra tela: faixa no topo levando para o quiz.
  function avisarPerguntaNova() {
    const x = quiz && quiz.atual;
    let faixa = $('faixa-quiz');
    const precisa = x && x.fase === 'respondendo' && x.minha === null && resta(x.fimEm) > 0 && !telaAberta('tela-quiz');
    if (!precisa) { if (faixa) faixa.classList.add('oculto'); return; }
    if (!faixa) {
      faixa = document.createElement('a');
      faixa.id = 'faixa-quiz';
      faixa.className = 'faixa-quiz';
      faixa.href = '#quiz';
      document.body.appendChild(faixa);
    }
    faixa.innerHTML = `⚡ <b>Pergunta ${x.ordem} do Quiz valendo!</b> Toque para responder`;
    faixa.classList.remove('oculto');
    if (avisadoDe !== x.id && navigator.vibrate) { try { navigator.vibrate(150); } catch (_) { /* opcional */ } }
    avisadoDe = x.id;
  }
  document.addEventListener('pv:tela', () => avisarPerguntaNova());

  $('quiz').addEventListener('click', async (e) => {
    const op = e.target.closest('[data-quiz-op]');
    if (op) { escolhaQuiz = Number(op.dataset.quizOp); assinaturas.quiz = null; desenharQuiz(quiz); return; }
    const conf = e.target.closest('[data-quiz-confirmar]');
    if (!conf || conf.disabled || enviandoQuiz || escolhaQuiz === null) return;
    const x = quiz.atual;
    enviandoQuiz = true;
    conf.disabled = true;
    conf.textContent = 'Enviando…';
    try {
      const r = await C().api('POST', `/api/quiz/${encodeURIComponent(x.id)}/resposta`, { escolha: escolhaQuiz });
      C().atualizarParte('quiz', r.quiz);
      PV.avisar('Resposta registrada ✓', 'ok');
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
      C().recarregar();
    } finally {
      enviandoQuiz = false;
    }
  });

  // ============================================================== CONCURSO
  let concurso = null;
  let votando = false;

  function desenharConcurso(c) {
    concurso = c;
    if (!c) return;
    const premios = `1º +${pts(c.premios[0])} · 2º +${pts(c.premios[1])} · 3º +${pts(c.premios[2])}`;
    const meu = c.meuVoto ? c.candidatos.find((x) => x.id === c.meuVoto) : null;
    let topo;
    if (c.estado === 'fechado') {
      topo = `<section class="cartao"><b>🔒 A votação abre durante a festa</b><p class="mudo">Capriche na fantasia. Os três mais votados ganham: ${premios} pontos.</p></section>`;
    } else if (c.estado === 'aberto') {
      topo = `<section class="cartao prev-aviso aberta"><b>Votação aberta</b><p class="mudo">Vote na melhor fantasia da noite (não vale votar em você).
        Dá para trocar o voto até fechar. Ninguém vê em quem você votou. Prêmios: ${premios}.</p>
        ${meu ? `<p>Seu voto: <span class="avatar mini">${emoji(meu.avatar)}</span> <b>${esc(meu.nome)}</b></p>` : '<p><b>Você ainda não votou.</b></p>'}</section>`;
    } else if (c.estado === 'encerrado') {
      topo = `<section class="cartao"><b>🔒 Votação encerrada</b><p class="mudo">O resultado sai no telão.${meu ? ` Você votou em ${esc(meu.nome)}.` : ''}</p></section>`;
    } else {
      topo = `<section class="cartao"><b>🏆 Resultado</b><div class="podio-celular">${(c.podio || []).map((p) => `
        <div class="podio-linha"><span class="podio-pos">${['🥇', '🥈', '🥉'][p.posicao - 1] || `${p.posicao}º`}</span><span class="avatar">${emoji(p.avatar)}</span>
          <span class="podio-nome">${esc(p.nome)}<small>${p.votos} ${p.votos === 1 ? 'voto' : 'votos'}</small></span><b>+${pts(p.pontos)}</b></div>`).join('') || '<p class="fraco">Ninguém recebeu voto.</p>'}</div></section>`;
    }
    const lista = c.estado === 'aberto' ? `<input id="concurso-busca" type="search" placeholder="Buscar nome" autocomplete="off" aria-label="Buscar pessoa">
      <div class="pessoas-lista concurso-lista" id="concurso-lista"></div>` : '';
    pintar('concurso', `${seloTeste(c)}${topo}${lista}`);
    listarCandidatos();
  }
  function listarCandidatos() {
    const el = $('concurso-lista');
    if (!el || !concurso) return;
    const busca = $('concurso-busca');
    const termo = (busca ? busca.value : '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const lista = concurso.candidatos.filter((x) => !termo || x.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(termo));
    el.innerHTML = lista.map((x) => `<button type="button" class="pessoa-opcao ${concurso.meuVoto === x.id ? 'minha' : ''}" data-votar-em="${esc(x.id)}" ${x.souEu ? 'disabled' : ''}>
      <span class="avatar">${emoji(x.avatar)}</span><span>${esc(x.nome)}${x.souEu ? ' <em>(você)</em>' : ''}</span>
      ${concurso.meuVoto === x.id ? '<span class="trocar">seu voto ✓</span>' : ''}</button>`).join('') || '<p class="fraco">Ninguém com esse nome.</p>';
  }
  $('concurso').addEventListener('input', (e) => { if (e.target.id === 'concurso-busca') listarCandidatos(); });
  $('concurso').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-votar-em]');
    if (!b || b.disabled || votando) return;
    if (concurso.meuVoto === b.dataset.votarEm) return;
    votando = true;
    const antes = concurso.meuVoto;
    concurso.meuVoto = b.dataset.votarEm; // mostra na hora
    listarCandidatos();
    try {
      const r = await C().api('PUT', '/api/concurso/voto', { candidato: b.dataset.votarEm });
      assinaturas.concurso = null;
      C().atualizarParte('concurso', r.concurso);
      PV.avisar('Voto registrado 👑', 'ok');
    } catch (erro) {
      concurso.meuVoto = antes;
      listarCandidatos();
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
      if (erro.status === 409) C().recarregar();
    } finally {
      votando = false;
    }
  });

  // ============================================================== CORREIO
  let correio = null;
  let mandando = false;
  const ESTADOS_CARTA = { pendente: ['Aguardando o organizador', 'pendente'], aprovada: ['No telão ✓', 'ok'], recusada: ['Não aprovada', 'off'] };

  function montarCorreio() {
    if ($('form-correio')) return;
    $('correio').innerHTML = `<div id="correio-teste"></div>
      <form id="form-correio" class="cartao">
        <p class="mudo" style="margin-top:0">Escreva uma carta anônima. Ninguém da festa sabe quem mandou; só o organizador vê, para aprovar antes de ir para o telão.</p>
        <label for="correio-para">Para (opcional)</label>
        <select id="correio-para"><option value="">Ninguém em especial</option></select>
        <label for="correio-texto">Sua carta</label>
        <textarea id="correio-texto" rows="3" maxlength="140" placeholder="Ex.: Para o vampiro de capa: sua fantasia me deu medo de verdade." required></textarea>
        <p class="fraco correio-conta" id="correio-conta">0/140</p>
        <button class="botao largo" type="submit" id="correio-enviar">Mandar carta ✉️</button>
      </form>
      <h2 class="titulo-secao">Suas cartas</h2><div id="correio-minhas" class="lista"></div>`;
    $('correio-texto').addEventListener('input', () => { $('correio-conta').textContent = `${$('correio-texto').value.length}/140`; });
    $('form-correio').addEventListener('submit', enviarCarta);
  }

  function desenharCorreio(k) {
    correio = k;
    if (!k) return;
    montarCorreio();
    pintar('correio-teste', seloTeste(k));
    const sel = $('correio-para');
    const opcoes = `<option value="">Ninguém em especial</option>${k.pessoas.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('')}`;
    if (assinaturas.correioPara !== opcoes && document.activeElement !== sel) {
      const atual = sel.value;
      sel.innerHTML = opcoes;
      sel.value = k.pessoas.some((p) => p.id === atual) ? atual : '';
      assinaturas.correioPara = opcoes;
    }
    const acabou = k.enviadas >= k.limite;
    $('correio-enviar').disabled = acabou || mandando;
    if (acabou) $('correio-enviar').textContent = `Você já mandou ${k.limite} cartas`;
    pintar('correio-minhas', k.minhas.length ? k.minhas.map((m) => {
      const [rotulo, selo] = ESTADOS_CARTA[m.estado] || ['', ''];
      return `<div class="item carta"><div class="item-sub">${m.para ? `Para ${esc(m.para)} · ` : ''}${esc(PV.dataCurta(m.em))} <span class="selo ${selo}">${rotulo}</span></div>
        <p class="carta-texto">${esc(m.texto)}</p></div>`;
    }).join('') : '<p class="fraco">Nenhuma carta ainda.</p>');
  }

  async function enviarCarta(e) {
    e.preventDefault();
    if (mandando) return;
    const texto = $('correio-texto').value.trim();
    if (texto.length < 3) return PV.avisar('Escreva a sua carta.', 'erro');
    mandando = true;
    $('correio-enviar').disabled = true;
    try {
      const r = await C().api('POST', '/api/correio', { texto, para: $('correio-para').value || null });
      $('correio-texto').value = '';
      $('correio-conta').textContent = '0/140';
      PV.avisar('Carta enviada! Ela aparece no telão depois que o organizador aprovar. ✉️', 'ok');
      C().atualizarParte('correio', r.correio);
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
    } finally {
      mandando = false;
      if (correio) $('correio-enviar').disabled = correio.enviadas >= correio.limite;
    }
    return null;
  }

  // ================================================================= cards
  function desenhar(estado) {
    desenharQuiz(estado.quiz);
    desenharConcurso(estado.concurso);
    desenharCorreio(estado.correio);
  }

  window.PVFesta = { desenhar };
  // convidado.js chama PVJogos.desenhar; encadeia o desenho dos jogos da festa logo depois.
  const original = window.PVJogos && window.PVJogos.desenhar;
  if (window.PVJogos && original) {
    window.PVJogos.desenhar = (estado) => { original(estado); desenhar(estado); };
  }
})();
