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
  // Foto fica 12 s, recado 9 s. FILA: o que chega entra na fila e aparece na ordem de envio (o
  // primeiro que mandou aparece primeiro), sem cortar o que está na tela; sem fila, roda tudo em ordem.
  // Visual "cinematográfico": cada item entra num quadro novo (fade + zoom 98%→100%) enquanto o
  // anterior sai em fade; a foto só entra depois de carregada, e a mesma foto, desfocada, vira a
  // luz difusa do fundo.
  let cartas = []; // em ordem de envio (mais antigo primeiro)
  let rodando = null;
  let mostrandoId = null;
  let primeiraCarga = true;
  const vistosMural = new Set();
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

  // Laterais do Mural: ranking (esquerda) e programação das atrações (direita).
  let assLaterais = '';
  const horaDe = (ms) => PV.dataHora(ms, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function desenharLaterais(estado) {
    const rank = (estado.ranking || []).slice(0, 6);
    const prog = (estado.telao && estado.telao.programacao) || {};
    const ativs = (estado.atividades || []).filter((a) => !['previsoes', 'correio', 'fotos'].includes(a.id));
    const itens = ativs.map((a) => {
      const hora = prog[a.id] || (a.abreEm ? horaDe(a.abreEm) : '');
      return { a, hora, aberta: a.estado === 'liberada' };
    }).sort((x, y) => (x.aberta === y.aberta ? 0 : x.aberta ? -1 : 1) || (x.hora || '99').localeCompare(y.hora || '99'));
    const html = `<h2 class="lado-titulo">Ranking da noite</h2>
      <ol class="lado-rank">${rank.map((r) => `<li><span class="lado-pos">${r.posicao}</span><span class="avatar mini">${emoji(r.avatar)}</span>
        <span class="lado-nome">${esc(r.nome.split(' ')[0])}</span><b>${pts(r.pontos)}</b></li>`).join('') || '<li class="lado-vazio">Ninguém pontuou ainda</li>'}</ol>
      §<h2 class="lado-titulo">Programação</h2>
      <ul class="lado-agenda">${itens.map(({ a, hora, aberta }) => `<li class="${aberta ? 'aberta' : ''}">
        <span class="lado-icone">${aberta ? esc(a.icone) : '🔒'}</span>
        <span class="lado-nome">${esc(aberta ? a.nome : a.enigma)}</span>
        <b>${aberta ? 'agora' : esc(hora || 'em breve')}</b></li>`).join('')}</ul>`;
    if (html === assLaterais) return;
    assLaterais = html;
    const [esq, dir] = html.split('§');
    $('mural-ranking').innerHTML = esq;
    $('mural-agenda').innerHTML = dir;
  }

  // Próximo da fila: o mais antigo ainda não exibido; sem fila, o seguinte ao que está na tela.
  function proxima() {
    const naFila = cartas.find((c) => !vistosMural.has(c.id));
    if (naFila) return naFila;
    const pos = cartas.findIndex((c) => c.id === mostrandoId);
    return cartas[(pos + 1) % cartas.length];
  }
  function mostrarCarta() {
    clearTimeout(rodando);
    const minhaVez = ++vez;
    if (!cartas.length) {
      mostrandoId = null;
      $('carta-telao').innerHTML = '<p class="prev-dica">Nada no mural ainda. Mande um recado ou uma foto pelo celular! 📸</p>';
      luzDeFundo(null);
      return;
    }
    const c = proxima();
    vistosMural.add(c.id);
    mostrandoId = c.id;
    const agendar = () => { rodando = setTimeout(mostrarCarta, c.foto ? 12000 : 9000); };
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
        .catch(() => { if (minhaVez !== vez) return; rodando = setTimeout(mostrarCarta, 3000); });
    } else {
      trocarQuadro(`<div class="mural-recado">${para(c)}
          <p class="mural-recado-corpo">“${esc(c.texto)}”</p><p class="mural-recado-assinatura">— Anônimo</p></div>`, null);
      agendar();
    }
    // Já deixa a próxima foto baixada.
    const prox = proxima();
    if (prox && prox.foto) PV.foto(urlFoto(prox), tokenTelao()).catch(() => {});
  }
  function desenharCorreio(k) {
    const nova = (k ? k.cartas : []).slice().sort((a, b) => (a.em - b.em) || (a.id - b.id));
    const ass = nova.map((c) => c.id).join(',');
    if (ass === assinatura) return;
    assinatura = ass;
    cartas = nova;
    // Ao abrir o telão, o que já existia não é "novidade": roda em ordem a partir do mais antigo.
    if (primeiraCarga) { primeiraCarga = false; nova.forEach((c) => vistosMural.add(c.id)); mostrandoId = null; mostrarCarta(); return; }
    // Nada na tela (mural vazio) ou o que estava na tela foi apagado: mostra o próximo já.
    if (!mostrandoId || !cartas.some((c) => c.id === mostrandoId)) mostrarCarta();
    // Senão, quem chegou espera a vez na fila (não corta o que está na tela).
  }

  // ---------------------------------------------------------------- beer pong
  // Inscrições → sorteio animado dos trios (nomes caindo nos times) → chave do mata-mata.
  // Quando o organizador marca quem passou, o telão mostra o time avançando; no fim, os campeões.
  let bpTimer = null;
  let bpAvanco = null;
  let bpVisto = null;
  const bpTime = (ch, id) => (ch && ch.times.find((t) => t.id === id)) || null;
  // Sorteio em 3 atos, no relógio do servidor (todo telão igual):
  //  1) nomes: a roleta gira entre quem ainda não saiu, desacelera e para no sorteado, que cai no time;
  //  2) confrontos da 1ª rodada, um por um (quem passa direto também aparece);
  //  3) a chave.
  let bpMontado = null; // assinatura do sorteio já montado na tela
  let bpCaidos = 0;
  let bpConfrontos = -1;
  const GIRO = 0.68; // fração do passo com a roleta girando; o resto, o nome parado
  function bpNomeDoGiro(b, k, f) {
    const resto = b.revelacao.slice(k);
    if (resto.length <= 1) return resto[0];
    const voltas = 22;
    const i = Math.floor(voltas * Math.sqrt(Math.min(1, f / GIRO))); // desacelera
    const nome = resto[(k * 7 + i * 5) % resto.length];
    return nome === resto[0] && i < voltas - 1 ? resto[(k * 7 + i * 5 + 1) % resto.length] : nome;
  }
  function bpSorteio(b) {
    const t = PV.relogio.agora() - b.sorteioEm;
    const total = b.revelacao.length;
    const k = Math.min(total, Math.max(0, Math.floor(t / b.passoMs)));
    const f = k < total ? (t - k * b.passoMs) / b.passoMs : 1;
    const caidos = k + (k < total && f >= GIRO ? 1 : 0);
    const chaveSorteio = `${b.sorteioEm}`;
    if (bpMontado !== chaveSorteio) {
      bpMontado = chaveSorteio; bpCaidos = 0; bpConfrontos = -1;
      $('bp-telao').innerHTML = `<h1 class="terror bp-titulo">Sorteio dos times 🍺</h1>
        <div class="bp-roleta" id="bp-roleta"><span class="avatar" id="bp-roleta-av"></span><b id="bp-roleta-nome">…</b><em id="bp-roleta-time"></em></div>
        <div class="bp-times">${b.chave.times.map((tm) => `<div class="bp-time-card" data-time="${tm.id}">
          <div class="bp-time-nome">${tm.emoji} ${esc(tm.nome)}</div><div class="bp-membros"><span class="bp-vazio">…</span></div></div>`).join('')}</div>
        <p class="prev-dica" id="bp-sorteio-dica"></p>`;
    }
    // Nomes que já caíram nos times: só acrescenta os novos (a animação roda uma vez por nome).
    for (; bpCaidos < caidos; bpCaidos++) {
      const m = b.revelacao[bpCaidos];
      const card = document.querySelector(`.bp-time-card[data-time="${m.time}"]`);
      if (!card) continue;
      document.querySelectorAll('.bp-time-card.recebendo').forEach((c) => c.classList.remove('recebendo'));
      document.querySelectorAll('.bp-membro.caiu').forEach((x) => x.classList.remove('caiu'));
      card.classList.add('recebendo');
      const lista = card.querySelector('.bp-membros');
      const vazio = lista.querySelector('.bp-vazio');
      if (vazio) vazio.remove();
      const el = document.createElement('span');
      el.className = 'bp-membro caiu';
      el.innerHTML = `<span class="avatar mini">${emoji(m.avatar)}</span>${esc(m.nome)}`;
      lista.appendChild(el);
    }
    const roleta = $('bp-roleta');
    if (k < total) {
      const parado = f >= GIRO;
      const m = parado ? b.revelacao[k] : bpNomeDoGiro(b, k, f);
      roleta.classList.toggle('parou', parado);
      $('bp-roleta-av').innerHTML = emoji(m.avatar);
      $('bp-roleta-nome').textContent = m.nome;
      const tm = bpTime(b.chave, b.revelacao[k].time);
      $('bp-roleta-time').textContent = parado && tm ? `→ ${tm.emoji} ${tm.nome}` : 'sorteando…';
      $('bp-sorteio-dica').textContent = `${k + 1} de ${total}`;
    } else {
      roleta.classList.add('parou');
      $('bp-roleta-av').innerHTML = '🍺';
      $('bp-roleta-nome').textContent = 'Times formados!';
      $('bp-roleta-time').textContent = 'agora, os confrontos…';
      $('bp-sorteio-dica').textContent = '';
    }
  }
  // Ato 2: confrontos da 1ª rodada, um por vez (o atual grande; os anteriores numa lista).
  function bpConfrontosTela(b, inicio) {
    const ch = b.chave;
    const jogos = ch.partidas.filter((p) => p.rodada === 1);
    const i = Math.min(jogos.length - 1, Math.max(0, Math.floor((PV.relogio.agora() - inicio) / b.passoConfrontoMs)));
    if (i === bpConfrontos) return;
    bpConfrontos = i;
    bpMontado = null;
    const nome = (id) => { const tm = bpTime(ch, id); return tm ? `${tm.emoji} ${esc(tm.nome)}` : ''; };
    const membros = (id) => { const tm = bpTime(ch, id); return tm ? tm.membros.map((m) => esc(m.nome)).join(' · ') : ''; };
    const p = jogos[i];
    const grande = p.bye
      ? `<div class="bp-vs bye"><div class="bp-vs-time"><b>${nome(p.vencedor)}</b><small>${membros(p.vencedor)}</small></div>
          <div class="bp-vs-x">🍀</div><div class="bp-vs-time sorte"><b>passa direto</b><small>sorte na chave!</small></div></div>`
      : `<div class="bp-vs"><div class="bp-vs-time"><b>${nome(p.a)}</b><small>${membros(p.a)}</small></div>
          <div class="bp-vs-x">×</div><div class="bp-vs-time"><b>${nome(p.b)}</b><small>${membros(p.b)}</small></div></div>`;
    const anteriores = jogos.slice(0, i).map((q) => `<span class="bp-vs-mini">${q.bye ? `${nome(q.vencedor)} 🍀 direto` : `${nome(q.a)} × ${nome(q.b)}`}</span>`).join('');
    $('bp-telao').innerHTML = `<h1 class="terror bp-titulo">${esc(ch.nomesRodadas[0])} 🍺</h1>
      <p class="prev-dica">Confronto ${i + 1} de ${jogos.length}</p>${grande}
      <div class="bp-vs-lista">${anteriores}</div>`;
  }
  function bpPartida(ch, p, proxima) {
    const linha = (id) => {
      const t = bpTime(ch, id);
      if (!t) return `<div class="bp-lado vazio">${p.bye ? 'passa direto' : 'a definir'}</div>`;
      const cls = p.vencedor ? (p.vencedor === id ? 'venceu' : 'perdeu') : '';
      return `<div class="bp-lado ${cls}"><b>${t.emoji} ${esc(t.nome)}</b><small>${t.membros.map((m) => esc(m.nome)).join(' · ')}</small></div>`;
    };
    return `<div class="bp-partida ${p.id === proxima ? 'agora' : ''} ${p.bye ? 'bye' : ''}">${p.id === proxima ? '<span class="bp-agora">AGORA</span>' : ''}
      ${linha(p.a)}${p.bye ? '' : linha(p.b)}</div>`;
  }
  function bpChave(b) {
    const ch = b.chave;
    const colunas = ch.nomesRodadas.map((nome, i) => `<div class="bp-coluna"><h3>${esc(nome)}</h3>
      <div class="bp-jogos">${ch.partidas.filter((p) => p.rodada === i + 1).map((p) => bpPartida(ch, p, ch.proxima)).join('')}</div></div>`).join('');
    let topo = '<h1 class="terror bp-titulo">Beer Pong 🍺</h1>';
    if (b.campeao) {
      const t = bpTime(ch, b.campeao);
      topo = `<div class="bp-campeao"><span class="bp-trofeu">🏆</span><div><small>Campeões</small><b>${t.emoji} ${esc(t.nome)}</b>
        <em>${t.membros.map((m) => esc(m.nome)).join(' · ')} · +${pts(b.premios.campeao)} cada</em></div></div>`;
    }
    $('bp-telao').innerHTML = `${topo}<div class="bp-chave" style="--rodadas:${ch.rodadas}">${colunas}</div>`;
    // Time que acabou de passar: faixa de destaque por alguns segundos (uma vez por resultado).
    const u = ch.ultimo;
    if (u && u.em !== bpVisto && PV.relogio.agora() - u.em < 8000) {
      bpVisto = u.em;
      const t = bpTime(ch, u.time);
      const p = ch.partidas.find((x) => x.id === u.partida);
      const final = p && p.rodada === ch.rodadas;
      const prox = !final && p ? ch.nomesRodadas[p.rodada] : '';
      document.querySelectorAll('.bp-avanca').forEach((x) => x.remove());
      const faixa = document.createElement('div');
      faixa.className = 'bp-avanca';
      faixa.innerHTML = `<span>${t ? t.emoji : ''}</span><b>${t ? esc(t.nome) : ''}</b><em>${final ? 'é CAMPEÃO! 🏆' : `avança para ${esc(/^(Quartas|Oitavas)/.test(prox) ? `as ${prox}` : `a ${prox}`)}!`}</em>`;
      document.body.appendChild(faixa);
      clearTimeout(bpAvanco);
      bpAvanco = setTimeout(() => faixa.remove(), 5000);
    }
  }
  function desenharBeerpong(b) {
    if (!b) return;
    clearInterval(bpTimer);
    if (b.estado === 'inscricao') {
      $('bp-telao').innerHTML = `<h1 class="terror bp-titulo">Beer Pong 🍺</h1>
        <p class="prev-dica">Inscreva-se pelo celular: <b>Beer Pong → Quero jogar</b> · trios sorteados aqui no telão</p>
        <div class="contador-votos">🍺 <b>${b.inscritos.length}</b> ${b.inscritos.length === 1 ? 'inscrito' : 'inscritos'}</div>
        <div class="sala-bolhas">${b.inscritos.map((p, i) => `<div class="bolha" style="animation-delay:${(i % 7) * 0.35}s"><span class="avatar">${emoji(p.avatar)}</span><b>${esc(p.iniciais)}</b></div>`).join('') || '<p class="prev-dica">Ninguém ainda…</p>'}</div>
        <p class="prev-dica">Campeões +${pts(b.premios.campeao)} cada · vice +${pts(b.premios.vice)} cada</p>`;
      return;
    }
    const fimNomes = b.sorteioEm + b.revelacao.length * b.passoMs + b.folgaMs;
    const passo = () => {
      const agora = PV.relogio.agora();
      if (agora < fimNomes) bpSorteio(b);
      else if (agora < b.fimRevelacao) bpConfrontosTela(b, fimNomes);
      else { clearInterval(bpTimer); bpMontado = null; bpConfrontos = -1; bpChave(b); }
    };
    if (PV.relogio.agora() < b.fimRevelacao) {
      passo();
      bpTimer = setInterval(passo, 70);
      return;
    }
    bpMontado = null; bpConfrontos = -1;
    bpChave(b);
  }

  // ------------------------------------------------------- corrida de cavalos
  // Apostas (quem escolheu cada naipe) → largada (3, 2, 1) → corrida no relógio do servidor (o mesmo
  // roteiro em todo telão) → resultado com quem ganhou e quem toma o shot.
  const NAIPES = ['espadas', 'copas', 'ouros', 'paus'];
  const SIMB = { espadas: '♠', copas: '♥', ouros: '♦', paus: '♣' };
  const NOME_NAIPE = { espadas: 'Espadas', copas: 'Copas', ouros: 'Ouros', paus: 'Paus' };
  const vermelho = (n) => n === 'copas' || n === 'ouros';
  const carta = (n, valor, extra = '') => `<div class="carta-jogo ${vermelho(n) ? 'vermelha' : ''} ${extra}"><span>${esc(valor)}</span><b>${SIMB[n]}</b></div>`;
  let corridaAtual = null;
  let corridaTimer = null;
  let corridaChave = '';
  let corridaFim = null;
  let corridaFase = '';
  // Coreografia de cada carta (ms dentro do tempo da carta; o servidor dá 3000 para "anda" e 3600 para "volta").
  const FASES_ANDA = [[0, 'surge'], [150, 'mostra'], [700, 'segura'], [1500, 'canto'], [2100, 'move']];
  const FASES_VOLTA = [[0, 'sobe'], [700, 'desvira'], [1400, 'segura'], [2200, 'volta'], [2800, 'move']];
  const faseDe = (e, dt) => (e.tipo === 'anda' ? FASES_ANDA : FASES_VOLTA).filter(([t]) => dt >= t).pop()[1];

  function montarPista(c) {
    const casas = Array.from({ length: c.casas }, (_, i) => `<div class="pista-lateral" data-casa="${i + 1}"><div class="carta-jogo verso"></div></div>`).join('');
    $('corrida-telao').innerHTML = `<div class="corrida-topo"><h1 class="terror corrida-titulo">Corrida de Cavalos 🏇</h1>
        <div class="corrida-saiu"><small>Última</small><div class="slot-saiu" id="corrida-saiu"><div class="carta-jogo vazia"></div></div></div></div>
      <div class="pista" style="--casas:${c.casas + 2}">
        <div class="pista-linha pista-laterais"><div></div>${casas}<div class="pista-chegada-rotulo">🏁</div></div>
        ${NAIPES.map((n) => `<div class="pista-linha raia" data-naipe="${n}">
          <div class="raia-fundo">${Array.from({ length: c.casas + 2 }, (_, i) => `<div class="raia-casa ${i === c.casas + 1 ? 'chegada' : ''}"></div>`).join('')}</div>
          <div class="cavalo" id="cavalo-${n}">${carta(n, 'A', 'cavalo-carta')}<small>${(c.apostas[n] || []).length}</small></div>
        </div>`).join('')}
      </div>
      <p class="corrida-aviso" id="corrida-aviso"></p>`;
    // Carta que voa (sorteio no meio da tela; lateral que sobe e desvira)
    let voa = $('carta-voadora');
    if (!voa) { voa = document.createElement('div'); voa.id = 'carta-voadora'; voa.className = 'carta-voadora oculto'; document.body.appendChild(voa); }
  }
  // Posição de um elemento da tela (para a carta voar até ele)
  const caixa = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  function centroGrande() {
    const h = Math.min(window.innerHeight * 0.55, window.innerWidth * 0.5);
    const w = h * 0.7;
    return { left: (window.innerWidth - w) / 2, top: (window.innerHeight - h) / 2, width: w, height: h };
  }
  function voar(r, { instantaneo = false, frente = true } = {}) {
    const voa = $('carta-voadora');
    if (!voa) return;
    voa.classList.toggle('sem-transicao', instantaneo);
    voa.classList.toggle('mostrando', frente);
    Object.assign(voa.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, fontSize: `${r.height / 9.4}px` });
    if (instantaneo) { void voa.offsetWidth; voa.classList.remove('sem-transicao'); }
  }
  function cartaVoadora(n, valor) {
    const voa = $('carta-voadora');
    voa.innerHTML = `<div class="voa-dentro"><div class="voa-face voa-verso"></div>
      <div class="voa-face voa-frente ${vermelho(n) ? 'vermelha' : ''}"><span>${esc(valor)}</span><b>${SIMB[n]}</b></div></div>`;
    voa.classList.remove('oculto');
  }
  const esconderVoadora = () => { const v = $('carta-voadora'); if (v) v.classList.add('oculto'); };

  // Estado da pista depois das cartas [0, k) (+ a carta atual, se já chegou na hora de mover)
  function estadoAte(c, k, incluirAtual) {
    const pos = { espadas: 0, copas: 0, ouros: 0, paus: 0 };
    const viradas = new Set();
    let ultimaAnda = null;
    const ate = incluirAtual ? k + 1 : k;
    for (const e of c.eventos.slice(0, Math.max(0, ate))) {
      if (e.tipo === 'anda') { pos[e.naipe] += 1; ultimaAnda = e; } else { viradas.add(e.casa); if (pos[e.naipe] > 0) pos[e.naipe] -= 1; }
    }
    return { pos, viradas, ultimaAnda };
  }
  function pintarPista(c, est, escondida) {
    for (const n of NAIPES) { const el = $(`cavalo-${n}`); if (el) el.style.setProperty('--pos', est.pos[n]); }
    document.querySelectorAll('.pista-lateral').forEach((el) => {
      const i = Number(el.dataset.casa);
      const html = i === escondida ? '<div class="carta-jogo vazia"></div>'
        : est.viradas.has(i) ? carta(c.laterais[i - 1], c.lateraisValor[i - 1], 'lateral-virada') : '<div class="carta-jogo verso"></div>';
      if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
    });
    const saiu = $('corrida-saiu');
    const u = est.ultimaAnda;
    const html = u ? carta(u.naipe, u.valor, 'saiu-carta') : '<div class="carta-jogo vazia"></div>';
    if (saiu && saiu.dataset.html !== html) { saiu.dataset.html = html; saiu.innerHTML = html; }
  }

  function quadroCorrida() {
    const c = corridaAtual;
    if (!c || !c.eventos) return;
    // Pausada pela Maldição: o relógio da corrida fica parado.
    const agora = c.pausadaEm ? Math.min(PV.relogio.agora(), c.pausadaEm) : PV.relogio.agora();
    const T = agora - c.inicioEm - c.preparoMs;
    if (T < 0) {
      const chave = `pre:${Math.ceil(-T / 1000)}`;
      if (chave !== corridaFase) { corridaFase = chave; esconderVoadora(); pintarPista(c, estadoAte(c, 0, false)); $('corrida-aviso').textContent = `Largada em ${Math.ceil(-T / 1000)}…`; }
      return;
    }
    let k = -1;
    for (let i = 0; i < c.eventos.length; i++) { if (c.eventos[i].t <= T) k = i; else break; }
    const e = c.eventos[k];
    const dt = T - e.t;
    const fimDaCarta = dt >= c.duracao[e.tipo];
    const fase = fimDaCarta ? 'fim' : faseDe(e, dt);
    const chave = `${k}:${fase}`;
    if (chave === corridaFase) return;
    const anterior = corridaFase;
    corridaFase = chave;
    const novaCarta = !anterior.startsWith(`${k}:`);
    const moveu = fase === 'move' || fase === 'fim';
    const est = estadoAte(c, k, moveu);
    const aviso = $('corrida-aviso');
    if (e.tipo === 'anda') {
      pintarPista(c, moveu ? est : { ...est, ultimaAnda: estadoAte(c, k, false).ultimaAnda });
      if (fase === 'surge' || (novaCarta && !moveu)) {
        cartaVoadora(e.naipe, e.valor);
        const cg = centroGrande();
        voar({ left: cg.left + cg.width * 0.35, top: cg.top + cg.height * 0.35, width: cg.width * 0.3, height: cg.height * 0.3 }, { instantaneo: true, frente: false });
      }
      if (fase === 'mostra' || fase === 'segura') voar(centroGrande(), { frente: true });
      if (fase === 'canto') voar(caixa($('corrida-saiu')), { frente: true });
      if (moveu) esconderVoadora();
      aviso.textContent = moveu ? `${NOME_NAIPE[e.naipe]} avança!` : fase === 'surge' ? 'Virando a carta…' : `Saiu ${e.valor} de ${NOME_NAIPE[e.naipe]}!`;
      if (fase === 'move') { const el = $(`cavalo-${e.naipe}`); if (el) { el.classList.remove('pulo', 'tombo'); void el.offsetWidth; el.classList.add('pulo'); } }
    } else {
      const slot = document.querySelector(`.pista-lateral[data-casa="${e.casa}"]`);
      if (!moveu && (fase === 'sobe' || novaCarta)) {
        cartaVoadora(e.naipe, e.valor);
        voar(caixa(slot), { instantaneo: true, frente: false });
      }
      pintarPista(c, est, moveu ? null : e.casa);
      if (fase === 'sobe') requestAnimationFrame(() => voar(centroGrande(), { frente: false }));
      if (fase === 'desvira' || fase === 'segura') voar(centroGrande(), { frente: true });
      if (fase === 'volta') voar(caixa(slot), { frente: true });
      if (moveu) esconderVoadora();
      aviso.textContent = moveu ? `${NOME_NAIPE[e.naipe]} volta uma casa!` : fase === 'sobe' ? `Todos passaram da casa ${e.casa}: a carta vai virar…` : `Casa ${e.casa}: ${e.valor} de ${NOME_NAIPE[e.naipe]}!`;
      if (fase === 'move') { const el = $(`cavalo-${e.naipe}`); if (el) { el.classList.remove('pulo', 'tombo'); void el.offsetWidth; el.classList.add('tombo'); } }
    }
  }
  let apostasTimer = null;
  function desenharCorrida(c) {
    if (!c) return;
    clearInterval(corridaTimer);
    corridaAtual = c;
    const el = $('corrida-telao');
    clearInterval(apostasTimer);
    if (c.estado === 'fechada') {
      corridaChave = '';
      esconderVoadora();
      el.innerHTML = `<h1 class="terror corrida-titulo">Corrida de Cavalos 🏇</h1><p class="prev-dica">As apostas abrem em breve…</p>`;
      return;
    }
    if (c.estado === 'apostas') {
      corridaChave = '';
      esconderVoadora();
      el.innerHTML = `<h1 class="terror corrida-titulo">Corrida de Cavalos 🏇</h1>
        <p class="prev-dica">Escolha seu cavalo no celular e toque em <b>Salvar</b> · 1º lugar +${pts(c.premios[0])} · 2º +${pts(c.premios[1])} · último: shot!</p>
        <div class="apostas-relogio"><small>Apostas fecham em</small><b id="apostas-seg">1:00</b></div>
        <div class="contador-votos">✅ <b>${c.total}</b> ${c.total === 1 ? 'confirmado' : 'confirmados'}</div>
        <div class="apostas-grade">${NAIPES.map((n) => `<div class="aposta-coluna">${carta(n, 'A', 'grande')}
          <b class="aposta-nome">${NOME_NAIPE[n]}</b><span class="aposta-conta">${(c.apostas[n] || []).length}</span>
          <div class="aposta-bolhas">${(c.apostas[n] || []).map((p) => `<span class="mini-bolha"><span class="avatar mini">${emoji(p.avatar)}</span>${esc(p.iniciais)}</span>`).join('')}</div>
        </div>`).join('')}</div>`;
      const relogio = () => {
        const ms = Math.max(0, (c.fechaEm || 0) - PV.relogio.agora());
        const seg = Math.ceil(ms / 1000);
        const b = $('apostas-seg');
        if (b) { b.textContent = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`; b.classList.toggle('acabando', seg <= 10); }
        if (ms <= 0) { clearInterval(apostasTimer); if (window.PVTelaoRecarregar) setTimeout(window.PVTelaoRecarregar, 800); }
      };
      clearInterval(apostasTimer);
      relogio();
      apostasTimer = setInterval(relogio, 250);
      return;
    }
    // correndo ou fim: monta a pista uma vez por corrida
    const chave = `${c.rodada}:${c.inicioEm}`;
    if (chave !== corridaChave) { corridaChave = chave; corridaFase = ''; montarPista(c); }
    if (c.estado === 'correndo') {
      corridaFase = '';
      quadroCorrida();
      corridaTimer = setInterval(quadroCorrida, 50);
      clearTimeout(corridaFim);
      if (window.PVTelaoRecarregar && !c.pausadaEm) corridaFim = setTimeout(window.PVTelaoRecarregar, Math.max(500, c.fimEm - PV.relogio.agora() + 400));
      return;
    }
    // fim: pista no lugar final + resultado
    corridaFase = '';
    quadroCorrida();
    esconderVoadora();
    const ord = c.ordem || [];
    const res = document.createElement('div');
    res.className = 'corrida-resultado';
    res.innerHTML = `<div class="res-linha primeiro">${carta(ord[0], 'A')}<div><b>1º ${NOME_NAIPE[ord[0]]}</b><small>+${pts(c.premios[0])} para: ${c.ganhadores.length ? esc(c.ganhadores.join(', ')) : 'ninguém apostou'}</small></div></div>
      <div class="res-linha">${carta(ord[1], 'A')}<div><b>2º ${NOME_NAIPE[ord[1]]}</b><small>+${pts(c.premios[1])}</small></div></div>
      <div class="res-linha shot">${(c.ultimos || []).map((n) => carta(n, 'A')).join('')}<div><b>🥃 Último: ${(c.ultimos || []).map((n) => NOME_NAIPE[n]).join(' e ')}</b>
        <small>${c.shot.length ? `Shot para: ${esc(c.shot.join(', '))}` : 'Ninguém apostou nele'}</small></div></div>`;
    const velho = el.querySelector('.corrida-resultado');
    if (velho) velho.remove();
    el.appendChild(res);
    $('corrida-aviso').textContent = '';
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
      desenharLaterais(estado);
      desenharMonstro(estado.monstro);
      desenharCorrida(estado.corrida);
      desenharBeerpong(estado.beerpong);
    },
  };
})();
