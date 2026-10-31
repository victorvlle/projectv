// Jogos da festa no celular: Quiz Relâmpago, Concurso de Fantasia e Mural das Trevas.
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
  // Estilo Kahoot: sala de espera → o organizador inicia → as perguntas andam sozinhas pelo relógio
  // do servidor. A cada troca de fase o celular busca o estado de novo (a resposta certa e as
  // próximas perguntas nunca chegam antes da hora).
  let quiz = null;
  let escolhaQuiz = null; // opção tocada, ainda não confirmada
  let relogioQuiz = null;
  let proximaBusca = null;
  let pollSala = null;
  let enviandoQuiz = false;
  let avisadoDe = null;

  const resta = (fimEm) => Math.max(0, Math.ceil((fimEm - PV.relogio.agora()) / 1000));

  async function buscarQuiz() {
    try {
      const r = await C().api('GET', '/api/quiz');
      C().atualizarParte('quiz', r.quiz);
    } catch (_) { /* tenta na próxima */ }
  }

  function telaQuiz(q) {
    const salaTxt = `<p class="quiz-sala-conta">👥 <b>${q.naSalaTotal}</b> ${q.naSalaTotal === 1 ? 'pessoa' : 'pessoas'} na sala</p>`;
    const entrar = `<button class="botao largo quiz-entrar" type="button" data-quiz-entrar>Entrar na sala ⚡</button>`;
    const regras = `<p class="mudo">${q.total} perguntas no telão, ${q.tempoS} segundos cada, <b>uma resposta só</b>.
      Acertou: até +${pts(q.pontos)} pontos. <b>Quanto mais rápido, mais pontos.</b></p>`;
    if (q.fase === 'sala') {
      return q.naSala
        ? `<section class="cartao quiz-cartao registrada"><p class="quiz-veredito">Você está na sala ✓</p>
            <p>Seu monstro já está no telão. Agora é esperar o organizador começar.</p>${salaTxt}${regras}</section>`
        : `<section class="cartao quiz-cartao valendo"><p class="quiz-veredito">⚡ Quiz Relâmpago</p>${regras}${entrar}${salaTxt}</section>`;
    }
    if (q.fase === 'preparar') {
      return `<section class="cartao quiz-cartao valendo"><p class="quiz-num">Prepare-se!</p>
        <div class="quiz-contagem" data-quiz-seg>${resta(q.fimEm)}</div><p>A primeira pergunta já vai aparecer no telão e aqui.</p>
        ${q.naSala ? '' : entrar}</section>`;
    }
    if (q.pausado && q.fase !== 'fim') {
      return `<section class="cartao quiz-cartao registrada"><p class="quiz-veredito">⏸️ Quiz pausado</p>
        <p>A Maldição despertou! Olhe o telão. O quiz continua de onde parou assim que ela terminar${q.restaMs ? `, com ${Math.ceil(q.restaMs / 1000)} s para esta fase` : ''}.</p></section>`;
    }
    if (q.fase === 'fim') {
      return `<section class="cartao quiz-cartao acertou"><p class="quiz-veredito">🏁 Fim do quiz!</p>
        <p>Você acertou <b>${q.acertos || 0} de ${q.total}</b> · +${pts(q.pontosQuiz || 0)} pontos</p>
        ${(q.placar || []).length ? `<h2 class="titulo-secao" style="margin-top:14px">Quem mais acertou</h2><div class="podio-celular">${q.placar.map((p) => `
          <div class="podio-linha"><span class="podio-pos">${['🥇', '🥈', '🥉'][p.posicao - 1] || `${p.posicao}º`}</span><span class="avatar">${emoji(p.avatar)}</span>
          <span class="podio-nome">${esc(p.nome)}<small>${p.acertos} ${p.acertos === 1 ? 'acerto' : 'acertos'}</small></span><b>+${pts(p.pontos)}</b></div>`).join('')}</div>` : ''}</section>`;
    }
    const x = q.atual;
    const cab = `<p class="quiz-num">Pergunta ${x.numero} de ${q.total}</p><h2 class="quiz-pergunta">${esc(x.texto)}</h2>`;
    const minha = x.minha !== null ? `<b>${LETRAS[x.minha]}</b> · ${esc(x.opcoes[x.minha])}` : null;
    if (q.fase === 'revelacao') {
      const certa = `<b>${LETRAS[x.correta]}</b> · ${esc(x.opcoes[x.correta])}`;
      return `<section class="cartao quiz-cartao ${x.acertei ? 'acertou' : 'errou'}">${cab}
        <p class="quiz-veredito">${x.acertei ? `✓ Você acertou em ${x.segundos} s! +${pts(x.ganhou)}` : x.minha === null ? 'Você não respondeu esta.' : '✗ Não foi dessa vez.'}</p>
        <p>Resposta certa: ${certa}</p>${minha && !x.acertei ? `<p class="fraco">Sua resposta: ${minha}</p>` : ''}
        <p class="fraco">${q.proxima ? 'Próxima pergunta em' : 'Resultado final em'} <span data-quiz-seg>${resta(q.fimEm)}</span>s · você acertou ${q.acertos || 0} até agora</p></section>`;
    }
    if (x.minha === null && resta(q.fimEm) > 0) {
      const ops = x.opcoes.map((o, i) => `<button type="button" class="quiz-opcao op${i} ${escolhaQuiz === i ? 'escolhida' : ''}" data-quiz-op="${i}"
          aria-pressed="${escolhaQuiz === i}"><b>${LETRAS[i]}</b><span>${esc(o)}</span></button>`).join('');
      return `<section class="cartao quiz-cartao valendo">${cab}
        <div class="quiz-tempo"><i data-quiz-barra style="width:100%"></i></div><p class="quiz-seg" data-quiz-seg>${resta(q.fimEm)}s</p>
        <div class="quiz-opcoes">${ops}</div>
        <button class="botao largo" type="button" data-quiz-confirmar ${escolhaQuiz === null ? 'disabled' : ''}>
          ${escolhaQuiz === null ? 'Toque numa opção' : `Confirmar ${LETRAS[escolhaQuiz]}`}</button>
        <p class="fraco quiz-regra">Uma chance só: depois de confirmar, não dá para trocar. Quanto mais rápido, mais pontos.</p></section>`;
    }
    return `<section class="cartao quiz-cartao registrada">${cab}
      <p class="quiz-veredito">${minha ? 'Resposta registrada ✓' : '⏱️ Tempo esgotado'}</p><p>${minha || 'Você não respondeu a tempo.'}</p>
      <p class="quiz-seg" data-quiz-seg>${resta(q.fimEm)}s</p><p class="fraco">A resposta certa aparece quando o tempo acabar.</p></section>`;
  }

  function desenharQuiz(q) {
    quiz = q;
    clearTimeout(proximaBusca);
    clearInterval(relogioQuiz);
    clearInterval(pollSala);
    if (!q) { const f = $('faixa-quiz'); if (f) f.classList.add('oculto'); return; }
    const chave = q.atual ? `${q.fase}:${q.atual.id}` : q.fase;
    if (chave !== desenharQuiz.ultima) { escolhaQuiz = null; desenharQuiz.ultima = chave; }
    pintar('quiz', `${seloTeste(q)}${telaQuiz(q)}`);
    // Pausado pela Maldição: sem contagem; confere de tempos em tempos se já voltou.
    if (q.pausado && q.fase !== 'fim') { proximaBusca = setTimeout(buscarQuiz, 3000); avisarPerguntaNova(); return; }
    // Troca de fase: busca de novo um pouco depois do fim da fase atual.
    if (q.fimEm) proximaBusca = setTimeout(buscarQuiz, Math.max(300, q.fimEm - PV.relogio.agora() + 400));
    // Na sala, a contagem de gente vai atualizando enquanto a tela está aberta.
    if (q.fase === 'sala') pollSala = setInterval(() => { if (telaAberta('tela-quiz') && !document.hidden) buscarQuiz(); }, 4000);
    if (q.fimEm) {
      relogioQuiz = setInterval(() => {
        const r = resta(q.fimEm);
        document.querySelectorAll('[data-quiz-seg]').forEach((el) => {
          el.textContent = el.classList.contains('quiz-seg') ? `${r}s` : `${r}`;
          el.classList.toggle('acabando', r <= 5);
        });
        const barra = document.querySelector('[data-quiz-barra]');
        if (barra) barra.style.width = `${Math.max(0, Math.min(100, ((q.fimEm - PV.relogio.agora()) / (q.tempoS * 1000)) * 100))}%`;
        if (r <= 0) clearInterval(relogioQuiz);
      }, 200);
    }
    avisarPerguntaNova();
  }

  // Quiz começando ou pergunta valendo e a pessoa em outra tela: faixa no topo levando para o quiz.
  function avisarPerguntaNova() {
    const q = quiz;
    let faixa = $('faixa-quiz');
    const valendo = q && !q.pausado && q.fase === 'pergunta' && q.atual && q.atual.minha === null && resta(q.fimEm) > 0;
    const comecando = q && q.fase === 'preparar';
    const precisa = (valendo || comecando) && !telaAberta('tela-quiz');
    if (!precisa) { if (faixa) faixa.classList.add('oculto'); return; }
    if (!faixa) {
      faixa = document.createElement('a');
      faixa.id = 'faixa-quiz';
      faixa.className = 'faixa-quiz';
      faixa.href = '#quiz';
      document.body.appendChild(faixa);
    }
    faixa.innerHTML = comecando ? '⚡ <b>O Quiz vai começar!</b> Toque para jogar' : `⚡ <b>Pergunta ${q.atual.numero} do Quiz valendo!</b> Toque para responder`;
    faixa.classList.remove('oculto');
    const marca = comecando ? 'inicio' : q.atual.id;
    if (avisadoDe !== marca && navigator.vibrate) { try { navigator.vibrate(150); } catch (_) { /* opcional */ } }
    avisadoDe = marca;
  }
  document.addEventListener('pv:tela', (e) => { avisarPerguntaNova(); if (e.detail === 'tela-quiz' && quiz) buscarQuiz(); });

  $('quiz').addEventListener('click', async (e) => {
    const ent = e.target.closest('[data-quiz-entrar]');
    if (ent && !ent.disabled) {
      ent.disabled = true;
      try {
        const r = await C().api('POST', '/api/quiz/entrar');
        C().atualizarParte('quiz', r.quiz);
        PV.avisar('Você entrou na sala ⚡', 'ok');
      } catch (erro) { ent.disabled = false; if (erro.status !== 401) PV.avisar(erro.message, 'erro'); }
      return;
    }
    const op = e.target.closest('[data-quiz-op]');
    if (op) { escolhaQuiz = Number(op.dataset.quizOp); desenharQuiz(quiz); return; }
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
      buscarQuiz();
    } finally {
      enviandoQuiz = false;
    }
  });

  // ============================================================== CONCURSO
  let concurso = null;
  let votando = false;

  let concursoRevela = null;
  function desenharConcurso(c) {
    concurso = c;
    if (!c) return;
    const premios = `1º +${pts(c.premios[0])} · 2º +${pts(c.premios[1])} · 3º +${pts(c.premios[2])}`;
    const meu = c.meuVoto ? c.candidatos.find((x) => x.id === c.meuVoto) : null;
    let topo;
    const quantos = `<p class="quiz-sala-conta">👑 <b>${c.desfilantes}</b> ${c.desfilantes === 1 ? 'pessoa vai' : 'pessoas vão'} desfilar</p>`;
    const botaoDesfile = c.vouDesfilar
      ? `<p class="quiz-veredito" style="margin-top:12px">✓ Você vai desfilar!</p>
         <button class="botao-discreto" type="button" data-desfilar="0">Desistir de desfilar</button>`
      : '<button class="botao largo quiz-entrar" type="button" data-desfilar="1">Quero desfilar! 👑</button>';
    if (c.estado === 'desfile') {
      topo = `<section class="cartao prev-aviso aberta"><b>🎭 Hora do Desfile Macabro!</b><p class="mudo">${c.vouDesfilar ? 'Entre na fila e desfile a sua fantasia.' : 'Ainda dá tempo de entrar na fila.'}
        Só quem desfila concorre. Logo depois do desfile a votação abre aqui no celular. Prêmios: ${premios}.</p>${botaoDesfile}${quantos}</section>`;
    } else if (c.estado === 'fechado') {
      topo = `<section class="cartao"><b>👑 Concurso de Fantasia</b><p class="mudo">Quer concorrer? Toque em <b>Quero desfilar!</b>: na hora do desfile você entra na fila,
        e na votação só aparece quem desfilou. Os três mais votados ganham ${premios} pontos.</p>${botaoDesfile}${quantos}</section>`;
    } else if (c.estado === 'aberto') {
      topo = `<section class="cartao prev-aviso aberta"><b>Votação aberta</b><p class="mudo">Vote na melhor fantasia da noite (não vale votar em você).
        Dá para trocar o voto até fechar. Ninguém vê em quem você votou. Prêmios: ${premios}.</p>
        ${meu ? `<p>Seu voto: <span class="avatar mini">${emoji(meu.avatar)}</span> <b>${esc(meu.nome)}</b></p>` : '<p><b>Você ainda não votou.</b></p>'}</section>`;
    } else if (c.estado === 'encerrado') {
      topo = `<section class="cartao"><b>${c.revelaEm ? '🥁 Olhe o telão!' : '🔒 Votação encerrada'}</b><p class="mudo">${c.revelaEm ? 'O resultado está sendo revelado agora.' : 'O resultado sai no telão.'}${meu ? ` Você votou em ${esc(meu.nome)}.` : ''}</p></section>`;
      clearTimeout(concursoRevela);
      if (c.revelaEm && C().recarregar) concursoRevela = setTimeout(C().recarregar, Math.max(800, c.revelaEm - PV.relogio.agora() + 800));
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
    const d = e.target.closest('[data-desfilar]');
    if (d && !d.disabled) {
      d.disabled = true;
      try {
        const r = await C().api('PUT', '/api/concurso/desfilar', { quero: d.dataset.desfilar === '1' });
        C().atualizarParte('concurso', r.concurso);
        PV.avisar(d.dataset.desfilar === '1' ? 'Você está na lista do desfile! 👑' : 'Você saiu da lista do desfile.', 'ok');
      } catch (erro) { d.disabled = false; if (erro.status !== 401) PV.avisar(erro.message, 'erro'); }
      return;
    }
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

  // ======================================================= MURAL DAS TREVAS
  // Recado OU foto (com legenda opcional). A foto é tirada na hora (o botão abre a câmera, sem galeria). A foto é reduzida aqui no celular (lado maior até
  // 1600 px, JPEG) antes de subir: fica leve e perde os dados escondidos da câmera (como local).
  let correio = null;
  let mandando = false;
  let fotoEscolhida = null; // data URL JPEG já reduzida
  const ESTADOS_CARTA = { pendente: ['Aguardando o organizador', 'pendente'], aprovada: ['No telão ✓', 'ok'], recusada: ['Não aprovado', 'off'] };
  const MAX_FOTO = 850 * 1024;

  function carregarImagem(arquivo) {
    return new Promise((ok, falha) => {
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = () => { ok(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('imagem')); };
      img.src = url;
    });
  }
  const paraBlob = (canvas, q) => new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', q));
  const lerDataUrl = (blob) => new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = falha; r.readAsDataURL(blob); });

  async function reduzirFoto(arquivo) {
    const img = await carregarImagem(arquivo);
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error('imagem');
    for (const lado of [1600, 1280, 1000]) {
      const k = Math.min(1, lado / Math.max(w0, h0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w0 * k);
      canvas.height = Math.round(h0 * k);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of [0.82, 0.7, 0.58]) {
        const blob = await paraBlob(canvas, q);
        if (blob && blob.size <= MAX_FOTO) return lerDataUrl(blob);
      }
    }
    throw new Error('grande');
  }

  function mostrarFotoEscolhida() {
    const tem = Boolean(fotoEscolhida);
    $('mural-previa').classList.toggle('oculto', !tem);
    if (tem) $('mural-previa-img').src = fotoEscolhida;
    $('mural-foto-botao').textContent = tem ? '📷 Tirar outra' : '📷 Tirar foto';
    $('correio-rotulo').textContent = tem ? 'Legenda (opcional)' : 'Seu recado';
    $('correio-texto').placeholder = tem ? 'Ex.: O trio mais assustador da noite 🎃' : 'Ex.: Para o vampiro de capa: sua fantasia me deu medo de verdade.';
    $('correio-enviar').textContent = tem ? 'Mandar foto para o mural 📸' : 'Mandar recado para o mural ✉️';
  }

  function montarCorreio() {
    if ($('form-correio')) return;
    $('correio').innerHTML = `<div id="correio-teste"></div>
      <form id="form-correio" class="cartao">
        <p class="mudo" style="margin-top:0" id="mural-intro"></p>
        <p class="mural-aviso">⚠️ Nada ofensivo ou constrangedor, e nada que exponha alguém sem querer. O organizador apaga o que passar do ponto.</p>
        <!-- capture: abre direto a câmera traseira (sem galeria) no iPhone e no Android; o computador ignora. -->
        <input type="file" id="mural-arquivo" accept="image/*" capture="environment" class="oculto">
        <button class="botao secundario largo" type="button" id="mural-foto-botao">📷 Tirar foto</button>
        <div id="mural-previa" class="mural-previa oculto">
          <img id="mural-previa-img" alt="Foto escolhida">
          <button class="botao secundario pequeno" type="button" id="mural-tirar">Descartar</button>
        </div>
        <label for="correio-para">Para (opcional)</label>
        <select id="correio-para"><option value="">Ninguém em especial</option></select>
        <label for="correio-texto" id="correio-rotulo">Seu recado</label>
        <textarea id="correio-texto" rows="3" maxlength="140" placeholder="Ex.: Para o vampiro de capa: sua fantasia me deu medo de verdade."></textarea>
        <p class="fraco correio-conta" id="correio-conta">0/140</p>
        <button class="botao largo" type="submit" id="correio-enviar">Mandar recado para o mural ✉️</button>
      </form>
      <h2 class="titulo-secao">O que você mandou</h2><div id="correio-minhas" class="lista"></div>`;
    $('correio-texto').addEventListener('input', () => { $('correio-conta').textContent = `${$('correio-texto').value.length}/140`; });
    $('mural-foto-botao').addEventListener('click', () => $('mural-arquivo').click());
    $('mural-tirar').addEventListener('click', () => { fotoEscolhida = null; $('mural-arquivo').value = ''; mostrarFotoEscolhida(); });
    $('mural-arquivo').addEventListener('change', async () => {
      const arquivo = $('mural-arquivo').files[0];
      if (!arquivo) return;
      $('mural-foto-botao').disabled = true;
      $('mural-foto-botao').textContent = 'Preparando a foto…';
      try {
        fotoEscolhida = await reduzirFoto(arquivo);
      } catch (_) {
        fotoEscolhida = null;
        PV.avisar('Não consegui usar essa foto. Tente tirar de novo.', 'erro');
      } finally {
        $('mural-foto-botao').disabled = false;
        mostrarFotoEscolhida();
      }
    });
    $('form-correio').addEventListener('submit', enviarCarta);
  }

  function desenharCorreio(k) {
    correio = k;
    if (!k) return;
    montarCorreio();
    pintar('correio-teste', seloTeste(k));
    pintar('mural-intro', k.auto
      ? 'Mande um recado ou uma foto da festa: aparece no telão na hora, sem o seu nome. Só o organizador sabe quem mandou.'
      : 'Mande um recado ou uma foto da festa. É anônimo: só o organizador sabe quem mandou, e ele aprova antes de ir para o telão.');
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
    if (acabou) $('correio-enviar').textContent = `Você já mandou ${k.limite} vezes`;
    pintar('correio-minhas', k.minhas.length ? k.minhas.map((m) => {
      const [rotulo, selo] = ESTADOS_CARTA[m.estado] || ['', ''];
      return `<div class="item carta"><div class="item-sub">${m.para ? `Para ${esc(m.para)} · ` : ''}${esc(PV.dataCurta(m.em))} <span class="selo ${selo}">${rotulo}</span></div>
        ${m.foto ? `<img class="carta-foto" data-foto="/api/correio/foto/${m.id}" alt="Sua foto">` : ''}
        ${m.texto ? `<p class="carta-texto">${esc(m.texto)}</p>` : ''}</div>`;
    }).join('') : '<p class="fraco">Nada ainda.</p>');
    PV.preencherFotos($('correio-minhas'), C().token());
  }

  async function enviarCarta(e) {
    e.preventDefault();
    if (mandando) return;
    const texto = $('correio-texto').value.trim();
    if (!fotoEscolhida && texto.length < 3) return PV.avisar('Escreva um recado ou escolha uma foto.', 'erro');
    mandando = true;
    $('correio-enviar').disabled = true;
    const eraFoto = Boolean(fotoEscolhida);
    if (eraFoto) $('correio-enviar').textContent = 'Enviando a foto…';
    try {
      const r = await C().api('POST', '/api/correio', { texto, para: $('correio-para').value || null, foto: fotoEscolhida || undefined });
      $('correio-texto').value = '';
      $('correio-conta').textContent = '0/140';
      fotoEscolhida = null;
      $('mural-arquivo').value = '';
      const auto = r.correio && r.correio.auto;
      PV.avisar(`${eraFoto ? 'Foto enviada' : 'Recado enviado'}! ${auto ? 'Já está no telão. 👻' : 'Aparece no telão depois que o organizador aprovar.'}`, 'ok');
      C().atualizarParte('correio', r.correio);
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.status === 413 ? 'A foto ficou grande demais. Tente outra.' : erro.message, 'erro');
    } finally {
      mandando = false;
      mostrarFotoEscolhida();
      if (correio) {
        const acabou = correio.enviadas >= correio.limite;
        $('correio-enviar').disabled = acabou;
        if (acabou) $('correio-enviar').textContent = `Você já mandou ${correio.limite} vezes`;
      }
    }
    return null;
  }

  // ============================================================ BEER PONG
  let mexendoBp = false;
  let bpRevela = null;
  function desenharBeerpong(b) {
    clearTimeout(bpRevela);
    if (!b) return;
    const premios = `Campeões +${pts(b.premios.campeao)} cada · vice +${pts(b.premios.vice)} cada.`;
    let html;
    if (b.estado === 'inscricao') {
      html = `<section class="cartao"><b>🍺 Beer Pong em trios</b><p class="mudo">Inscreva-se: os times de 3 são sorteados no telão e o mata-mata decide.
        Em cada jogo, um de cada time joga por vez, em sequência. ${premios}</p>
        ${b.inscrito ? '<p class="quiz-veredito" style="margin-top:12px">✓ Você está inscrito</p><button class="botao-discreto" type="button" data-bp="0">Desistir</button>'
          : '<button class="botao largo quiz-entrar" type="button" data-bp="1">🍺 Quero jogar!</button>'}
        <p class="quiz-sala-conta">🍺 <b>${b.inscritos}</b> ${b.inscritos === 1 ? 'inscrito' : 'inscritos'}</p></section>`;
    } else if (b.estado === 'sorteando') {
      html = `<section class="cartao prev-aviso aberta"><b>🎲 Sorteio no telão!</b>
        <p>${b.inscrito ? 'Olhe o telão para descobrir o seu time e o seu adversário.' : 'Os times estão sendo sorteados no telão.'}</p></section>`;
      if (b.revelaEm && C().recarregar) bpRevela = setTimeout(C().recarregar, Math.max(800, b.revelaEm - PV.relogio.agora() + 800));
    } else if (b.meuTime) {
      const t = b.meuTime;
      let sit = '';
      if (b.resultado && (b.resultado.euCampeao || b.resultado.euVice)) sit = b.resultado.euCampeao ? `🏆 Vocês são os campeões! +${pts(b.premios.campeao)}` : `🥈 Vice-campeões! +${pts(b.premios.vice)}`;
      else if (b.situacao === 'jogar') sit = `${b.agora ? '🔥 É AGORA! ' : 'Próximo jogo: '}contra ${b.adversario ? `${b.adversario.emoji} ${esc(b.adversario.nome)}` : '?'} (${esc(b.rodadaNome || '')})`;
      else if (b.situacao === 'eliminado') sit = 'Vocês foram eliminados. Agora é torcer! 🍻';
      else sit = 'Aguardando o adversário… fiquem por perto da mesa.';
      html = `<section class="cartao prev-aviso aberta"><b>Seu time: ${t.emoji} ${esc(t.nome)}</b>
        <p>${t.membros.map((m) => `<span class="avatar mini">${emoji(m.avatar)}</span>${esc(m.nome)}`).join(' · ')}</p>
        <p class="quiz-veredito" style="margin-top:8px">${sit}</p></section>
        ${b.resultado && !(b.resultado.euCampeao || b.resultado.euVice) ? `<section class="cartao"><p>🏆 Campeões: <b>${esc(b.resultado.campeao)}</b> · vice: ${esc(b.resultado.vice)}</p></section>` : ''}
        <p class="fraco">A chave completa está no telão.</p>`;
    } else {
      html = `<section class="cartao"><b>🍺 Beer Pong</b><p class="mudo">Os times já foram sorteados. Acompanhe a chave no telão!</p>
        ${b.resultado ? `<p>🏆 Campeões: <b>${esc(b.resultado.campeao)}</b> · vice: ${esc(b.resultado.vice)}</p>` : ''}</section>`;
    }
    pintar('beerpong', `${seloTeste(b)}${html}`);
  }
  $('beerpong').addEventListener('click', async (e) => {
    const bt = e.target.closest('[data-bp]');
    if (!bt || mexendoBp) return;
    mexendoBp = true;
    try {
      const r = await C().api('PUT', '/api/beerpong/inscricao', { quero: bt.dataset.bp === '1' });
      C().atualizarParte('beerpong', r.beerpong);
      PV.avisar(bt.dataset.bp === '1' ? 'Inscrito! Fique de olho no sorteio no telão. 🍺' : 'Você saiu do Beer Pong.', 'ok');
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
      if (erro.status === 409) C().recarregar();
    } finally { mexendoBp = false; }
  });

  // ==================================================== CORRIDA DE CAVALOS
  const NAIPES = [['espadas', '♠', 'Espadas'], ['copas', '♥', 'Copas'], ['ouros', '♦', 'Ouros'], ['paus', '♣', 'Paus']];
  const nomeNaipe = (n) => (NAIPES.find((x) => x[0] === n) || [n, '', n])[2];
  const simbNaipe = (n) => (NAIPES.find((x) => x[0] === n) || [n, '?'])[1];
  let apostando = false;
  let corridaUltima = null;
  let corridaTimerCel = null;
  let corridaRelogioCel = null;
  let naipeEscolhido = null; // escolhido na tela, ainda não salvo
  function relogioApostas(c) {
    clearInterval(corridaRelogioCel);
    const tique = () => {
      const ms = Math.max(0, (c.fechaEm || 0) - PV.relogio.agora());
      const seg = Math.ceil(ms / 1000);
      const el = $('corrida-seg');
      if (el) { el.textContent = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`; el.classList.toggle('acabando', seg <= 10); }
      if (ms <= 0) { clearInterval(corridaRelogioCel); setTimeout(() => C().recarregar(), 1200); }
    };
    tique();
    corridaRelogioCel = setInterval(tique, 250);
  }
  // A carta do cavalo escolhido, grande no centro (o Ás do naipe).
  const cartaGrande = (n, legenda) => `<div class="carta-cel-grande ${n === 'copas' || n === 'ouros' ? 'vermelho' : ''}" role="img" aria-label="Ás de ${nomeNaipe(n)}">
      <span class="ccg-canto">A<br>${simbNaipe(n)}</span><span class="ccg-naipe">${simbNaipe(n)}</span><span class="ccg-canto baixo">A<br>${simbNaipe(n)}</span></div>
    <p class="ccg-legenda">${legenda}</p>`;
  function desenharCorrida(c) {
    clearTimeout(corridaTimerCel);
    clearInterval(corridaRelogioCel);
    if (!c) return;
    const premios = `1º lugar +${pts(c.premios[0])} · 2º +${pts(c.premios[1])} · quem apostar no último toma um shot`;
    let html;
    if (c.estado === 'apostas') {
      if (c.minha) {
        naipeEscolhido = null;
        html = `<section class="cartao prev-aviso aberta" style="text-align:center"><b>✅ Você está confirmado!</b>
          ${cartaGrande(c.minha, `Seu cavalo: <b>${nomeNaipe(c.minha)}</b>`)}
          <p class="mudo">A corrida larga quando o tempo acabar. Olhe o telão!</p>
          <p class="corrida-relogio-cel">⏱️ <b id="corrida-seg">1:00</b></p></section>`;
      } else {
        html = `<section class="cartao prev-aviso aberta"><b>🎟️ Escolha seu cavalo e salve</b><p class="mudo">${premios}.</p>
          <p class="corrida-relogio-cel">⏱️ Fecha em <b id="corrida-seg">1:00</b></p></section>
          <div class="naipes-grade">${NAIPES.map(([n, sb, nome]) => `<button type="button" class="naipe-botao ${n === 'copas' || n === 'ouros' ? 'vermelho' : ''} ${naipeEscolhido === n ? 'meu' : ''}" data-naipe="${n}">
            <span class="naipe-carta"><small>A</small>${sb}</span><b>${nome}</b><span class="fraco">${c.contagem[n]} ${c.contagem[n] === 1 ? 'confirmado' : 'confirmados'}</span></button>`).join('')}</div>
          <button class="botao largo" type="button" data-salvar-naipe ${naipeEscolhido ? '' : 'disabled'} style="margin-top:12px">
            ${naipeEscolhido ? `Salvar: ${simbNaipe(naipeEscolhido)} ${nomeNaipe(naipeEscolhido)}` : 'Toque num cavalo'}</button>
          <p class="fraco">Depois de salvar, não dá para trocar.</p>`;
      }
    } else if (c.estado === 'correndo') {
      html = `<section class="cartao prev-aviso aberta" style="text-align:center"><b>🏁 Largaram! Olhe o telão.</b>
        ${c.minha ? cartaGrande(c.minha, `Torça pelo <b>${nomeNaipe(c.minha)}</b>!`) : '<p>Você não apostou nesta corrida.</p>'}</section>`;
      if (c.fimEm && C().recarregar) corridaTimerCel = setTimeout(C().recarregar, Math.max(800, c.fimEm - PV.relogio.agora() + 1200));
    } else if (c.estado === 'fim' && c.resultado) {
      const r = c.resultado;
      const meu = !c.minha ? 'Você não apostou nesta corrida.'
        : r.shot ? `🥃 Seu cavalo (${simbNaipe(c.minha)}) chegou em último: shot!`
          : r.pontos ? `🏆 Seu cavalo (${simbNaipe(c.minha)}) chegou em ${r.lugar}º: +${pts(r.pontos)}!` : `Seu cavalo (${simbNaipe(c.minha)}) chegou em ${r.lugar}º. Sem prêmio desta vez.`;
      html = `<section class="cartao"><b>Corrida ${c.rodada}: resultado</b>
        <div class="podio-celular">${r.ordem.map((n, i) => `<div class="podio-linha"><span class="podio-pos">${i + 1}º</span>
          <span class="naipe-texto ${n === 'copas' || n === 'ouros' ? 'vermelho' : ''}" style="font-size:1.6rem">${simbNaipe(n)}</span>
          <span class="podio-nome">${nomeNaipe(n)}</span><b>${i < c.premios.length ? `+${pts(c.premios[i])}` : r.ultimos.includes(n) ? '🥃' : ''}</b></div>`).join('')}</div>
        <p class="quiz-veredito" style="margin-top:10px">${meu}</p><p class="fraco">A próxima corrida abre quando o organizador chamar.</p></section>`;
    } else {
      html = `<section class="cartao"><b>🏇 Corrida de Cavalos</b><p class="mudo">Quando as apostas abrirem, você tem 1 minuto para escolher um naipe (♠ ♥ ♦ ♣) e salvar.
        Os Ases correm no telão e o baralho decide. ${premios}.</p></section>`;
    }
    pintar('corrida', `${seloTeste(c)}${html}`);
    if (c.estado === 'apostas') relogioApostas(c);
  }
  $('corrida').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-naipe]');
    if (b) { naipeEscolhido = b.dataset.naipe; desenharCorrida(corridaUltima); return; }
    const salvar = e.target.closest('[data-salvar-naipe]');
    if (!salvar || !naipeEscolhido || apostando) return;
    apostando = true;
    salvar.disabled = true;
    try {
      const r = await C().api('PUT', '/api/corrida/aposta', { naipe: naipeEscolhido });
      PV.avisar(`Confirmado: ${simbNaipe(naipeEscolhido)} ${nomeNaipe(naipeEscolhido)}! 🏇`, 'ok');
      naipeEscolhido = null;
      corridaUltima = r.corrida;
      C().atualizarParte('corrida', r.corrida);
    } catch (erro) {
      salvar.disabled = false;
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
      if (erro.status === 409) C().recarregar();
    } finally { apostando = false; }
  });

  // ============================================================ O MONSTRO
  // O papel fica escondido atrás de um botão (todo mundo vê o mesmo botão), para ninguém
  // descobrir o monstro olhando a tela do celular dele.
  let monstro = null;
  let papelVisivel = false;
  let mexendoMonstro = false;
  const pistasHtml = (m) => (m.pistas && m.pistas.length ? `<h2 class="titulo-secao">Pistas</h2><div class="lista">${m.pistas.map((p) =>
    `<div class="item carta"><p class="carta-texto">🔎 ${esc(p.texto)}</p></div>`).join('')}</div>` : '');

  function desenharMonstro(m) {
    monstro = m;
    if (!m) return;
    const premios = `Acertou o monstro: +${pts(m.premios.acerto)}. Monstro que escapa: +${pts(m.premios.escapou)} e +${pts(m.premios.porVitima)} por vítima.`;
    const conta = `<p class="quiz-sala-conta">🏘️ <b>${m.naVilaTotal}</b> ${m.naVilaTotal === 1 ? 'pessoa' : 'pessoas'} na vila</p>`;
    const entrar = m.naVila
      ? `<p class="quiz-veredito" style="margin-top:12px">✓ Você está na vila</p>${m.estado === 'aberta' || m.estado === 'revelada' ? '<button class="botao-discreto" type="button" data-vila="0">Sair da vila</button>' : ''}`
      : '<button class="botao largo quiz-entrar" type="button" data-vila="1">🏘️ Quero entrar na vila</button>';
    let html = '';
    if (m.estado === 'aberta') {
      html = `<section class="cartao"><b>Há um monstro entre vocês…</b><p class="mudo">Entre na vila para jogar. Quando a rodada começar, alguns de vocês viram
        <b>monstros</b> em segredo e precisam brindar com ${m.missao} pessoas sem serem descobertos. No fim, todos votam em quem acham que é o monstro.</p>
        <p class="fraco">${premios}</p>${entrar}${conta}</section>`;
    } else if (m.estado === 'jogando' || m.estado === 'votacao') {
      const cab = `<section class="cartao prev-aviso aberta"><b>${m.estado === 'votacao' ? '🗳️ Votação: quem é o monstro?' : `🐺 Rodada ${m.rodada}: ${m.qtdMonstros === 1 ? 'há 1 monstro' : `há ${m.qtdMonstros} monstros`} entre vocês`}</b>
        <p class="mudo">${m.estado === 'votacao' ? 'Vote em quem você acha que é monstro. Dá para trocar até a revelação.' : 'Fique de olho em quem anda brindando demais…'}</p></section>`;
      if (!m.jogo) {
        html = `${cab}<section class="cartao"><p class="mudo">Você não está na vila nesta rodada. Entre agora para jogar a próxima.</p>${entrar}</section>${pistasHtml(m)}`;
      } else {
        let papel;
        if (!papelVisivel) {
          papel = '<button class="botao largo secundario" type="button" data-papel="1">👁️ Ver meu papel (esconda a tela)</button>';
        } else if (m.souMonstro) {
          const feitas = m.vitimas.length;
          papel = `<section class="cartao monstro-papel sou-monstro"><b>🐺 Você é o Monstro</b>
            <p>Missão: brinde com <b>${m.missao}</b> pessoas da vila sem ser descoberto. Depois de cada brinde, marque aqui (ninguém é avisado).</p>
            ${m.comparsas && m.comparsas.length ? `<p class="mudo">Seus comparsas: <b>${m.comparsas.map(esc).join(', ')}</b></p>` : ''}
            <p class="quiz-sala-conta">🍷 <b>${feitas}</b> de ${m.missao} almas</p>
            ${m.estado === 'jogando' ? `<div class="pessoas-lista">${m.alvos.map((a) => {
              const marcado = m.vitimas.some((v) => v.id === a.id);
              return `<button type="button" class="pessoa-opcao ${marcado ? 'minha' : ''}" data-brinde="${esc(a.id)}" data-marcado="${marcado ? 1 : 0}">
                <span class="avatar">${emoji(a.avatar)}</span><span>${esc(a.nome)}</span>${marcado ? '<span class="trocar">brindou ✓</span>' : ''}</button>`;
            }).join('')}</div>` : '<p class="mudo">Brindes encerrados. Agora é torcer para não ser descoberto.</p>'}
            <button class="botao-discreto" type="button" data-papel="0">Esconder</button></section>`;
        } else {
          papel = `<section class="cartao monstro-papel"><b>🧑‍🌾 Você é aldeão</b>
            <p class="mudo">Você não é monstro. Observe quem anda brindando com todo mundo e use as pistas do telão.</p>
            <button class="botao-discreto" type="button" data-papel="0">Esconder</button></section>`;
        }
        let voto = '';
        if (m.estado === 'votacao' && m.suspeitos) {
          const meu = m.suspeitos.find((x) => x.id === m.meuVoto);
          voto = `<h2 class="titulo-secao">Seu voto</h2>${meu ? `<p>Você votou em <span class="avatar mini">${emoji(meu.avatar)}</span> <b>${esc(meu.nome)}</b></p>` : '<p><b>Você ainda não votou.</b></p>'}
            <div class="pessoas-lista">${m.suspeitos.map((x) => `<button type="button" class="pessoa-opcao ${m.meuVoto === x.id ? 'minha' : ''}" data-suspeito="${esc(x.id)}">
              <span class="avatar">${emoji(x.avatar)}</span><span>${esc(x.nome)}</span>${m.meuVoto === x.id ? '<span class="trocar">seu voto ✓</span>' : ''}</button>`).join('')}</div>`;
        }
        html = `${cab}${papel}${voto}${pistasHtml(m)}`;
      }
    } else if (m.estado === 'revelada' && m.resultado) {
      const r = m.resultado;
      const linhas = r.monstros.map((x) => `<div class="podio-linha"><span class="podio-pos">🐺</span><span class="avatar">${emoji(x.avatar)}</span>
        <span class="podio-nome">${esc(x.nome)}<small>${x.almas} ${x.almas === 1 ? 'alma' : 'almas'} · ${x.votos} ${x.votos === 1 ? 'voto' : 'votos'}</small></span>
        <b>${x.descoberto ? 'descoberto' : 'escapou'}</b></div>`).join('');
      const meu = r.eraMonstro
        ? (r.escapei ? '🐺 Você era monstro e escapou!' : '🐺 Você era monstro… e foi descoberto.')
        : (r.acertei ? `🎯 Você acertou! +${pts(m.premios.acerto)}` : (r.voteiEm ? `Você votou em ${esc(r.voteiEm)}. Não era.` : 'Você não votou nesta rodada.'));
      html = `<section class="cartao"><b>Rodada ${m.rodada}: ${r.monstros.length === 1 ? 'o monstro era…' : 'os monstros eram…'}</b><div class="podio-celular">${linhas}</div>
        <p class="quiz-veredito" style="margin-top:10px">${meu}</p><p class="fraco">${r.acertaram} ${r.acertaram === 1 ? 'pessoa acertou' : 'pessoas acertaram'}.</p></section>
        <section class="cartao"><p class="mudo">A próxima rodada começa quando o organizador chamar.</p>${entrar}${conta}</section>`;
    }
    pintar('monstro', `${seloTeste(m)}${html}`);
  }
  window.addEventListener('hashchange', () => { if (papelVisivel && location.hash !== '#monstro') { papelVisivel = false; if (monstro) desenharMonstro(monstro); } });
  $('monstro').addEventListener('click', async (e) => {
    const papel = e.target.closest('[data-papel]');
    if (papel) { papelVisivel = papel.dataset.papel === '1'; desenharMonstro(monstro); return; }
    const alvo = e.target.closest('[data-vila],[data-brinde],[data-suspeito]');
    if (!alvo || alvo.disabled || mexendoMonstro) return;
    mexendoMonstro = true;
    alvo.disabled = true;
    try {
      let r;
      if (alvo.dataset.vila) {
        r = await C().api('PUT', '/api/monstro/vila', { quero: alvo.dataset.vila === '1' });
        PV.avisar(alvo.dataset.vila === '1' ? 'Você entrou na vila. 🏘️' : 'Você saiu da vila.', 'ok');
      } else if (alvo.dataset.brinde) {
        const marcar = alvo.dataset.marcado !== '1';
        r = await C().api('PUT', '/api/monstro/brinde', { vitima: alvo.dataset.brinde, marcar });
        PV.avisar(marcar ? 'Alma marcada 🍷' : 'Brinde desmarcado.', 'ok');
      } else {
        r = await C().api('PUT', '/api/monstro/voto', { suspeito: alvo.dataset.suspeito });
        PV.avisar('Voto registrado 🗳️', 'ok');
      }
      C().atualizarParte('monstro', r.monstro);
    } catch (erro) {
      alvo.disabled = false;
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
      if (erro.status === 409) C().recarregar();
    } finally {
      mexendoMonstro = false;
    }
  });

  // ======================================================= FOTOS DA FESTA
  // Abre depois da festa: todas as fotos aprovadas do Mural, para ver e baixar.
  let fotos = [];
  let visorPos = 0;
  const urlFoto = (id) => `/api/correio/foto/${id}`;

  function desenharFotos(g) {
    if (!g) return;
    fotos = g.fotos;
    pintar('fotos', `${seloTeste(g)}
      <p class="mudo">${fotos.length ? `${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'} da noite de 31/10. Toque numa foto para ver grande e baixar.` : 'Nenhuma foto no mural.'}</p>
      ${fotos.length > 1 ? '<button class="botao largo" type="button" id="fotos-zip">⬇️ Baixar todas as fotos (.zip)</button>' : ''}
      <div class="galeria">${fotos.map((f, i) => `<button type="button" class="galeria-item" data-foto-pos="${i}" aria-label="Abrir foto ${i + 1}">
        <img data-foto="${urlFoto(f.id)}" alt="Foto ${i + 1}"></button>`).join('')}</div>`);
    PV.preencherFotos($('fotos'), C().token());
  }

  async function arquivoDaFoto(f, i) {
    const blob = await PV.fotoBlob(urlFoto(f.id), C().token());
    return new File([blob], `project-v-halloween-${String(i + 1).padStart(3, '0')}.jpg`, { type: 'image/jpeg' });
  }
  function baixarArquivo(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function baixarFoto(i) {
    const botao = $('visor-baixar');
    botao.disabled = true;
    try {
      const arq = await arquivoDaFoto(fotos[i], i);
      // No celular, "Compartilhar" deixa salvar direto na galeria (no iPhone: "Salvar imagem").
      if (navigator.canShare && navigator.canShare({ files: [arq] })) {
        try { await navigator.share({ files: [arq] }); } catch (e) { if (e.name !== 'AbortError') baixarArquivo(arq, arq.name); }
      } else baixarArquivo(arq, arq.name);
    } catch (_) {
      PV.avisar('Não consegui baixar a foto. Tente de novo.', 'erro');
    } finally {
      botao.disabled = false;
    }
  }
  async function baixarZip(botao) {
    botao.disabled = true;
    const texto = botao.textContent;
    botao.textContent = 'Preparando as fotos…';
    try {
      const r = await fetch('/api/fotos/zip', { headers: { Authorization: `Bearer ${C().token()}` } });
      if (!r.ok) throw new Error(String(r.status));
      baixarArquivo(await r.blob(), 'project-v-halloween-fotos.zip');
    } catch (_) {
      PV.avisar('Não consegui baixar agora. Tente de novo em instantes.', 'erro');
    } finally {
      botao.disabled = false;
      botao.textContent = texto;
    }
  }

  function abrirVisor(i) {
    if (!fotos.length) return;
    visorPos = (i + fotos.length) % fotos.length;
    const f = fotos[visorPos];
    const img = $('visor-img');
    img.removeAttribute('src');
    img.dataset.foto = urlFoto(f.id);
    PV.foto(urlFoto(f.id), C().token()).then((src) => { if (img.dataset.foto === urlFoto(f.id)) img.src = src; }).catch(() => {});
    $('visor-legenda').textContent = f.texto ? `“${f.texto}”${f.para ? ` · para ${f.para}` : ''}` : (f.para ? `Para ${f.para}` : '');
    $('visor-conta').textContent = `${visorPos + 1} de ${fotos.length}`;
    $('visor-ant').classList.toggle('oculto', fotos.length < 2);
    $('visor-prox').classList.toggle('oculto', fotos.length < 2);
    $('foto-visor').classList.remove('oculto');
    document.body.classList.add('sem-rolar');
  }
  function fecharVisor() {
    $('foto-visor').classList.add('oculto');
    document.body.classList.remove('sem-rolar');
  }
  document.addEventListener('click', (e) => {
    const item = e.target.closest('[data-foto-pos]');
    if (item) return abrirVisor(Number(item.dataset.fotoPos));
    if (e.target.closest('#fotos-zip')) return baixarZip(e.target.closest('#fotos-zip'));
    if (e.target.closest('#visor-fechar') || e.target.id === 'foto-visor') return fecharVisor();
    if (e.target.closest('#visor-ant')) return abrirVisor(visorPos - 1);
    if (e.target.closest('#visor-prox')) return abrirVisor(visorPos + 1);
    if (e.target.closest('#visor-baixar')) return baixarFoto(visorPos);
    return null;
  });
  document.addEventListener('keydown', (e) => {
    if ($('foto-visor').classList.contains('oculto')) return;
    if (e.key === 'Escape') fecharVisor();
    if (e.key === 'ArrowLeft') abrirVisor(visorPos - 1);
    if (e.key === 'ArrowRight') abrirVisor(visorPos + 1);
  });
  // Saiu da tela de fotos (voltar do celular): fecha o visor.
  window.addEventListener('hashchange', () => { if (location.hash !== '#fotos') fecharVisor(); });

  // ================================================================= cards
  function desenhar(estado) {
    desenharQuiz(estado.quiz);
    desenharConcurso(estado.concurso);
    desenharCorreio(estado.correio);
    desenharFotos(estado.fotos);
    desenharMonstro(estado.monstro);
    corridaUltima = estado.corrida;
    desenharCorrida(estado.corrida);
    desenharBeerpong(estado.beerpong);
  }

  window.PVFesta = { desenhar };
  // convidado.js chama PVJogos.desenhar; encadeia o desenho dos jogos da festa logo depois.
  const original = window.PVJogos && window.PVJogos.desenhar;
  if (window.PVJogos && original) {
    window.PVJogos.desenhar = (estado) => { original(estado); desenhar(estado); };
  }
})();
