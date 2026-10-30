// Telão: a Maldição por cima de qualquer cena.
//
// O servidor manda { id, sorteadaEm, fases, nome, avatar, castigo, roleta }. As fases são
// calculadas pelo relógio do servidor (PV.relogio), então todos os telões ficam sincronizados
// e um telão que reconecta no meio continua da fase certa, sem repetir o som.
//
// Som: navegadores só tocam áudio depois de um clique na página. O botão "Ativar som"
// cria o AudioContext; daí em diante a risada e os efeitos tocam sozinhos. Se o som falhar
// (ou não for ativado), a animação segue normalmente.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const palco = $('maldicao');
  const emojiDe = (id) => (window.PVTelao ? window.PVTelao.emojiDe(id) : '💀');

  // ---------------------------------------------------------------- áudio
  let audio = null;
  const botaoSom = $('ativar-som');
  function mostrarBotaoSom() { if (!audio) botaoSom.classList.remove('oculto'); }
  botaoSom.addEventListener('click', () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audio = new Ctx();
      audio.resume();
      sino(0.35);
      botaoSom.textContent = '🔊 Som ativado';
      setTimeout(() => botaoSom.classList.add('oculto'), 1500);
    } catch (_) { botaoSom.textContent = 'Som indisponível'; }
  });

  function seguro(fn) {
    if (!audio) return;
    try { if (audio.state === 'suspended') audio.resume(); fn(audio, audio.currentTime + 0.02); } catch (_) { /* sem som, segue a animação */ }
  }

  // Risada de bruxa sintetizada: "rá-rá-rá" agudo, descendo, com vibrato e um filtro de voz.
  function risada() {
    seguro((ctx, t0) => {
      const saida = ctx.createGain(); saida.gain.value = 0.55; saida.connect(ctx.destination);
      const voz = ctx.createBiquadFilter(); voz.type = 'bandpass'; voz.frequency.value = 1400; voz.Q.value = 3; voz.connect(saida);
      const voz2 = ctx.createBiquadFilter(); voz2.type = 'bandpass'; voz2.frequency.value = 2600; voz2.Q.value = 5; voz2.connect(saida);
      const vib = ctx.createOscillator(); vib.frequency.value = 22;
      const vibGanho = ctx.createGain(); vibGanho.gain.value = 35; vib.connect(vibGanho);
      const n = 9;
      for (let i = 0; i < n; i++) {
        const ini = t0 + i * 0.17;
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        const base = 980 - i * 38;
        o.frequency.setValueAtTime(base * 1.25, ini);
        o.frequency.exponentialRampToValueAtTime(base * 0.8, ini + 0.13);
        vibGanho.connect(o.frequency);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, ini);
        g.gain.exponentialRampToValueAtTime(0.9, ini + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, ini + 0.14);
        o.connect(g); g.connect(voz); g.connect(voz2);
        o.start(ini); o.stop(ini + 0.16);
      }
      vib.start(t0); vib.stop(t0 + n * 0.17 + 0.2);
      trovao(ctx, t0, 0.5);
    });
  }

  // Ruído grave (trovão) para dar peso ao alerta.
  function trovao(ctx, t0, volume) {
    const dur = 2.2;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = volume;
    src.connect(lp); lp.connect(g); g.connect(ctx.destination);
    src.start(t0);
  }

  // Sino/gongo na revelação.
  function sino(volume = 0.6) {
    seguro((ctx, t0) => {
      [196, 293.7, 392, 587].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = i ? 'sine' : 'triangle'; o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(volume / (i + 1), t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
        o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 2.7);
      });
    });
  }

  function tique(agudo) {
    seguro((ctx, t0) => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = agudo ? 1200 : 800;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.1);
    });
  }

  // -------------------------------------------------------------- bruxa
  // Ilustração própria: bruxa na vassoura cruzando a lua, num anel de alerta.
  $('bruxa').innerHTML = `<svg viewBox="0 0 400 400" role="img" aria-label="Bruxa voando na frente da lua">
    <circle cx="200" cy="200" r="190" fill="none" stroke="#FF3355" stroke-width="10" class="anel"/>
    <circle cx="200" cy="200" r="170" fill="none" stroke="#FF3355" stroke-width="3" stroke-dasharray="14 12" class="anel2"/>
    <circle cx="205" cy="190" r="128" fill="#F3ECF8"/>
    <circle cx="255" cy="140" r="20" fill="#DED4E8"/><circle cx="160" cy="240" r="13" fill="#DED4E8"/><circle cx="250" cy="262" r="9" fill="#DED4E8"/>
    <g class="voo" fill="#120D17">
      <path d="M92 268 L322 196" stroke="#120D17" stroke-width="8" stroke-linecap="round"/>
      <path d="M100 264 L58 248 L52 262 L36 262 L46 274 L32 284 L58 284 L52 300 L104 278 Z"/>
      <path d="M178 248 Q140 236 110 250 Q138 252 148 262 Q126 272 118 290 Q156 272 188 258 Z"/>
      <path d="M174 252 Q168 208 194 190 L216 188 Q234 206 230 242 Q204 256 174 252 Z"/>
      <path d="M200 248 Q220 264 242 258 L240 268 Q214 274 194 260 Z"/>
      <path d="M214 206 Q240 210 258 222 L254 231 Q234 221 210 217 Z"/>
      <circle cx="210" cy="178" r="15"/>
      <path d="M222 174 L242 182 L222 186 Z"/>
      <path d="M197 180 Q184 198 188 216 Q196 198 204 187 Z"/>
      <ellipse cx="208" cy="165" rx="32" ry="6"/>
      <path d="M190 164 L228 164 L216 110 Q208 96 194 92 Q206 110 201 124 Z"/>
    </g>
  </svg>`;

  // ------------------------------------------------------------ controle
  let atual = null;
  let timer = null;
  let ultimaFase = null;
  let ultimoSeg = null;
  let roletaI = 0;
  let proximaTroca = 0;

  function mostrarFase(f) {
    palco.querySelectorAll('.fase').forEach((el) => el.classList.toggle('ativa', el.classList.contains(`fase-${f}`)));
    palco.dataset.fase = f;
  }

  // Desafio de foto: depois de alguns segundos da revelação, o telão abre o Mural esperando a foto.
  const REVELA_FOTO_MS = 7000;
  const FOTO_NA_TELA_MS = 15000;
  function faseDe(m, agora) {
    const t = agora - m.sorteadaEm;
    if (t < m.fases.alerta) return 'alerta';
    if (t < m.fases.alerta + m.fases.suspense) return 'suspense';
    if (m.foto && t >= m.fases.alerta + m.fases.suspense + REVELA_FOTO_MS) return 'mural';
    return 'revela';
  }

  // ------------------------------------------------- mural esperando a foto
  let fotoMostrada = null; // id da foto já na tela
  let fimFoto = null;
  let resolvidaPendente = null;
  function esperandoFoto() {
    $('mm-quadro').innerHTML = `<div class="mm-espera"><div class="mm-camera" aria-hidden="true">📸</div>
      <p>Aguardando a foto…</p></div>`;
    $('mm-quadro').classList.remove('com-foto');
    $('mm-castigo').classList.remove('oculto');
    $('mm-canto').classList.remove('oculto');
  }
  function mostrarFotoDaMaldicao(m) {
    if (!m.fotoId || fotoMostrada === m.fotoId) return;
    fotoMostrada = m.fotoId;
    const token = window.PVTelao ? window.PVTelao.token() : null;
    PV.foto(`/api/admin/correio/foto/${m.fotoId}`, token).then((src) => {
      if (!atual || atual.id !== m.id) return;
      $('mm-quadro').innerHTML = '<div class="mural-moldura"><img alt="Foto do desafio"></div>';
      $('mm-quadro').querySelector('img').src = src;
      $('mm-quadro').classList.add('com-foto');
      $('mm-castigo').classList.add('oculto');
      $('mm-canto').classList.add('oculto');
      sino(0.35);
      clearTimeout(fimFoto);
      fimFoto = setTimeout(() => {
        fimFoto = null;
        if (resolvidaPendente) { const r = resolvidaPendente; resolvidaPendente = null; resolvida(r); } else esconder();
      }, FOTO_NA_TELA_MS);
    }).catch(() => { fotoMostrada = null; });
  }
  function foto({ id, fotoId }) {
    if (!atual || atual.id !== id) return;
    atual = { ...atual, fotoId };
    if (palco.dataset.fase === 'mural') mostrarFotoDaMaldicao(atual);
  }

  function quadro() {
    if (!atual) return;
    const agora = PV.relogio.agora();
    const m = atual;
    const fase = faseDe(m, agora);
    const aoVivo = agora - m.sorteadaEm < 1500; // só toca som se pegou o começo da fase
    if (fase !== ultimaFase) {
      if (fase === 'alerta' && aoVivo) risada();
      if (fase === 'revela' && ultimaFase === 'suspense') sino();
      if (fase === 'mural') { esperandoFoto(); ultimoSeg = null; }
      ultimaFase = fase;
      mostrarFase(fase);
      if (fase === 'mural' && m.fotoId) mostrarFotoDaMaldicao(m);
    }
    if (fase === 'suspense') {
      // Roleta: começa rápida e vai freando até a revelação.
      const resta = m.sorteadaEm + m.fases.alerta + m.fases.suspense - agora;
      if (agora >= proximaTroca) {
        roletaI = (roletaI + 1) % Math.max(1, m.roleta.length);
        $('roleta-atual').textContent = emojiDe(m.roleta[roletaI] || m.avatar);
        $('roleta-atual').classList.remove('pula'); void $('roleta-atual').offsetWidth; $('roleta-atual').classList.add('pula');
        const passo = resta > 2500 ? 90 : resta > 1200 ? 170 : 320;
        proximaTroca = agora + passo;
        if (resta < 1500) tique(false);
      }
    }
    if (fase === 'mural') {
      if (palco.dataset.fase === 'mural' && m.fotoId) mostrarFotoDaMaldicao(m);
      const fim = m.sorteadaEm + m.fases.alerta + m.fases.suspense + m.fases.cumprir;
      const seg = Math.max(0, Math.ceil((fim - agora) / 1000));
      if (!fotoMostrada && seg !== ultimoSeg) {
        ultimoSeg = seg;
        $('mm-seg').textContent = seg;
        $('mm-rotulo').textContent = seg ? (seg === 1 ? 'segundo' : 'segundos') : 'Tempo!';
        palco.classList.toggle('acabando', seg > 0 && seg <= 10);
        if (seg > 0 && seg <= 5) tique(true);
      }
      if (!fotoMostrada && agora > fim + 2 * 60 * 1000) esconder();
    }
    if (fase === 'revela') {
      const fim = m.sorteadaEm + m.fases.alerta + m.fases.suspense + m.fases.cumprir;
      const seg = Math.max(0, Math.ceil((fim - agora) / 1000));
      if (seg !== ultimoSeg) {
        ultimoSeg = seg;
        $('revela-seg').textContent = seg;
        $('revela-rotulo').textContent = seg ? (seg === 1 ? 'segundo para cumprir' : 'segundos para cumprir') : 'Tempo! O organizador confirma.';
        palco.classList.toggle('acabando', seg > 0 && seg <= 10);
        if (seg > 0 && seg <= 5) tique(true);
      }
      // Ninguém confirmou: sai de cena 2 min depois do fim.
      if (agora > fim + 2 * 60 * 1000) esconder();
    }
  }

  function iniciar(m) {
    if (!m) return;
    if (atual && atual.id === m.id) return; // mesmo sorteio (reconexão): não reinicia
    atual = m;
    ultimaFase = null; ultimoSeg = null; roletaI = 0; proximaTroca = 0;
    $('revela-avatar').textContent = emojiDe(m.avatar);
    $('revela-nome').textContent = m.parceiro ? `${m.nome} e ${m.parceiro.nome}` : m.nome;
    $('revela-parceiro').classList.toggle('oculto', !m.parceiro);
    if (m.parceiro) $('revela-parceiro').textContent = emojiDe(m.parceiro.avatar);
    $('revela-castigo').textContent = m.castigo;
    $('mm-avatar').textContent = emojiDe(m.avatar);
    $('mm-nome').textContent = m.nome;
    $('mm-castigo').textContent = m.castigo;
    fotoMostrada = null; resolvidaPendente = null; clearTimeout(fimFoto); fimFoto = null;
    $('roleta-atual').textContent = emojiDe(m.roleta[0] || m.avatar);
    palco.classList.remove('oculto', 'acabando');
    clearInterval(timer);
    timer = setInterval(quadro, 50);
    quadro();
  }

  function esconder() {
    clearInterval(timer); timer = null;
    clearTimeout(fimFoto); fimFoto = null; fotoMostrada = null; resolvidaPendente = null;
    atual = null;
    palco.classList.add('oculto');
    palco.classList.remove('acabando');
  }

  function resolvida({ id, estado }) {
    if (!atual || atual.id !== id) return;
    // A foto do desafio está na tela: deixa terminar e só depois mostra "cumprida".
    if (fimFoto) { resolvidaPendente = { id, estado }; return; }
    clearInterval(timer); timer = null;
    if (estado === 'cumprida') {
      mostrarFase('cumprida');
      const p = Number(atual.pontos || 500).toLocaleString('pt-BR');
      $('cumprida-pontos').textContent = atual.parceiro ? `+${p} pontos para cada um` : `+${p} pontos`;
      sino(0.4);
      setTimeout(esconder, 4500);
    } else {
      esconder();
    }
  }

  window.PVMaldicao = { iniciar, resolvida, foto, mostrarBotaoSom, esconder, risada };
})();
