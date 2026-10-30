// Telão: cenas do Quiz Relâmpago, do Concurso de Fantasia e do Mural das Trevas.
// Recebe os dados de /api/admin/telao (telao.js chama PVTelaoFesta.desenhar a cada atualização).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = PV.esc;
  const emoji = (id) => (window.PVTelao ? window.PVTelao.emojiDe(id) : '❔');
  const L = ['A', 'B', 'C', 'D'];
  const pts = (n) => Number(n).toLocaleString('pt-BR');

  // ------------------------------------------------------------------ quiz
  // Sala de espera (monstros com as iniciais flutuando) → preparar → pergunta → resposta certa → … → placar.
  // O servidor manda a fase e quando ela acaba; o telão busca de novo logo depois de cada troca.
  let relogio = null;
  let troca = null;
  const vistos = new Set();
  // Agrupa por posição (empate = mesmo degrau) para o pódio com suspense.
  const grupos = (lista, detalhe) => [1, 2, 3].map((pos) => ({ posicao: pos, pessoas: lista.filter((p) => p.posicao === pos).map((p) => ({ ...p, detalhe: detalhe(p) })) }))
    .filter((g) => g.pessoas.length);
  function desenharQuiz(q) {
    clearInterval(relogio);
    clearTimeout(troca);
    if (!q) return;
    const cena = document.querySelector('[data-cena="quiz"]');
    cena.dataset.fase = q.fase;
    if (q.fimEm && window.PVTelaoRecarregar) troca = setTimeout(window.PVTelaoRecarregar, Math.max(300, q.fimEm - PV.relogio.agora() + 300));
    const conta = `<div class="quiz-na-sala">👥 <b>${q.sala.length}</b> na sala</div>`;
    if (q.fase === 'sala' || q.fase === 'preparar') {
      $('quiz-rotulo').textContent = 'Quiz de Terror Relâmpago';
      $('quiz-pergunta').textContent = q.fase === 'sala' ? 'Entre na sala pelo celular!' : 'Prepare-se!';
      $('quiz-opcoes').innerHTML = '';
      const bolhas = q.sala.map((p, i) => {
        const chave = `${p.avatar}:${p.iniciais}:${i}`;
        const nova = !vistos.has(chave);
        vistos.add(chave);
        return `<div class="bolha ${nova ? 'chegou' : ''}" style="animation-delay:${nova ? 0 : (i % 7) * 0.35}s, ${(i % 5) * 0.5}s">
          <span class="avatar">${emoji(p.avatar)}</span><b>${esc(p.iniciais)}</b></div>`;
      }).join('');
      $('quiz-rodape').innerHTML = `${conta}
        ${q.fase === 'sala' ? '<p class="prev-dica">No site da festa: <b>Quiz Relâmpago → Entrar na sala</b><br>Acertou: até +500 · quanto mais rápido, mais pontos</p>' : '<div class="quiz-cronometro" data-tq-seg></div>'}
        <div class="sala-bolhas">${bolhas || '<p class="prev-dica">Esperando o primeiro corajoso…</p>'}</div>`;
    } else if (q.fase === 'fim') {
      $('quiz-rotulo').textContent = 'Quiz de Terror Relâmpago';
      $('quiz-pergunta').textContent = 'Fim do quiz! 🏁';
      $('quiz-opcoes').innerHTML = '';
      const placar = q.placar || [];
      if (!placar.length) {
        $('quiz-rodape').innerHTML = '<p class="prev-dica">Ninguém acertou nenhuma! 💀</p>';
      } else {
        // Pódio com suspense (3º, 2º, 1º) e, embaixo, quem veio depois.
        if (!$('quiz-podio')) $('quiz-rodape').innerHTML = '<div id="quiz-podio"></div><div class="quiz-placar-telao" id="quiz-resto"></div>';
        window.PVPodio.montar($('quiz-podio'), grupos(placar, (p) => `${p.acertos} ${p.acertos === 1 ? 'acerto' : 'acertos'} · +${pts(p.pontos)}`),
          { chave: `quiz:${JSON.stringify(placar)}` });
        $('quiz-resto').innerHTML = placar.filter((p) => p.posicao > 3).map((p) => `<div class="linha-placar"><span class="pos">${p.posicao}º</span>
          <span class="avatar">${emoji(p.avatar)}</span><span class="n">${esc(p.nome)}</span><span class="pts">${p.acertos} ${p.acertos === 1 ? 'acerto' : 'acertos'} · +${pts(p.pontos)}</span></div>`).join('');
      }
    } else {
      const x = q.atual;
      const revelada = q.fase === 'revelacao';
      $('quiz-rotulo').textContent = `Pergunta ${x.numero} de ${q.total}`;
      $('quiz-pergunta').textContent = x.texto;
      if (revelada) {
        // Gráfico de colunas como no Kahoot: quantos marcaram cada opção, a certa com ✓.
        const maior = Math.max(1, ...x.porOpcao);
        $('quiz-opcoes').innerHTML = `<div class="grafico-quiz">${x.opcoes.map((o, i) => `
          <div class="coluna op${i} ${i === x.correta ? 'certa' : 'errada'}">
            <span class="qtd">${x.porOpcao[i]}</span>
            <div class="barra" style="--alt:${Math.max(4, Math.round((x.porOpcao[i] / maior) * 100))}%"></div>
            <div class="rot"><b>${L[i]}</b>${i === x.correta ? '<span class="ok">✓</span>' : ''}</div>
            <small>${esc(o)}</small></div>`).join('')}</div>`;
      } else {
        $('quiz-opcoes').innerHTML = x.opcoes.map((o, i) => `<div class="quiz-op-telao op${i}"><b>${L[i]}</b><span>${esc(o)}</span></div>`).join('');
      }
      $('quiz-rodape').innerHTML = revelada
        ? `${x.acertaram.length ? `<p class="quiz-acertaram">Acertaram: ${x.acertaram.map((a) => `<span><span class="avatar mini">${emoji(a.avatar)}</span>${esc(a.nome)} <small>${esc(a.segundos)} s · +${pts(a.pontos)}</small></span>`).join('')}</p>`
          : '<p class="prev-dica">Ninguém acertou essa! 💀</p>'}
          <p class="prev-dica">${q.proxima ? 'Próxima pergunta em' : 'Resultado final em'} <b data-tq-seg></b>s</p>`
        : `<div class="quiz-cronometro" data-tq-seg></div><p class="prev-dica">${x.respostas} de ${q.sala.length} ${q.sala.length === 1 ? 'respondeu' : 'responderam'}</p>`;
    }
    const tic = () => {
      const resta = q.fimEm ? Math.max(0, Math.ceil((q.fimEm - PV.relogio.agora()) / 1000)) : 0;
      document.querySelectorAll('[data-tq-seg]').forEach((el) => { el.textContent = resta; el.classList.toggle('acabando', q.fase === 'pergunta' && resta <= 5); });
      if (!resta) clearInterval(relogio);
    };
    if (q.fimEm) { tic(); relogio = setInterval(tic, 250); }
  }

  // -------------------------------------------------------------- concurso
  function desenharConcurso(c) {
    if (!c) return;
    $('concurso-titulo').classList.toggle('oculto', c.estado === 'desfile');
    if (c.estado === 'publicado') {
      const podio = c.podio || [];
      if (!podio.length) { $('concurso-telao').innerHTML = '<p class="prev-dica">Ninguém recebeu voto.</p>'; return; }
      // Revela 3º, 2º e 1º com suspense (uma vez por resultado publicado).
      window.PVPodio.montar($('concurso-telao'), grupos(podio, (p) => `+${pts(p.pontos)} · ${p.votos} ${p.votos === 1 ? 'voto' : 'votos'}`),
        { chave: `concurso:${JSON.stringify(podio)}` });
      return;
    }
    if (c.estado === 'desfile') {
      $('concurso-telao').innerHTML = `<div class="desfile-chamada"><p class="desfile-titulo terror">Hora do Desfile Macabro</p>
        <p class="desfile-sub">Formem a fila! 👑 · ${(c.desfile || []).length} ${(c.desfile || []).length === 1 ? 'vai' : 'vão'} desfilar</p></div>
        <div class="sala-bolhas">${(c.desfile || []).map((p, i) => `<div class="bolha" style="animation-delay:${(i % 7) * 0.35}s">
          <span class="avatar">${emoji(p.avatar)}</span><b>${esc(p.iniciais)}</b></div>`).join('')}</div>
        <p class="prev-dica">Depois do desfile, a votação abre no celular · 1º +${pts(c.premios[0])} · 2º +${pts(c.premios[1])} · 3º +${pts(c.premios[2])}</p>`;
      return;
    }
    const txt = { fechado: 'A votação abre em breve. Capriche na pose!', aberto: 'Votação aberta! Vote pelo celular na melhor fantasia.', encerrado: 'Votação encerrada. O resultado vem aí…' }[c.estado];
    const eleitores = c.eleitores || [];
    $('concurso-telao').innerHTML = `<p class="prev-pergunta" style="font-size:5vh">${txt}</p>
      ${c.estado === 'fechado' ? `<div class="contador-votos">👑 <b>${(c.desfile || []).length}</b> ${(c.desfile || []).length === 1 ? 'vai' : 'vão'} desfilar</div>
        <div class="sala-bolhas">${(c.desfile || []).map((p, i) => `<div class="bolha" style="animation-delay:${(i % 7) * 0.35}s">
          <span class="avatar">${emoji(p.avatar)}</span><b>${esc(p.iniciais)}</b></div>`).join('')}</div>
        <p class="prev-dica">Quer concorrer? No celular: Concurso de Fantasia → <b>Quero desfilar!</b></p>` : ''}
      ${c.estado !== 'fechado' ? `<div class="contador-votos">🗳️ <b>${eleitores.length}</b> de ${c.podemVotar || 0} votaram</div>
        <div class="sala-bolhas">${eleitores.map((p, i) => {
          const chave = `v:${p.avatar}:${p.iniciais}:${i}`;
          const nova = !vistos.has(chave);
          vistos.add(chave);
          return `<div class="bolha ${nova ? 'chegou' : ''}" style="animation-delay:${nova ? 0 : (i % 7) * 0.35}s, ${(i % 5) * 0.5}s">
            <span class="avatar">${emoji(p.avatar)}</span><b>${esc(p.iniciais)}</b></div>`;
        }).join('') || '<p class="prev-dica">Ninguém votou ainda…</p>'}</div>
        <p class="prev-dica">O voto é secreto: aqui aparece só quem já votou.</p>` : ''}
      <p class="prev-dica">1º +${pts(c.premios[0])} · 2º +${pts(c.premios[1])} · 3º +${pts(c.premios[2])}</p>`;
  }

  // --------------------------------------------------------- mural das trevas
  // Um por vez: foto inteira na tela (com a legenda embaixo) ou o recado.
  // Foto fica 12 s, recado 9 s. O que acabou de ser aprovado entra na frente.
  // Visual "cinematográfico": cada item entra num quadro novo (fade + zoom 98%→100%) enquanto o
  // anterior sai em fade; a foto só entra depois de carregada, e a mesma foto, desfocada, vira a
  // luz difusa do fundo.
  let cartas = [];
  let indice = 0;
  let rodando = null;
  let assinatura = '';
  let vez = 0; // descarta trocas atrasadas (foto que terminou de baixar depois de outra troca)
  const TRANSICAO_MS = 700;
  const tokenTelao = () => (window.PVTelao ? window.PVTelao.token() : null);
  const urlFoto = (c) => `/api/admin/correio/foto/${c.id}`;
  const para = (c) => (c.para ? `<p class="mural-para"><span class="mural-para-rotulo">Para</span>
    ${c.paraAvatar ? `<span class="avatar mini">${emoji(c.paraAvatar)}</span>` : ''}<b>${esc(c.para)}</b></p>` : '');

  // Luz difusa: uma miniatura da foto (24 px) esticada na tela já fica suave, sem filtro de desfoque
  // (blur numa camada do tamanho da tela pesa e travava a transição).
  function miniatura(img) {
    try {
      const c = document.createElement('canvas');
      const k = 24 / Math.max(img.naturalWidth, img.naturalHeight);
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } catch (_) { return null; }
  }
  function luzDeFundo(img) {
    const fundo = $('mural-fundo');
    const nova = document.createElement('div');
    nova.className = 'mural-luz';
    const mini = img ? miniatura(img) : null;
    if (mini) nova.style.backgroundImage = `url("${mini}")`;
    fundo.appendChild(nova);
    requestAnimationFrame(() => nova.classList.add('visivel'));
    [...fundo.querySelectorAll('.mural-luz')].slice(0, -1).forEach((v) => {
      v.classList.remove('visivel');
      setTimeout(() => v.remove(), TRANSICAO_MS + 100);
    });
  }
  // Troca o quadro: o novo entra, o anterior sai (os dois ficam na mesma célula da grade).
  function trocarQuadro(html, src, img) {
    const palco = $('carta-telao');
    const novo = document.createElement('div');
    novo.className = 'mural-slide';
    novo.innerHTML = html;
    if (src) novo.querySelector('img').src = src;
    palco.querySelectorAll('.prev-dica').forEach((x) => x.remove());
    palco.querySelectorAll('.mural-slide:not(.saindo)').forEach((v) => {
      v.classList.add('saindo');
      setTimeout(() => v.remove(), TRANSICAO_MS + 100);
    });
    palco.appendChild(novo);
    requestAnimationFrame(() => requestAnimationFrame(() => novo.classList.add('visivel')));
    luzDeFundo(img || null);
  }

  function mostrarCarta() {
    clearTimeout(rodando);
    const minhaVez = ++vez;
    if (!cartas.length) {
      $('carta-telao').innerHTML = '<p class="prev-dica">Nada no mural ainda. Mande um recado ou uma foto pelo celular! 📸</p>';
      luzDeFundo(null);
      return;
    }
    const c = cartas[indice % cartas.length];
    const agendar = () => { rodando = setTimeout(() => { indice += 1; mostrarCarta(); }, c.foto ? 12000 : 9000); };
    if (c.foto) {
      PV.foto(urlFoto(c), tokenTelao())
        .then((src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok([src, im]); im.onerror = () => ok([src, null]); im.src = src; }))
        .then(([src, im]) => {
          if (minhaVez !== vez) return;
          trocarQuadro(`<figure class="mural-foto ${c.para ? 'tem-para' : ''} ${c.texto ? 'tem-legenda' : ''}">${para(c)}
            <div class="mural-moldura"><img alt="Foto do mural"></div>
            ${c.texto ? `<figcaption>${esc(c.texto)}</figcaption>` : ''}</figure>`, src, im);
          agendar();
        })
        .catch(() => { if (minhaVez !== vez) return; indice += 1; rodando = setTimeout(mostrarCarta, 3000); });
    } else {
      trocarQuadro(`<div class="mural-recado">${para(c)}
          <p class="mural-recado-corpo">“${esc(c.texto)}”</p><p class="mural-recado-assinatura">— Anônimo</p></div>`, null);
      agendar();
    }
    // Já deixa a próxima foto baixada.
    const prox = cartas[(indice + 1) % cartas.length];
    if (prox && prox.foto) PV.foto(urlFoto(prox), tokenTelao()).catch(() => {});
  }
  function desenharCorreio(k) {
    const nova = k ? k.cartas : [];
    const ass = nova.map((c) => c.id).join(',');
    if (ass === assinatura) return;
    const chegouNova = nova.length && (!cartas.length || nova[0].id !== (cartas[0] || {}).id);
    assinatura = ass;
    const atual = cartas.length ? cartas[indice % cartas.length] : null;
    cartas = nova;
    if (chegouNova) indice = 0; // o mais novo aparece primeiro
    else {
      // Continua de onde estava (sem reiniciar a foto que está na tela).
      const pos = atual ? cartas.findIndex((c) => c.id === atual.id) : -1;
      if (pos >= 0) { indice = pos; return; }
      indice = 0;
    }
    mostrarCarta();
  }

  // ------------------------------------------------------------ o monstro
  // Vila (monstrinhos flutuando) → rodada (almas e pistas) → votação (quem já votou) → revelação com suspense.
  let assMonstro = '';
  const vistosMonstro = new Set();
  let revelacaoFeita = null;
  let timerRevela = null;
  const bolhas = (lista, prefixo) => lista.map((p, i) => {
    const chave = `${prefixo}:${p.avatar}:${p.iniciais}:${i}`;
    const nova = !vistosMonstro.has(chave);
    vistosMonstro.add(chave);
    return `<div class="bolha ${nova ? 'chegou' : ''}" style="animation-delay:${nova ? 0 : (i % 7) * 0.35}s, ${(i % 5) * 0.5}s">
      <span class="avatar">${emoji(p.avatar)}</span><b>${esc(p.iniciais)}</b></div>`;
  }).join('');
  function desenharMonstro(m) {
    if (!m) return;
    const ass = JSON.stringify(m);
    if (ass === assMonstro) return;
    assMonstro = ass;
    const el = $('monstro-telao');
    const pistas = (m.pistas || []).length ? `<div class="monstro-pistas">${m.pistas.map((p, i) => `<p class="${i === 0 ? 'nova' : ''}">🔎 ${esc(p.texto)}</p>`).join('')}</div>` : '';
    if (m.estado === 'aberta') {
      clearTimeout(timerRevela);
      el.innerHTML = `<h1 class="terror monstro-titulo">Há um monstro entre nós</h1>
        <p class="prev-dica">Entre na vila pelo celular: <b>O Monstro → Quero entrar na vila</b></p>
        <div class="contador-votos">🏘️ <b>${m.vila.length}</b> na vila</div>
        <div class="sala-bolhas">${bolhas(m.vila, 'vila') || '<p class="prev-dica">A vila está vazia… por enquanto.</p>'}</div>`;
      return;
    }
    if (m.estado === 'jogando') {
      el.innerHTML = `<p class="rotulo">Rodada ${m.rodada}</p>
        <h1 class="terror monstro-titulo">${m.qtdMonstros === 1 ? 'Há um monstro' : `Há ${m.qtdMonstros} monstros`} entre vocês</h1>
        <div class="monstro-almas"><b>${m.almas}</b><small>${m.almas === 1 ? 'alma pega' : 'almas pegas'}</small></div>
        ${pistas || '<p class="prev-dica">Fique de olho em quem anda brindando demais…</p>'}`;
      return;
    }
    if (m.estado === 'votacao') {
      const e = m.eleitores || [];
      el.innerHTML = `<h1 class="terror monstro-titulo">Quem é o monstro?</h1>
        <p class="prev-dica">Vote pelo celular · a revelação vem aí</p>
        <div class="contador-votos">🗳️ <b>${e.length}</b> de ${m.vila.length} votaram</div>
        <div class="sala-bolhas">${bolhas(e, `voto${m.rodada}`) || '<p class="prev-dica">Ninguém votou ainda…</p>'}</div>${pistas}`;
      return;
    }
    if (m.estado === 'revelada' && m.resultado) {
      const r = m.resultado;
      const cartoes = r.monstros.map((x, i) => `<div class="monstro-revelado ${x.descoberto ? 'pego' : 'escapou'}" style="animation-delay:${i * 0.6}s">
        <span class="avatar">${emoji(x.avatar)}</span><b>${esc(x.nome)}</b>
        <small>${x.almas} ${x.almas === 1 ? 'alma' : 'almas'} · ${x.votos} ${x.votos === 1 ? 'voto' : 'votos'}</small>
        <em>${x.descoberto ? 'Descoberto!' : 'Escapou!'}</em></div>`).join('');
      const final = `<h1 class="terror monstro-titulo">${r.monstros.length === 1 ? 'O monstro era…' : 'Os monstros eram…'}</h1>
        <div class="monstro-revelados">${cartoes}</div>
        <p class="prev-dica">${r.acertaram ? `🎯 ${r.acertaram} ${r.acertaram === 1 ? 'pessoa acertou' : 'pessoas acertaram'} (+1.000)` : 'Ninguém acertou!'}${r.acertaramNomes.length ? `: ${r.acertaramNomes.map(esc).join(', ')}` : ''}</p>`;
      // Suspense uma vez por rodada: "O monstro era…" sozinho por 3 s, depois a revelação.
      if (revelacaoFeita !== m.rodada) {
        revelacaoFeita = m.rodada;
        el.innerHTML = `<h1 class="terror monstro-titulo monstro-suspense">${r.monstros.length === 1 ? 'O monstro era…' : 'Os monstros eram…'}</h1>`;
        clearTimeout(timerRevela);
        timerRevela = setTimeout(() => { el.innerHTML = final; }, 3200);
      } else if (!timerRevela || !el.querySelector('.monstro-suspense')) {
        el.innerHTML = final;
      }
    }
  }

  window.PVTelaoFesta = {
    desenhar(estado) {
      desenharQuiz(estado.quiz);
      desenharConcurso(estado.concurso);
      desenharCorreio(estado.correio);
      desenharMonstro(estado.monstro);
    },
  };
})();
