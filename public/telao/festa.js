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
  function bpSorteio(b) {
    const agora = PV.relogio.agora();
    const k = Math.floor((agora - b.sorteioEm) / b.passoMs) + 1;
    const mostrados = b.revelacao.slice(0, Math.max(0, k));
    const ultimo = mostrados[mostrados.length - 1];
    $('bp-telao').innerHTML = `<h1 class="terror bp-titulo">Sorteio dos times 🍺</h1>
      <div class="bp-times">${b.chave.times.map((t) => `<div class="bp-time-card ${ultimo && ultimo.time === t.id ? 'recebendo' : ''}">
        <div class="bp-time-nome">${t.emoji} ${esc(t.nome)}</div>
        <div class="bp-membros">${mostrados.filter((m) => m.time === t.id).map((m) => `<span class="bp-membro ${m === ultimo ? 'caiu' : ''}">
          <span class="avatar mini">${emoji(m.avatar)}</span>${esc(m.nome)}</span>`).join('') || '<span class="bp-vazio">…</span>'}</div></div>`).join('')}</div>
      <p class="prev-dica">${k < b.revelacao.length ? `${Math.max(0, k)} de ${b.revelacao.length} sorteados…` : 'Times formados! Agora a chave…'}</p>`;
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
    const fimSorteio = b.sorteioEm + b.revelacao.length * b.passoMs + 2500;
    if (PV.relogio.agora() < fimSorteio) {
      bpSorteio(b);
      bpTimer = setInterval(() => { if (PV.relogio.agora() >= fimSorteio) { clearInterval(bpTimer); bpChave(b); } else bpSorteio(b); }, 200);
      return;
    }
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
  let corridaPasso = -2;
  let corridaChave = '';
  let corridaFim = null;
  function montarPista(c) {
    const casas = Array.from({ length: c.casas }, (_, i) => `<div class="pista-lateral" data-casa="${i + 1}"><div class="carta-jogo verso"></div></div>`).join('');
    $('corrida-telao').innerHTML = `<div class="corrida-topo"><h1 class="terror corrida-titulo">Corrida de Cavalos 🏇</h1>
        <div class="corrida-saiu" id="corrida-saiu"></div></div>
      <div class="pista" style="--casas:${c.casas + 2}">
        <div class="pista-linha pista-laterais"><div></div>${casas}<div class="pista-chegada-rotulo">🏁</div></div>
        ${NAIPES.map((n) => `<div class="pista-linha raia" data-naipe="${n}">
          <div class="raia-fundo">${Array.from({ length: c.casas + 2 }, (_, i) => `<div class="raia-casa ${i === c.casas + 1 ? 'chegada' : ''}"></div>`).join('')}</div>
          <div class="cavalo" id="cavalo-${n}">${carta(n, 'A', 'cavalo-carta')}<small>${(c.apostas[n] || []).length}</small></div>
        </div>`).join('')}
      </div>
      <p class="corrida-aviso" id="corrida-aviso"></p>`;
  }
  function estadoNoPasso(c, k) {
    const pos = { espadas: 0, copas: 0, ouros: 0, paus: 0 };
    const viradas = new Set();
    let ultimo = null;
    for (const e of c.eventos.slice(0, k)) {
      if (e.tipo === 'anda') pos[e.naipe] += 1;
      else { viradas.add(e.casa); if (pos[e.naipe] > 0) pos[e.naipe] -= 1; }
      ultimo = e;
    }
    return { pos, viradas, ultimo };
  }
  function quadroCorrida() {
    const c = corridaAtual;
    if (!c || !c.eventos) return;
    const agora = PV.relogio.agora();
    const t = agora - c.inicioEm - c.preparoMs;
    const k = t < 0 ? -1 : Math.min(c.eventos.length, Math.floor(t / c.passoMs) + 1);
    if (k === corridaPasso) {
      if (t < 0) $('corrida-aviso').textContent = `Largada em ${Math.ceil(-t / 1000)}…`;
      return;
    }
    corridaPasso = k;
    const { pos, viradas, ultimo } = estadoNoPasso(c, Math.max(0, k));
    for (const n of NAIPES) {
      const el = $(`cavalo-${n}`);
      if (el) el.style.setProperty('--pos', pos[n]);
    }
    document.querySelectorAll('.pista-lateral').forEach((el) => {
      const i = Number(el.dataset.casa);
      if (viradas.has(i) && !el.classList.contains('virada')) {
        el.classList.add('virada');
        el.innerHTML = carta(c.laterais[i - 1], c.lateraisValor[i - 1]);
      }
    });
    if (k < 0) { $('corrida-aviso').textContent = 'Largada em…'; return; }
    if (ultimo) {
      $('corrida-saiu').innerHTML = ultimo.tipo === 'anda'
        ? `<small>Saiu</small>${carta(ultimo.naipe, ultimo.valor, 'saiu-carta')}`
        : `<small>Casa ${ultimo.casa} virou</small>${carta(ultimo.naipe, ultimo.valor, 'saiu-carta volta')}`;
      $('corrida-aviso').textContent = ultimo.tipo === 'anda' ? `${NOME_NAIPE[ultimo.naipe]} avança!` : `${NOME_NAIPE[ultimo.naipe]} volta uma casa!`;
      const el = $(`cavalo-${ultimo.naipe}`);
      if (el) { el.classList.remove('pulo', 'tombo'); void el.offsetWidth; el.classList.add(ultimo.tipo === 'anda' ? 'pulo' : 'tombo'); }
    } else {
      $('corrida-aviso').textContent = 'Largada!';
    }
  }
  function desenharCorrida(c) {
    if (!c) return;
    clearInterval(corridaTimer);
    corridaAtual = c;
    const el = $('corrida-telao');
    if (c.estado === 'fechada') {
      corridaChave = '';
      el.innerHTML = `<h1 class="terror corrida-titulo">Corrida de Cavalos 🏇</h1><p class="prev-dica">As apostas abrem em breve…</p>`;
      return;
    }
    if (c.estado === 'apostas') {
      corridaChave = '';
      el.innerHTML = `<h1 class="terror corrida-titulo">Corrida de Cavalos 🏇</h1>
        <p class="prev-dica">Escolha seu cavalo no celular · 1º lugar +${pts(c.premios[0])} · 2º +${pts(c.premios[1])} · último: shot!</p>
        <div class="contador-votos">🎟️ <b>${c.total}</b> ${c.total === 1 ? 'aposta' : 'apostas'}</div>
        <div class="apostas-grade">${NAIPES.map((n) => `<div class="aposta-coluna">${carta(n, 'A', 'grande')}
          <b class="aposta-nome">${NOME_NAIPE[n]}</b><span class="aposta-conta">${(c.apostas[n] || []).length}</span>
          <div class="aposta-bolhas">${(c.apostas[n] || []).map((p) => `<span class="mini-bolha"><span class="avatar mini">${emoji(p.avatar)}</span>${esc(p.iniciais)}</span>`).join('')}</div>
        </div>`).join('')}</div>`;
      return;
    }
    // correndo ou fim: monta a pista uma vez por corrida
    const chave = `${c.rodada}:${c.inicioEm}`;
    if (chave !== corridaChave) { corridaChave = chave; corridaPasso = -2; montarPista(c); }
    if (c.estado === 'correndo') {
      quadroCorrida();
      corridaTimer = setInterval(quadroCorrida, 100);
      clearTimeout(corridaFim);
      if (window.PVTelaoRecarregar) corridaFim = setTimeout(window.PVTelaoRecarregar, Math.max(500, c.fimEm - PV.relogio.agora() + 400));
      return;
    }
    // fim: pista no lugar final + resultado
    corridaPasso = -2;
    quadroCorrida();
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
