// Painel da festa: o essencial do admin numa tela só, para usar no celular durante a festa.
// Em cima, "Agora": só o que pede uma ação sua neste momento (maldição para confirmar, próximo jogo do
// Beer Pong, corrida esperando a largada…). Embaixo, o telão e uma linha por jogo com o próximo passo.
// Ações importantes pedem um segundo toque (o botão fica vermelho por 4 s).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = PV.esc;
  let token = PV.guardado.ler('pv.admin');
  let dados = null;
  let avatares = [];
  let socket = null;
  const emojiDe = (id) => (avatares.find((a) => a.id === id) || {}).emoji || '❔';
  const pts = (n) => Number(n).toLocaleString('pt-BR');
  const novoId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

  function sair() {
    PV.guardado.apagar('pv.admin');
    token = null;
    if (socket) socket.disconnect();
    $('tela-painel').classList.add('oculto');
    $('tela-login').classList.remove('oculto');
  }
  async function api(metodo, url, corpo) {
    try {
      return await PV.chamar(metodo, `/api/admin${url}`, { token, corpo });
    } catch (erro) {
      if (erro.status === 401) { sair(); PV.avisar('Sessão expirada. Entre de novo.', 'erro'); }
      throw erro;
    }
  }

  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await PV.chamar('POST', '/api/admin/entrar', { corpo: { senha: $('senha').value } });
      token = r.token;
      PV.guardado.gravar('pv.admin', token);
      $('senha').value = '';
      iniciar();
    } catch (erro) { PV.avisar(erro.message, 'erro'); }
  });

  // ---------------------------------------------------------------- dados
  let carregando = null;
  async function carregar() {
    clearTimeout(carregando);
    carregando = setTimeout(async () => {
      try {
        dados = await api('GET', '/jogos');
        desenhar();
      } catch (_) { /* tenta de novo no próximo aviso */ }
    }, 150);
  }

  // Contagens (regressivas e "há quanto tempo") sem redesenhar a tela.
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function tique() {
    const agora = PV.relogio.agora();
    $('pn-hora').textContent = PV.dataHora ? PV.dataHora(agora, { hour: '2-digit', minute: '2-digit' }) : '';
    document.querySelectorAll('[data-ate]').forEach((el) => { el.textContent = mmss(Number(el.dataset.ate) - agora); });
    document.querySelectorAll('[data-desde]').forEach((el) => { el.textContent = mmss(agora - Number(el.dataset.desde)); });
    if (dados && dados.corrida.estado === 'apostas' && dados.corrida.fechaEm && agora > dados.corrida.fechaEm + 1500 && !tique.pediu) { tique.pediu = true; carregar(); }
    if (dados && dados.corrida.estado !== 'apostas') tique.pediu = false;
  }

  // ------------------------------------------------------------- desenho
  const botao = (acao, texto, { classe = '', id = '', extra = '', desligado = false, confirmar = '' } = {}) =>
    `<button class="botao ${classe}" type="button" data-acao="${acao}" ${id !== '' ? `data-id="${esc(String(id))}"` : ''} ${confirmar ? `data-confirmar="${esc(confirmar)}"` : ''} ${extra} ${desligado ? 'disabled' : ''}>${texto}</button>`;

  const TELAO = [['correio', '📸', 'Mural'], ['ranking', '🏆', 'Ranking'], ['atividades', '🗓️', 'Atrações'], ['confirmados', '👥', 'Galera'],
    ['corrida', '🏇', 'Corrida'], ['beerpong', '🍺', 'Beer Pong'], ['quiz', '⚡', 'Quiz'], ['concurso', '👑', 'Concurso']];

  function blocoAgora(d) {
    const cartoes = [];
    // Maldição esperando você confirmar
    const md = d.maldicao;
    const menos = (n) => `−${pts(Math.abs(n))}`;
    for (const m of md.historico.filter((x) => x.estado === 'sorteada')) {
      if (m.grupo) {
        const opcoes = md.pessoas.map((p) => `<option value="${esc(p.id)}">${emojiDe(p.avatar)} ${esc(p.nome)}</option>`).join('');
        cartoes.push(`<div class="pn-agora mal"><h3>👥 Maldição coletiva <span class="fraco">há <span data-desde="${m.sorteadaEm}"></span></span></h3>
          <p class="mudo">${esc(m.castigo)}</p>
          <label class="pn-rotulo">Último (${menos(md.pontosGrupo.ultimo)} e 2 shots)</label>
          <select class="pn-select" data-grupo="ultimo" data-id="${m.id}"><option value="">— escolha —</option>${opcoes}</select>
          <label class="pn-rotulo">Penúltimo (${menos(md.pontosGrupo.penultimo)} e 1 shot)</label>
          <select class="pn-select" data-grupo="penultimo" data-id="${m.id}"><option value="">— escolha —</option>${opcoes}</select>
          <div class="pn-acoes">${botao('mal-grupo', '✅ Confirmar', { id: m.id })}
            ${botao('mal-cancelar', '✖ Anular', { classe: 'secundario', id: m.id, confirmar: 'Toque de novo: anular' })}</div></div>`);
        continue;
      }
      cartoes.push(`<div class="pn-agora mal"><h3>💀 Maldição em andamento <span class="fraco">há <span data-desde="${m.sorteadaEm}"></span></span></h3>
        <p class="pn-grande">${emojiDe(m.avatar)} ${esc(m.nome)}${m.parceiro ? ` e ${esc(m.parceiro.nome)}` : ''} <span class="pn-perdeu">${menos(md.pontos)}</span></p>
        <p class="mudo">${esc(m.castigo)}</p>
        <div class="pn-acoes">${botao('mal-cumprida', '✅ Cumpriu', { id: m.id })}
          ${botao('mal-falhou', `✖ Não cumpriu (${menos(md.falhouPontos)})`, { classe: 'secundario', id: m.id, confirmar: 'Toque de novo: não cumpriu' })}</div>
        <div class="pn-acoes um">${botao('mal-ausente', '🚶 Não está presente: sortear outra pessoa', { classe: 'secundario', id: m.id, confirmar: 'Toque de novo: sortear outra' })}</div></div>`);
    }
    // Beer Pong: o próximo jogo
    const bp = d.beerpong;
    if (bp.chave && bp.estado === 'chave') {
      const ch = bp.chave;
      const time = (id) => ch.times.find((t) => t.id === id);
      const p = ch.partidas.find((x) => x.id === ch.proxima);
      if (p) {
        const a = time(p.a); const b = time(p.b);
        const ultimo = ch.ultimo ? ch.partidas.find((x) => x.id === ch.ultimo.partida) : null;
        cartoes.push(`<div class="pn-agora"><h3>🍺 Beer Pong · ${esc(ch.nomesRodadas[p.rodada - 1])}</h3>
          <p class="pn-grande">${a.emoji} ${esc(a.nome)} × ${b.emoji} ${esc(b.nome)}</p>
          <p class="fraco">${a.membros.map((m) => esc(m.nome)).join(', ')} × ${b.membros.map((m) => esc(m.nome)).join(', ')}</p>
          <p class="mudo" style="margin-top:8px">Quem passou?</p>
          <div class="pn-acoes">${botao('bp-venceu', `✓ ${a.emoji} ${esc(a.nome)}`, { id: p.id, extra: 'data-lado="a"', confirmar: `Confirmar: ${a.nome}` })}
            ${botao('bp-venceu', `✓ ${b.emoji} ${esc(b.nome)}`, { id: p.id, extra: 'data-lado="b"', confirmar: `Confirmar: ${b.nome}` })}</div>
          ${ultimo && !ultimo.bye ? `<div class="pn-acoes um">${botao('bp-desfazer', `↩ Desfazer o último (${esc((time(ultimo.vencedor) || {}).nome || '')})`, { classe: 'secundario pequeno', id: ultimo.id, confirmar: 'Toque de novo: desfazer' })}</div>` : ''}</div>`);
      }
    }
    // Corrida
    const c = d.corrida;
    if (c.estado === 'apostas') {
      cartoes.push(`<div class="pn-agora"><h3>🏇 Corrida ${c.rodada}: apostas abertas</h3>
        <p>Larga sozinha em <span class="pn-relogio" data-ate="${c.fechaEm}"></span> · <b>${c.total}</b> ${c.total === 1 ? 'confirmado' : 'confirmados'}</p>
        <div class="pn-acoes">${botao('cor-largar', '🏁 Largar agora', { desligado: !c.total, confirmar: 'Toque de novo: LARGAR' })}
          ${botao('cor-cancelar', 'Cancelar corrida', { classe: 'secundario', confirmar: 'Toque de novo: cancelar' })}</div></div>`);
    } else if (c.estado === 'correndo') {
      cartoes.push(`<div class="pn-agora"><h3>🏇 Corrida ${c.rodada} no telão</h3><p>Termina em <span class="pn-relogio" data-ate="${c.fimEm}"></span>. Os pontos saem sozinhos.</p></div>`);
    }
    // Quiz rodando
    const q = d.quiz;
    if (['preparar', 'pergunta', 'revelacao'].includes(q.fase)) {
      cartoes.push(`<div class="pn-agora"><h3>⚡ Quiz no telão</h3><p>Pergunta <b>${(q.indice ?? 0) + 1}</b> de ${q.total} · ${q.sala.length} jogando</p>
        <div class="pn-acoes um">${botao('quiz-encerrar', 'Parar o quiz agora', { classe: 'secundario', confirmar: 'Toque de novo: parar' })}</div></div>`);
    }
    // Concurso: desfile ou votação acontecendo
    const k = d.concurso;
    if (k.estado === 'desfile') {
      cartoes.push(`<div class="pn-agora"><h3>👑 Desfile Macabro no telão</h3><p>${(k.desfilantes || []).length} na fila. Quando o desfile acabar:</p>
        <div class="pn-acoes um">${botao('conc-abrir', '🗳️ Abrir votação')}</div></div>`);
    } else if (k.estado === 'aberto') {
      cartoes.push(`<div class="pn-agora"><h3>👑 Votação da fantasia aberta</h3><p><b>${k.eleitores}</b> ${k.eleitores === 1 ? 'pessoa votou' : 'pessoas votaram'}</p>
        <div class="pn-acoes um">${botao('conc-encerrar', '🔒 Encerrar votação', { confirmar: 'Toque de novo: encerrar' })}</div></div>`);
    } else if (k.estado === 'encerrado') {
      const top = k.contagem.slice(0, 3).map((x) => `${x.posicao}º ${esc(x.nome)} (${x.votos})`).join(' · ');
      cartoes.push(`<div class="pn-agora"><h3>👑 Votação encerrada</h3><p class="fraco">Só você vê: ${top || 'sem votos'}</p>
        <div class="pn-acoes um">${botao('conc-publicar', '🏆 Revelar no telão e dar os pontos', { confirmar: 'Toque de novo: revelar' })}</div></div>`);
    }
    // Mural travado: o próximo esperando aprovação
    const mu = d.correio;
    if (!mu.auto && mu.pendentes) {
      const x = mu.cartas.find((y) => y.estado === 'pendente');
      if (x) {
        cartoes.push(`<div class="pn-agora"><h3>📸 Mural: ${mu.pendentes} ${mu.pendentes === 1 ? 'envio esperando' : 'envios esperando'}</h3>
          <p class="fraco">De ${esc(x.autor)}${x.para ? ` para ${esc(x.para)}` : ''}</p>
          ${x.foto ? `<img class="pn-foto" data-foto="/api/admin/correio/foto/${x.id}" alt="Foto enviada">` : ''}${x.texto ? `<p>${esc(x.texto)}</p>` : ''}
          <div class="pn-acoes">${botao('cor-aprovar', '✅ Aprovar', { id: x.id })}${botao('cor-recusar', '✖ Recusar', { classe: 'secundario', id: x.id })}</div></div>`);
      }
    }
    return cartoes.join('') || '<p class="fraco" style="margin:10px 2px 0">✨ Nada esperando você agora.</p>';
  }

  function linha(emoji, nome, sub, btns, { bloqueado = false, teste = false } = {}) {
    return `<div class="pn-jogo ${bloqueado ? 'bloqueado' : ''}"><span class="pn-emoji">${emoji}</span>
      <div class="pn-info"><div class="pn-nome">${nome} ${teste ? '<span class="pn-selo teste">teste</span>' : ''}</div><div class="pn-sub">${sub}</div></div>
      <div class="pn-btns">${btns}</div></div>`;
  }
  const liberar = (id) => botao('liberar', '🔓 Liberar', { classe: 'secundario', id, confirmar: 'Liberar para todos?' });

  function blocoJogos(d) {
    const l = [];
    const m = d.maldicao;
    l.push(m.liberada
      ? linha('💀', 'Maldição', m.config.ligada ? `<span class="pn-selo on">ligada</span> próxima ~${m.config.proximaEm ? esc(PV.dataHora(m.config.proximaEm, { hour: '2-digit', minute: '2-digit' })) : '—'}` : 'pausada',
        `${botao('mal-ligar', m.config.ligada ? '⏸' : '▶', { classe: 'secundario', id: m.config.ligada ? '0' : '1', extra: `aria-label="${m.config.ligada ? 'Pausar' : 'Ligar'} sorteios"` })}
         ${botao('mal-sortear', 'Sortear', { confirmar: 'De novo: sortear' })}`, { teste: m.emTeste })
      : linha('💀', 'Maldição', 'bloqueada', liberar('maldicao'), { bloqueado: true }));

    const c = d.corrida;
    const subC = { fechada: c.semApostas ? 'ninguém confirmou na última' : `corrida ${c.rodada + 1} pronta`, fim: `corrida ${c.rodada} terminou`,
      apostas: 'apostas abertas', correndo: 'correndo no telão' }[c.estado];
    l.push(!c.liberada ? linha('🏇', 'Corrida', 'bloqueada', liberar('corrida'), { bloqueado: true })
      : linha('🏇', 'Corrida', subC, ['fechada', 'fim'].includes(c.estado) ? botao('cor-apostas', 'Abrir apostas', { confirmar: 'De novo: abrir 1 min' }) : '', { teste: c.emTeste }));

    const bp = d.beerpong;
    let subB = ''; let btnB = '';
    if (bp.estado === 'inscricao') {
      subB = `${bp.inscritos.length} ${bp.inscritos.length === 1 ? 'inscrito' : 'inscritos'}`;
      btnB = botao('bp-sortear', 'Sortear times', { desligado: bp.inscritos.length < bp.minimo, confirmar: 'De novo: sortear' });
    } else if (bp.estado === 'chave') {
      subB = 'chave em andamento';
      btnB = botao('tel', 'No telão', { classe: 'secundario', extra: 'data-modo="beerpong"' });
    } else {
      const ch = bp.chave; const f = ch && ch.partidas.find((p) => p.rodada === ch.rodadas);
      const t = f && ch.times.find((x) => x.id === f.vencedor);
      subB = t ? `🏆 ${t.emoji} ${esc(t.nome)}` : 'terminou';
      btnB = botao('bp-recomecar', 'Recomeçar', { classe: 'secundario', confirmar: 'De novo: apagar a chave' });
    }
    l.push(bp.liberada ? linha('🍺', 'Beer Pong', subB, btnB, { teste: bp.emTeste }) : linha('🍺', 'Beer Pong', 'bloqueado', liberar('beerpong'), { bloqueado: true }));

    const q = d.quiz;
    const rodando = ['preparar', 'pergunta', 'revelacao'].includes(q.fase);
    const restam = q.perguntas.filter((x) => x.reveladaEm == null).length;
    l.push(!q.liberada ? linha('⚡', 'Quiz', 'bloqueado', liberar('quiz'), { bloqueado: true })
      : linha('⚡', 'Quiz', rodando ? 'no telão' : `${q.sala.length} na sala · ${restam} perguntas`,
        rodando ? '' : `${botao('tel', 'Sala', { classe: 'secundario', extra: 'data-modo="quiz"' })}${botao('quiz-iniciar', 'Iniciar', { desligado: !q.sala.length || !restam, extra: `data-quantas="${Math.min(restam, 10)}"`, confirmar: 'De novo: começar' })}`, { teste: q.emTeste }));

    const k = d.concurso;
    let btnK = '';
    if (k.estado === 'fechado') btnK = botao('conc-desfile', '🎭 Desfile');
    if (k.estado === 'publicado') btnK = botao('tel', 'Pódio', { classe: 'secundario', extra: 'data-modo="concurso"' });
    const subK = { fechado: `${(k.desfilantes || []).length} querem desfilar`, desfile: 'desfile no telão', aberto: 'votação aberta', encerrado: 'esperando revelar', publicado: 'resultado publicado' }[k.estado];
    l.push(k.liberada ? linha('👑', 'Concurso de Fantasia', subK, btnK, { teste: k.emTeste }) : linha('👑', 'Concurso de Fantasia', 'bloqueado', liberar('concurso'), { bloqueado: true }));

    const mu = d.correio;
    l.push(mu.liberada ? linha('📸', 'Mural', mu.auto ? 'entra direto no telão' : `🔒 travado · ${mu.pendentes} esperando`,
      botao('cor-auto', mu.auto ? '🔒 Travar' : '🟢 Destravar', { classe: 'secundario', extra: `data-auto="${mu.auto ? '0' : '1'}"` }), { teste: mu.emTeste })
      : linha('📸', 'Mural', 'bloqueado', liberar('correio'), { bloqueado: true }));
    return l.join('');
  }

  const assinaturas = {};
  function pintar(id, html) {
    if (assinaturas[id] === html) return;
    const foco = document.activeElement;
    if (foco && foco.tagName === 'SELECT' && $(id).contains(foco)) return;
    if ($(id).querySelector('select.pn-select') && [...$(id).querySelectorAll('select.pn-select')].some((x) => x.value)) {
      // Já escolheu alguém e ainda não confirmou: guarda a escolha ao redesenhar.
      const escolhas = [...$(id).querySelectorAll('select.pn-select')].map((x) => [x.dataset.grupo + x.dataset.id, x.value]);
      assinaturas[id] = html; $(id).innerHTML = html; reArmar($(id));
      for (const [k, v] of escolhas) { const el = [...$(id).querySelectorAll('select.pn-select')].find((x) => x.dataset.grupo + x.dataset.id === k); if (el) el.value = v; }
      return;
    }
    assinaturas[id] = html;
    $(id).innerHTML = html;
    reArmar($(id));
  }
  function desenhar() {
    if (!dados) return;
    const modo = dados.telao && dados.telao.modo;
    pintar('pn-telao', TELAO.map(([m, e, n]) => `<button type="button" data-acao="tel" data-modo="${m}" class="${m === modo ? 'ativo' : ''}" aria-pressed="${m === modo}"><span>${e}</span>${n}</button>`).join(''));
    pintar('pn-agora', blocoAgora(dados));
    pintar('pn-jogos', blocoJogos(dados));
    PV.preencherFotos($('pn-agora'), token);
    tique();
  }

  // ------------------------------------------------------- segundo toque
  const armados = new Map(); // chave -> timer
  const chaveDe = (b) => `${b.dataset.acao}|${b.dataset.id || ''}|${b.dataset.lado || ''}`;
  function reArmar(raiz) {
    raiz.querySelectorAll('button[data-confirmar]').forEach((b) => { if (armados.has(chaveDe(b))) { b.classList.add('armado'); b.textContent = b.dataset.confirmar; } });
  }
  function confirmar(b) {
    const k = chaveDe(b);
    if (armados.has(k)) { clearTimeout(armados.get(k)); armados.delete(k); return true; }
    const original = b.innerHTML;
    b.classList.add('armado');
    b.textContent = b.dataset.confirmar;
    armados.set(k, setTimeout(() => { armados.delete(k); b.classList.remove('armado'); b.innerHTML = original; }, 4000));
    if (navigator.vibrate) navigator.vibrate(30);
    return false;
  }

  // -------------------------------------------------------------- ações
  const ACOES = {
    tel: (b) => [api('PUT', '/telao', { modo: b.dataset.modo }), 'Telão trocado.'],
    liberar: (b) => [api('PUT', `/atividades/${b.dataset.id}`, { estado: 'liberada' }), 'Liberado para todos.'],
    'mal-cumprida': (b) => [api('POST', `/maldicao/${b.dataset.id}/resolver`, { estado: 'cumprida' }), 'Cumprida.'],
    'mal-falhou': (b) => [api('POST', `/maldicao/${b.dataset.id}/resolver`, { estado: 'falhou' }), 'Não cumpriu: perdeu mais pontos.'],
    'mal-cancelar': (b) => [api('POST', `/maldicao/${b.dataset.id}/resolver`, { estado: 'cancelada' }), 'Sorteio anulado: pontos devolvidos.'],
    'mal-ausente': (b) => [api('POST', `/maldicao/${b.dataset.id}/resolver`, { estado: 'ausente' }), 'Ninguém perde ponto. Sorteando outra pessoa!'],
    'mal-grupo': (b) => {
      const val = (qual) => (document.querySelector(`select[data-grupo="${qual}"][data-id="${b.dataset.id}"]`) || {}).value || null;
      return [api('POST', `/maldicao/${b.dataset.id}/resolver`, { estado: 'cumprida', ultimo: val('ultimo'), penultimo: val('penultimo') }), 'Pontos tirados do último e do penúltimo.'];
    },
    'mal-ligar': (b) => [api('PUT', '/maldicao', { ligada: b.dataset.id === '1' }), b.dataset.id === '1' ? 'Sorteios ligados.' : 'Sorteios pausados.'],
    'mal-sortear': () => [api('POST', '/maldicao/sortear', { id: novoId() }), 'Maldição sorteada! Olhe o telão.'],
    'bp-venceu': (b) => [api('POST', `/beerpong/partida/${b.dataset.id}/${b.dataset.lado}`), 'Resultado no telão.'],
    'bp-desfazer': (b) => [api('POST', `/beerpong/desfazer/${b.dataset.id}`), 'Desfeito.'],
    'bp-sortear': () => [api('POST', '/beerpong/sortear'), 'Sorteando no telão!'],
    'bp-recomecar': () => [api('POST', '/beerpong/recomecar'), 'Voltou às inscrições.'],
    'cor-apostas': () => [api('POST', '/corrida/apostas'), 'Apostas abertas: 1 minuto.'],
    'cor-largar': () => [api('POST', '/corrida/largar'), 'Largada!'],
    'cor-cancelar': () => [api('POST', '/corrida/cancelar'), 'Corrida cancelada.'],
    'quiz-iniciar': (b) => [api('POST', '/quiz/iniciar', { quantas: Number(b.dataset.quantas) || 10 }), 'Quiz começando!'],
    'quiz-encerrar': () => [api('POST', '/quiz/encerrar'), 'Quiz parado.'],
    'conc-desfile': () => [api('POST', '/concurso/desfile'), 'Telão: Desfile Macabro!'],
    'conc-abrir': () => [api('POST', '/concurso/abrir'), 'Votação aberta.'],
    'conc-encerrar': () => [api('POST', '/concurso/encerrar'), 'Votação encerrada.'],
    'conc-publicar': () => [api('POST', '/concurso/publicar'), 'Revelando no telão!'],
    'cor-auto': (b) => [api('PUT', '/correio-auto', { auto: b.dataset.auto === '1' }), b.dataset.auto === '1' ? 'Destravado.' : 'Travado.'],
    'cor-aprovar': (b) => [api('POST', `/correio/${b.dataset.id}/aprovar`), 'Aprovado.'],
    'cor-recusar': (b) => [api('POST', `/correio/${b.dataset.id}/recusar`), 'Recusado.'],
  };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('#tela-painel button[data-acao]');
    if (!b || b.disabled || !ACOES[b.dataset.acao]) return;
    if (b.dataset.confirmar && !confirmar(b)) return;
    b.disabled = true;
    try {
      const [promessa, msg] = ACOES[b.dataset.acao](b);
      await promessa;
      PV.avisar(msg, 'ok');
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
    } finally {
      b.disabled = false;
      carregar();
    }
  });

  async function iniciar() {
    $('tela-login').classList.add('oculto');
    $('tela-painel').classList.remove('oculto');
    try { avatares = (await PV.chamar('GET', '/api/avatares')).avatares; } catch (_) { /* sem emojis */ }
    socket = PV.conectar({ tipo: 'admin', token, aoConectar: carregar, aoNegar: sair, eventos: { atualizar: carregar } });
    setInterval(tique, 500);
    setInterval(carregar, 30000); // rede de segurança se um aviso se perder
  }
  if (token) iniciar();
  else $('tela-login').classList.remove('oculto');
})();
