// Tela do convidado: bloqueio, perfil e a página pré-festa.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const telas = ['tela-carregando', 'tela-bloqueio', 'tela-perfil', 'tela-principal'];
  let telaAtual = 'tela-carregando';
  function mostrar(qual) { telaAtual = qual; telas.forEach((t) => $(t).classList.toggle('oculto', t !== qual)); }

  let token = PV.guardado.ler('pv.token');
  let eu = null;
  let avatares = [];
  let estado = null;
  let liberadasAntes = null; // para animar o cadeado quebrando só no que acabou de abrir
  let socket = null;

  const emojiDe = (id) => (avatares.find((a) => a.id === id) || {}).emoji || '❔';

  function bloquear() {
    PV.guardado.apagar('pv.token');
    token = null;
    if (socket) socket.disconnect();
    mostrar('tela-bloqueio');
  }

  async function api(metodo, url, corpo) {
    try {
      return await PV.chamar(metodo, url, { token, corpo });
    } catch (erro) {
      if (erro.status === 401) bloquear();
      throw erro;
    }
  }

  // ---------------------------------------------------------------- perfil
  let escolhido = null;
  function desenharAvatares() {
    $('grade-avatares').innerHTML = avatares.map((a) => `
      <button type="button" class="opcao-avatar" role="radio" aria-checked="${a.id === escolhido}" data-id="${a.id}">
        <span>${a.emoji}</span>${PV.esc(a.nome)}
      </button>`).join('');
  }
  $('grade-avatares').addEventListener('click', (e) => {
    const b = e.target.closest('.opcao-avatar');
    if (!b) return;
    escolhido = b.dataset.id;
    desenharAvatares();
  });

  function abrirPerfil(editando) {
    escolhido = eu.avatar;
    $('apelido').value = eu.apelido || '';
    $('exibir').checked = eu.exibir !== false;
    $('perfil-saudacao').textContent = editando
      ? 'Mude como você aparece na festa.'
      : `Olá, ${eu.nome.split(' ')[0]}! Escolha como você vai aparecer na festa.`;
    $('salvar-perfil').textContent = editando ? 'Salvar' : 'Entrar na festa';
    $('cancelar-perfil').classList.toggle('oculto', !editando);
    desenharAvatares();
    mostrar('tela-perfil');
    window.scrollTo(0, 0);
  }

  $('form-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!escolhido) return PV.avisar('Escolha um monstro.', 'erro');
    const botao = $('salvar-perfil');
    botao.disabled = true;
    try {
      const r = await api('PUT', '/api/eu/perfil', { apelido: $('apelido').value, avatar: escolhido, exibir: $('exibir').checked });
      eu = r.eu;
      await carregarFesta();
      mostrar('tela-principal');
      PV.avisar('Perfil salvo.', 'ok');
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
    } finally {
      botao.disabled = false;
    }
  });
  $('cancelar-perfil').addEventListener('click', () => mostrar('tela-principal'));
  $('botao-eu').addEventListener('click', () => abrirPerfil(true));

  // ------------------------------------------------------------- principal
  async function carregarFesta() {
    const r = await api('GET', '/api/festa');
    PV.relogio.sincronizar(r.agora);
    estado = r;
    desenhar();
  }

  function desenhar() {
    if (!estado || !eu) return;
    $('eu-avatar').textContent = emojiDe(eu.avatar);
    $('eu-apelido').textContent = eu.apelido || '';
    $('hero-data').textContent = PV.dataHora(estado.festa.inicioMs, { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
    tic();

    const agora = PV.relogio.agora();
    const liberadasAgora = new Set(estado.atividades.filter((a) => a.estado === 'liberada').map((a) => a.id));
    $('atividades').innerHTML = estado.atividades.map((a) => {
      const recem = liberadasAntes && liberadasAgora.has(a.id) && !liberadasAntes.has(a.id);
      if (a.estado === 'liberada') {
        return `<article class="atividade liberada ${recem ? 'recem-aberta' : ''}">
          <div class="icone">${a.icone}</div>
          <div><div class="nome">${PV.esc(a.nome)}</div><div class="quando">Liberado</div></div>
        </article>`;
      }
      const quando = a.abreEm && a.abreEm > agora ? `Abre ${PV.dataCurta(a.abreEm)}` : 'Abre na festa';
      return `<article class="atividade bloqueada">
        <div class="icone">🔒</div>
        <div><div class="nome">${PV.esc(a.enigma)}</div><div class="quando">${PV.esc(quando)}</div></div>
      </article>`;
    }).join('');
    liberadasAntes = liberadasAgora;

    const f = estado.festa;
    const itens = [['Quando', PV.dataHora(f.inicioMs, { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })],
      ['Onde', f.local], ['Dress code', f.dressCode], ['O que levar', f.oQueLevar], ['Regras da casa', f.regras]]
      .filter(([, v]) => v);
    $('info').innerHTML = itens.map(([k, v]) => `<div><dt>${PV.esc(k)}</dt><dd>${PV.esc(v)}</dd></div>`).join('');

    $('total-confirmados').textContent = `(${estado.confirmados.length})`;
    $('confirmados').innerHTML = estado.confirmados.length
      ? estado.confirmados.map((c) => `<div class="confirmado ${c.id === eu.id ? 'sou-eu' : ''}">
          <span class="avatar">${emojiDe(c.avatar)}</span><span>${PV.esc(c.apelido)}</span></div>`).join('')
      : '<p class="fraco">Ninguém por aqui ainda… seja o primeiro.</p>';
  }

  const dois = (n) => String(n).padStart(2, '0');
  function tic() {
    if (!estado) return;
    const c = PV.contagem(estado.festa.inicioMs - PV.relogio.agora());
    $('relogio').classList.toggle('oculto', c.acabou);
    $('hero-sub').classList.toggle('oculto', c.acabou);
    $('portoes').classList.toggle('oculto', !c.acabou);
    if (!c.acabou) {
      $('r-dias').textContent = c.dias;
      $('r-horas').textContent = dois(c.horas);
      $('r-min').textContent = dois(c.minutos);
      $('r-seg').textContent = dois(c.segundos);
    }
  }
  setInterval(tic, 1000);

  // ------------------------------------------------------------------ início
  async function iniciar() {
    if (!token) return mostrar('tela-bloqueio');
    try {
      const [r, a] = await Promise.all([api('GET', '/api/eu'), PV.chamar('GET', '/api/avatares')]);
      eu = r.eu;
      avatares = a.avatares;
    } catch (erro) {
      if (erro.status === 401) return; // bloquear() já cuidou
      $('tela-carregando').innerHTML = `<p class="mudo" style="text-align:center;padding:24px">${PV.esc(erro.message)}<br><br>
        <button class="botao" onclick="location.reload()">Tentar de novo</button></p>`;
      return;
    }

    if (!eu.perfilCompleto) abrirPerfil(false);

    const recarregar = PV.adiar(() => carregarFesta().catch(() => {}));
    socket = PV.conectar({
      tipo: 'convidado',
      token,
      aoConectar: () => {
        carregarFesta()
          .then(() => { if (eu.perfilCompleto && telaAtual === 'tela-carregando') mostrar('tela-principal'); })
          .catch(() => {});
      },
      aoNegar: bloquear,
      eventos: {
        atualizar: recarregar,
        'sessao:encerrada': bloquear,
      },
    });
  }

  iniciar();
})();
