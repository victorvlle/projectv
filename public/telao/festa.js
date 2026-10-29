// Telão: cenas do Quiz Relâmpago, do Concurso de Fantasia e do Correio das Trevas.
// Recebe os dados de /api/admin/telao (telao.js chama PVTelaoFesta.desenhar a cada atualização).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = PV.esc;
  const emoji = (id) => (window.PVTelao ? window.PVTelao.emojiDe(id) : '❔');
  const L = ['A', 'B', 'C', 'D'];
  const pts = (n) => Number(n).toLocaleString('pt-BR');

  // ------------------------------------------------------------------ quiz
  let quiz = null;
  let relogio = null;
  function desenharQuiz(q) {
    quiz = q;
    clearInterval(relogio);
    if (!q || !q.atual) {
      $('quiz-rotulo').textContent = 'Quiz de Terror Relâmpago';
      $('quiz-pergunta').textContent = q && q.feitas >= q.total ? 'Fim do quiz!' : 'Prepare o celular…';
      $('quiz-opcoes').innerHTML = '';
      $('quiz-rodape').innerHTML = `<p class="prev-dica">${q && q.feitas >= q.total ? 'Confira o ranking.' : `${q ? q.total : 5} perguntas · uma chance em cada · acertou, +500 pontos`}</p>`;
      return;
    }
    const x = q.atual;
    $('quiz-rotulo').textContent = `Pergunta ${x.ordem} de ${q.total}`;
    $('quiz-pergunta').textContent = x.texto;
    const revelada = x.fase === 'revelada';
    const total = revelada ? x.porOpcao.reduce((a, b) => a + b, 0) || 1 : 1;
    $('quiz-opcoes').innerHTML = x.opcoes.map((o, i) => `<div class="quiz-op-telao op${i} ${revelada ? (i === x.correta ? 'certa' : 'errada') : ''}">
        <b>${L[i]}</b><span>${esc(o)}</span>${revelada ? `<em>${x.porOpcao[i]}</em><i style="width:${Math.round((x.porOpcao[i] / total) * 100)}%"></i>` : ''}</div>`).join('');
    if (revelada) {
      $('quiz-rodape').innerHTML = x.acertaram.length
        ? `<p class="quiz-acertaram">Acertaram (+500): ${x.acertaram.map((a) => `<span><span class="avatar mini">${emoji(a.avatar)}</span>${esc(a.nome)}</span>`).join('')}</p>`
        : '<p class="prev-dica">Ninguém acertou essa! 💀</p>';
      return;
    }
    const tic = () => {
      const resta = Math.max(0, Math.ceil((x.fimEm - PV.relogio.agora()) / 1000));
      $('quiz-rodape').innerHTML = resta > 0
        ? `<div class="quiz-cronometro ${resta <= 5 ? 'acabando' : ''}">${resta}</div><p class="prev-dica">${x.respostas} ${x.respostas === 1 ? 'resposta' : 'respostas'} · responda pelo celular</p>`
        : `<p class="quiz-esgotado terror">Tempo esgotado!</p><p class="prev-dica">${x.respostas} ${x.respostas === 1 ? 'resposta' : 'respostas'} · a resposta certa vem aí…</p>`;
      if (!resta) clearInterval(relogio);
    };
    tic();
    if (x.fase === 'respondendo') relogio = setInterval(tic, 250);
  }

  // -------------------------------------------------------------- concurso
  function desenharConcurso(c) {
    if (!c) return;
    if (c.estado === 'publicado') {
      const podio = c.podio || [];
      // Empate: todos os empatados sobem no mesmo degrau (2º à esquerda, 1º no meio, 3º à direita).
      const ordem = [2, 1, 3].flatMap((pos) => podio.filter((p) => p.posicao === pos));
      const extras = [];
      $('concurso-telao').innerHTML = podio.length ? `<div class="podio">${ordem.map((x) => `<div class="degrau d${x.posicao}">
          <span class="avatar">${emoji(x.avatar)}</span><b>${esc(x.nome)}</b><span class="pts">+${pts(x.pontos)} · ${x.votos} ${x.votos === 1 ? 'voto' : 'votos'}</span>
          <div class="bloco">${x.posicao}º</div></div>`).join('')}</div>
        ${extras.length ? `<p class="prev-dica">Empatados: ${extras.map((x) => `${esc(x.nome)} (${x.posicao}º)`).join(', ')}</p>` : ''}`
        : '<p class="prev-dica">Ninguém recebeu voto.</p>';
      return;
    }
    const txt = { fechado: 'A votação abre em breve. Capriche na pose!', aberto: 'Votação aberta! Vote pelo celular na melhor fantasia.', encerrado: 'Votação encerrada. O resultado vem aí…' }[c.estado];
    $('concurso-telao').innerHTML = `<p class="prev-pergunta" style="font-size:5vh">${txt}</p>
      ${c.estado !== 'fechado' ? `<div class="quiz-cronometro">${c.votos}</div><p class="prev-dica">${c.votos === 1 ? 'voto' : 'votos'}</p>` : ''}
      <p class="prev-dica">1º +${pts(c.premios[0])} · 2º +${pts(c.premios[1])} · 3º +${pts(c.premios[2])}</p>`;
  }

  // --------------------------------------------------------------- correio
  let cartas = [];
  let indice = 0;
  let rodando = null;
  let assinatura = '';
  function mostrarCarta() {
    if (!cartas.length) {
      $('carta-telao').innerHTML = '<p class="prev-dica">Nenhuma carta ainda. Mande a sua pelo celular! ✉️</p>';
      $('correio-rodape').textContent = '';
      return;
    }
    const c = cartas[indice % cartas.length];
    $('carta-telao').innerHTML = `<div class="carta-papel">
        ${c.para ? `<p class="carta-para">Para: ${c.paraAvatar ? `<span class="avatar mini">${emoji(c.paraAvatar)}</span>` : ''}${esc(c.para)}</p>` : '<p class="carta-para">Para: alguém nesta festa…</p>'}
        <p class="carta-corpo">“${esc(c.texto)}”</p><p class="carta-assinatura">— Anônimo 💀</p></div>`;
    $('correio-rodape').textContent = `Carta ${(indice % cartas.length) + 1} de ${cartas.length} · mande a sua pelo celular`;
  }
  function desenharCorreio(k) {
    const nova = k ? k.cartas : [];
    const ass = nova.map((c) => c.id).join(',');
    if (ass === assinatura) return;
    const chegouNova = nova.length && (!cartas.length || nova[0].id !== (cartas[0] || {}).id);
    assinatura = ass;
    cartas = nova;
    if (chegouNova) indice = 0; // a mais nova aparece primeiro
    mostrarCarta();
    clearInterval(rodando);
    rodando = setInterval(() => { indice += 1; mostrarCarta(); }, 9000);
  }

  window.PVTelaoFesta = {
    desenhar(estado) {
      desenharQuiz(estado.quiz);
      desenharConcurso(estado.concurso);
      desenharCorreio(estado.correio);
    },
  };
})();
