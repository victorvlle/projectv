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
  // Sala de espera (monstros com as iniciais flutuando) → preparar → pergunta → resposta certa → … → placar.
  // O servidor manda a fase e quando ela acaba; o telão busca de novo logo depois de cada troca.
  let relogio = null;
  let troca = null;
  const vistos = new Set();
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
        ${q.fase === 'sala' ? '<p class="prev-dica">No site da festa: <b>Quiz Relâmpago → Entrar na sala</b></p>' : '<div class="quiz-cronometro" data-tq-seg></div>'}
        <div class="sala-bolhas">${bolhas || '<p class="prev-dica">Esperando o primeiro corajoso…</p>'}</div>`;
    } else if (q.fase === 'fim') {
      $('quiz-rotulo').textContent = 'Quiz de Terror Relâmpago';
      $('quiz-pergunta').textContent = 'Fim do quiz! 🏁';
      $('quiz-opcoes').innerHTML = '';
      $('quiz-rodape').innerHTML = (q.placar || []).length
        ? `<div class="quiz-placar-telao">${q.placar.map((p) => `<div class="linha-placar"><span class="pos">${['🥇', '🥈', '🥉'][p.posicao - 1] || `${p.posicao}º`}</span>
            <span class="avatar">${emoji(p.avatar)}</span><span class="n">${esc(p.nome)}</span><span class="pts">${p.acertos} ${p.acertos === 1 ? 'acerto' : 'acertos'} · +${pts(p.pontos)}</span></div>`).join('')}</div>`
        : '<p class="prev-dica">Ninguém acertou nenhuma! 💀</p>';
    } else {
      const x = q.atual;
      const revelada = q.fase === 'revelacao';
      $('quiz-rotulo').textContent = `Pergunta ${x.numero} de ${q.total}`;
      $('quiz-pergunta').textContent = x.texto;
      const total = revelada ? x.porOpcao.reduce((a, b) => a + b, 0) || 1 : 1;
      $('quiz-opcoes').innerHTML = x.opcoes.map((o, i) => `<div class="quiz-op-telao op${i} ${revelada ? (i === x.correta ? 'certa' : 'errada') : ''}">
          <b>${L[i]}</b><span>${esc(o)}</span>${revelada ? `<em>${x.porOpcao[i]}</em><i style="width:${Math.round((x.porOpcao[i] / total) * 100)}%"></i>` : ''}</div>`).join('');
      $('quiz-rodape').innerHTML = revelada
        ? `${x.acertaram.length ? `<p class="quiz-acertaram">Acertaram (+500): ${x.acertaram.map((a) => `<span><span class="avatar mini">${emoji(a.avatar)}</span>${esc(a.nome)}</span>`).join('')}</p>`
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
