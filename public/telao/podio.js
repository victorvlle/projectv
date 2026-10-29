// Pódio com suspense no telão: revela o 3º, depois o 2º e por último o 1º, com pausas e frases
// de suspense. Usado no Concurso de Fantasia, no placar do Quiz e no Ranking da noite.
//
// montar(el, grupos, { chave, animar }):
//   grupos = [{ posicao: 1|2|3, pessoas: [{ nome, avatar, detalhe }] }]  (empate = várias pessoas no mesmo degrau)
//   chave  = identifica este pódio: com a mesma chave, uma atualização no meio não reinicia a revelação.
//   animar = false mostra tudo de uma vez.
(function () {
  'use strict';
  const esc = PV.esc;
  const emoji = (id) => (window.PVTelao ? window.PVTelao.emojiDe(id) : '❔');
  const estados = new WeakMap(); // el -> { chave, timers, rodando }
  const FRASES = { 3: 'Em 3º lugar…', 2: 'Em 2º lugar…', 1: 'E o grande vencedor é…' };
  const FRASES_EMPATE = { 1: 'E os grandes vencedores são…' };
  const SUSPENSE_MS = 2600; // tempo da frase antes de revelar
  const PAUSA_MS = 1800;    // tempo olhando o revelado antes da próxima frase

  function html(grupos) {
    const ordem = [2, 1, 3].map((pos) => grupos.find((g) => g.posicao === pos)).filter(Boolean);
    return `<p class="podio-suspense" aria-live="polite"></p><div class="podio podio-anim">${ordem.map((g) => `
      <div class="degrau d${g.posicao} escondido" data-pos="${g.posicao}">
        <div class="podio-gente">${g.pessoas.map((p) => `<div class="podio-pessoa"><span class="avatar">${emoji(p.avatar)}</span>
          <b>${esc(p.nome)}</b>${p.detalhe ? `<span class="pts">${esc(p.detalhe)}</span>` : ''}</div>`).join('')}</div>
        <div class="bloco">${g.posicao}º</div></div>`).join('')}</div>`;
  }

  function montar(el, grupos, { chave, animar = true } = {}) {
    const atual = estados.get(el);
    if (atual && atual.chave === chave && (atual.rodando || !animar)) return; // não reinicia nem pisca
    if (atual) atual.timers.forEach(clearTimeout);
    const st = { chave, timers: [], rodando: false };
    estados.set(el, st);
    el.innerHTML = html(grupos);
    const frase = el.querySelector('.podio-suspense');
    const revelar = (pos) => { const d = el.querySelector(`.degrau[data-pos="${pos}"]`); if (d) d.classList.remove('escondido'); d && d.classList.add('revelado'); };
    if (!animar || (atual && atual.chave === chave)) {
      grupos.forEach((g) => revelar(g.posicao));
      return;
    }
    st.rodando = true;
    let t = 400;
    const posicoes = [3, 2, 1].filter((p) => grupos.some((g) => g.posicao === p));
    posicoes.forEach((pos, i) => {
      const g = grupos.find((x) => x.posicao === pos);
      const texto = (g.pessoas.length > 1 && FRASES_EMPATE[pos]) || FRASES[pos];
      st.timers.push(setTimeout(() => { frase.textContent = texto; frase.classList.add('tremendo'); }, t));
      t += pos === 1 ? SUSPENSE_MS + 800 : SUSPENSE_MS;
      st.timers.push(setTimeout(() => {
        frase.classList.remove('tremendo');
        frase.textContent = pos === 1 ? '🎉🏆🎉' : '';
        revelar(pos);
        if (i === posicoes.length - 1) st.rodando = false;
      }, t));
      t += PAUSA_MS;
    });
  }

  window.PVPodio = { montar };
})();
