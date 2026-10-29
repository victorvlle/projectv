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
  // Um por vez: foto inteira na tela (com a legenda embaixo) ou o recado em papel.
  // Foto fica 12 s, recado 9 s. O que acabou de ser aprovado entra na frente.
  let cartas = [];
  let indice = 0;
  let rodando = null;
  let assinatura = '';
  const tokenTelao = () => (window.PVTelao ? window.PVTelao.token() : null);
  const urlFoto = (c) => `/api/admin/correio/foto/${c.id}`;
  const para = (c) => (c.para ? `<p class="carta-para">Para: ${c.paraAvatar ? `<span class="avatar mini">${emoji(c.paraAvatar)}</span>` : ''}${esc(c.para)}</p>` : '');
  function mostrarCarta() {
    clearTimeout(rodando);
    if (!cartas.length) {
      document.querySelector('[data-cena="correio"]').classList.remove('com-foto');
      $('carta-telao').innerHTML = '<p class="prev-dica">Nada no mural ainda. Mande um recado ou uma foto pelo celular! 📸</p>';
      return;
    }
    const c = cartas[indice % cartas.length];
    // Com foto, o título sai para a foto ocupar a tela.
    document.querySelector('[data-cena="correio"]').classList.toggle('com-foto', Boolean(c.foto));
    if (c.foto) {
      $('carta-telao').innerHTML = `<figure class="mural-foto">${para(c)}<img alt="Foto do mural" data-id="${c.id}">
        ${c.texto ? `<figcaption>“${esc(c.texto)}”</figcaption>` : ''}</figure>`;
      const img = $('carta-telao').querySelector('img');
      PV.foto(urlFoto(c), tokenTelao()).then((src) => { if (img.isConnected) img.src = src; })
        .catch(() => { clearTimeout(rodando); indice += 1; rodando = setTimeout(mostrarCarta, 3000); });
    } else {
      $('carta-telao').innerHTML = `<div class="carta-papel">
          ${c.para ? para(c) : '<p class="carta-para">Para: alguém nesta festa…</p>'}
          <p class="carta-corpo">“${esc(c.texto)}”</p><p class="carta-assinatura">— Anônimo 💀</p></div>`;
    }
    // Já deixa a próxima foto baixada.
    const prox = cartas[(indice + 1) % cartas.length];
    if (prox && prox.foto) PV.foto(urlFoto(prox), tokenTelao()).catch(() => {});
    rodando = setTimeout(() => { indice += 1; mostrarCarta(); }, c.foto ? 12000 : 9000);
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

  window.PVTelaoFesta = {
    desenhar(estado) {
      desenharQuiz(estado.quiz);
      desenharConcurso(estado.concurso);
      desenharCorreio(estado.correio);
    },
  };
})();
