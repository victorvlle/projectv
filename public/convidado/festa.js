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
    const valendo = q && q.fase === 'pergunta' && q.atual && q.atual.minha === null && resta(q.fimEm) > 0;
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
  // Recado OU foto (com legenda opcional). A foto é reduzida aqui no celular (lado maior até
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
    $('mural-foto-botao').textContent = tem ? '📷 Trocar foto' : '📷 Escolher ou tirar foto';
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
        <input type="file" id="mural-arquivo" accept="image/*" class="oculto">
        <button class="botao secundario largo" type="button" id="mural-foto-botao">📷 Escolher ou tirar foto</button>
        <div id="mural-previa" class="mural-previa oculto">
          <img id="mural-previa-img" alt="Foto escolhida">
          <button class="botao secundario pequeno" type="button" id="mural-tirar">Tirar a foto</button>
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
        PV.avisar('Não consegui abrir essa foto. Tente outra (JPG ou PNG).', 'erro');
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
  }

  window.PVFesta = { desenhar };
  // convidado.js chama PVJogos.desenhar; encadeia o desenho dos jogos da festa logo depois.
  const original = window.PVJogos && window.PVJogos.desenhar;
  if (window.PVJogos && original) {
    window.PVJogos.desenhar = (estado) => { original(estado); desenhar(estado); };
  }
})();
