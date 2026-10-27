// Aba Jogos do painel: Previsões, Maldição, Enigmas, bebida levada e ranking.
// Ações importantes pedem um segundo toque (sem caixas de confirmação do navegador).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = () => window.PVAdmin;
  const esc = PV.esc;
  let dados = null;
  const assinaturas = {};

  function pintar(id, html) {
    const el = $(id);
    if (!el || assinaturas[id] === html) return;
    const foco = document.activeElement;
    if (el.contains(foco) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(foco.tagName)) return; // não atrapalha quem está editando
    assinaturas[id] = html;
    el.innerHTML = html;
  }
  const novoId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

  // Segundo toque para confirmar (o botão muda de texto por 4 s).
  const armados = new Map();
  function confirmarToque(botao, texto = 'Toque de novo para confirmar') {
    const chave = botao.dataset.acao + (botao.dataset.id || '');
    if (armados.has(chave)) { clearTimeout(armados.get(chave).t); armados.delete(chave); return true; }
    const original = botao.textContent;
    botao.textContent = texto;
    botao.classList.add('perigo');
    armados.set(chave, { t: setTimeout(() => { armados.delete(chave); botao.textContent = original; botao.classList.remove('perigo'); }, 4000) });
    return false;
  }

  // ------------------------------------------------------------- previsões
  function desenharPrevisoes(p) {
    const rotulo = { aguardando: 'Ainda não abriu', aberta: 'Aberta', encerrada: 'Encerrada', publicada: 'Resultados publicados' }[p.estado];
    const selo = { aguardando: 'pendente', aberta: 'ok', encerrada: 'fora', publicada: 'ok' }[p.estado];
    const opcoesPessoas = (atual) => `<option value="">— sem resposta —</option>${p.pessoas.map((x) => `<option value="${esc(x.id)}" ${x.id === atual ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}`;
    const sug = p.sugestoes['mais-amaldicoado'] || [];
    const perguntas = p.perguntas.map((q) => {
      const votos = q.votos.length ? q.votos.slice(0, 4).map((v) => `${esc(v.nome)} (${v.n})`).join(' · ') : 'sem palpites';
      const campo = q.tipo === 'opcoes'
        ? `<select data-resposta="${esc(q.id)}" aria-label="Resposta oficial"><option value="">— sem resposta —</option>${q.opcoes.map((o) => `<option value="${esc(o.id)}" ${o.id === q.resposta ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select>`
        : `<select data-resposta="${esc(q.id)}" aria-label="Resposta oficial">${opcoesPessoas(q.resposta)}</select>`;
      const dica = q.id === 'mais-amaldicoado' && sug.length ? `<div class="item-sub">Mais sorteados: ${sug.map((s) => `${esc(s.nome || '?')} (${s.n})`).join(', ')}</div>` : '';
      return `<div class="item"><div class="item-nome">${q.ordem}. ${esc(q.texto)}</div>
        <div class="item-sub">${p.estado === 'aberta' ? 'Palpites escondidos até fechar' : `Palpites: ${votos}`}</div>${dica}
        <div style="margin-top:8px">${p.estado === 'aberta' || p.estado === 'aguardando' ? '' : campo}</div></div>`;
    }).join('');
    const acoes = [];
    if (p.estado === 'aberta') acoes.push('<button class="botao secundario" type="button" data-acao="prev-encerrar">Encerrar agora</button>');
    if (p.estado === 'encerrada') {
      acoes.push('<button class="botao" type="button" data-acao="prev-publicar">Publicar resultados e dar os pontos</button>');
      acoes.push('<button class="botao secundario" type="button" data-acao="prev-reabrir">Reabrir</button>');
    }
    if (p.estado === 'publicada') acoes.push('<button class="botao secundario" type="button" data-acao="prev-despublicar">Despublicar (tira os pontos)</button>');
    pintar('j-previsoes', `
      <p><span class="selo ${selo}">${rotulo}</span>
        ${p.estado === 'aguardando' && p.abreEm ? `Abre ${esc(PV.dataCurta(p.abreEm))} (mude na aba Atividades).` : ''}
        ${p.estado === 'aberta' ? `Fecha ${esc(PV.dataCurta(p.fechaEm))}, quando a festa começa.` : ''}
        · ${p.participantes} ${p.participantes === 1 ? 'pessoa respondeu' : 'pessoas responderam'}</p>
      <div class="item-acoes">${acoes.join('')}</div>
      ${p.estado === 'encerrada' || p.estado === 'publicada' ? `<p class="fraco" style="margin:8px 0">Marque a resposta certa de cada pergunta (salva na hora). Depois de publicar, corrigir uma resposta recalcula os pontos.</p>
        <div class="item-acoes"><span class="fraco">Telão:</span>
          <button class="botao secundario pequeno" type="button" data-acao="tel-prev" data-passo="-1">◀ Anterior</button>
          <button class="botao secundario pequeno" type="button" data-acao="tel-prev" data-passo="1">Próxima ▶</button>
          <button class="botao pequeno" type="button" data-acao="tel-modo" data-modo="previsoes">Mostrar no telão</button></div>` : ''}
      <details class="det-prev" ${p.estado === 'encerrada' ? 'open' : ''} style="margin-top:10px"><summary>Perguntas e respostas oficiais (${p.perguntas.length})</summary>
        <div class="lista" style="margin-top:10px">${perguntas}</div></details>`);
  }

  // -------------------------------------------------------------- maldição
  function desenharMaldicao(m) {
    const c = m.config;
    const ints = Object.entries(m.intensidades).map(([id, x]) => `<button type="button" class="${c.intensidade === id ? 'ativo' : ''}" data-acao="mal-intensidade" data-id="${id}">${esc(x.nome)}<small>${x.minMin}–${x.maxMin} min</small></button>`).join('');
    const hist = m.historico.slice(0, 12).map((x) => `<div class="item">
        <div class="item-topo"><span class="avatar">${A().emojiDe(x.avatar)}</span><div>
          <div class="item-nome">${esc(x.nome)}${x.parceiro ? ` e ${esc(x.parceiro.nome)}` : ''}
            <span class="selo ${x.estado === 'cumprida' ? 'ok' : x.estado === 'cancelada' ? 'off' : 'pendente'}">${x.estado}</span></div>
          <div class="item-sub">${esc(PV.dataCurta(x.sorteadaEm))} · ${x.origem === 'auto' ? 'automático' : 'manual'} · ${esc(x.castigo)}</div></div></div>
        ${x.estado === 'sorteada' ? `<div class="item-acoes">
          <button class="botao pequeno" type="button" data-acao="mal-cumprida" data-id="${x.id}">Cumpriu (+${m.pontos})</button>
          <button class="botao secundario pequeno" type="button" data-acao="mal-cancelar" data-id="${x.id}">Cancelar</button></div>` : ''}</div>`).join('');
    pintar('j-maldicao', `
      ${m.liberada ? '' : '<p class="aviso-inline">A atividade está bloqueada: libere em Atividades para os sorteios acontecerem (ou use o sorteio manual para testar depois de liberar).</p>'}
      <p><span class="selo ${c.ligada ? 'ok' : 'fora'}">${c.ligada ? 'Ligada' : 'Pausada'}</span>
        ${c.ligada && c.proximaEm ? `Próximo sorteio por volta de ${esc(PV.dataHora(c.proximaEm, { hour: '2-digit', minute: '2-digit' }))}` : ''}</p>
      <div class="item-acoes">
        <button class="botao ${c.ligada ? 'secundario' : ''}" type="button" data-acao="mal-ligar" data-id="${c.ligada ? '0' : '1'}">${c.ligada ? 'Pausar sorteios' : 'Ligar sorteios automáticos'}</button>
        <button class="botao" type="button" data-acao="mal-sortear">Sortear agora</button>
      </div>
      <p class="fraco" style="margin:10px 0 6px">Intensidade (intervalo entre maldições e castigos mais pesados):</p>
      <div class="estados intensidades">${ints}</div>
      <div class="linha-teste" style="margin-top:8px"><label class="fraco" for="mal-min">Ou intervalo próprio (min):</label>
        <input id="mal-min" type="number" min="2" max="180" value="${c.minMin}" style="width:80px"> a
        <input id="mal-max" type="number" min="2" max="180" value="${c.maxMin}" style="width:80px">
        <button class="botao secundario pequeno" type="button" data-acao="mal-intervalo">Salvar</button></div>
      <p class="fraco" style="margin:10px 0">Quem está marcado como "fora" não é sorteado. A mesma pessoa não sai duas vezes seguidas.
        Pontos só quando você confirma que cumpriu.${m.maisAmaldicoados.length ? ` Mais sorteados: ${m.maisAmaldicoados.map((x) => `${esc(x.nome)} (${x.n})`).join(', ')}.` : ''}</p>
      <div class="lista">${hist || '<p class="fraco">Nenhum sorteio ainda.</p>'}</div>`);
  }

  // --------------------------------------------------------------- enigmas
  function desenharEnigmas(e) {
    const lista = e.enigmas.map((x) => `<form class="item enigma-admin" data-enigma="${esc(x.id)}">
        <div class="item-nome">${esc(x.titulo)} <span class="selo ${x.estado === 'aberto' ? 'ok' : x.estado === 'fechado' ? 'fora' : 'pendente'}">${x.estado}</span></div>
        <div class="item-sub">Abre ${esc(PV.dataCurta(x.abreEm))} · fecha ${esc(PV.dataCurta(x.fechaEm))} · ${x.revelaram} revelaram, ${x.acertadores.length} acertaram</div>
        ${x.acertadores.length ? `<div class="item-sub">Ordem: ${x.acertadores.slice(0, 5).map((a) => `${a.posicao}º ${esc(a.nome)} (${a.segundos}s)`).join(', ')}${x.acertadores.length > 5 ? '…' : ''}</div>` : ''}
        ${x.sairam.length ? `<div class="item-sub">Saíram da página (eliminados): ${x.sairam.map(esc).join(', ')}</div>` : ''}
        <details style="margin-top:8px"><summary>Editar</summary>
          <label>Título</label><input name="titulo" maxlength="40" value="${esc(x.titulo)}">
          <label>Enigma</label><textarea name="pergunta" rows="3" maxlength="400">${esc(x.pergunta)}</textarea>
          <label>Respostas aceitas (separe por vírgula; acento e maiúscula não importam)</label><input name="respostas" value="${esc(x.respostas.join(', '))}">
          <label>Dica</label><input name="dica" maxlength="120" value="${esc(x.dica)}">
          <label>Abre</label><input name="abreEm" type="datetime-local" value="${A().msParaLocal(x.abreEm)}">
          <label>Fecha</label><input name="fechaEm" type="datetime-local" value="${A().msParaLocal(x.fechaEm)}">
          <button class="botao largo" type="submit" style="margin-top:10px">Salvar enigma</button>
        </details></form>`).join('');
    pintar('j-enigmas', `
      <p class="fraco">Modo prova: a pessoa toca em "Revelar", tem um tempo para responder (${e.maxTentativas} tentativas) e, se sair da página, o enigma é encerrado para ela.</p>
      <div class="linha-teste"><label class="fraco">Tempo (segundos) <input type="number" min="30" max="900" value="${e.tempoS}" id="enigma-tempo" style="width:90px"></label>
        <button class="botao secundario pequeno" type="button" data-acao="tempo-salvar">Salvar tempo</button></div>
      <p class="fraco">Acerto: +${e.pontos}. Bônus para os primeiros:</p>
      <div class="linha-teste">${e.bonus.map((b, i) => `<label class="fraco">${i + 1}º <input type="number" min="0" max="50" value="${b}" data-bonus="${i}" style="width:70px"></label>`).join('')}
        <button class="botao secundario pequeno" type="button" data-acao="bonus-salvar">Salvar bônus</button></div>
      <div class="lista" style="margin-top:10px">${lista}</div>`);
  }

  // ----------------------------------------------------- bebida e ranking
  function desenharBebidas(b) {
    const lista = b.pessoas.map((x) => `<div class="item"><div class="item-topo"><span class="avatar">${A().emojiDe(x.avatar)}</span><div>
        <div class="item-nome">${esc(x.nome)} ${x.confirmado ? '<span class="selo ok">levou</span>' : ''}</div><div class="item-sub">${esc(x.itens || '')}</div></div></div>
        <div class="item-acoes">${x.confirmado
          ? `<button class="botao secundario pequeno" type="button" data-acao="beb-desfazer" data-id="${esc(x.id)}">Desfazer</button>`
          : `<button class="botao pequeno" type="button" data-acao="beb-levou" data-id="${esc(x.id)}" ${b.liberado ? '' : 'disabled'}>Levou (+${b.pontos})</button>`}</div></div>`).join('');
    pintar('j-bebidas', `<p class="fraco">${b.liberado ? 'Confirme quem chegou com a bebida que marcou.' : `A confirmação abre ${esc(PV.dataCurta(b.liberaEm))} (2 h antes da festa).`}</p>
      <div class="lista">${lista || '<p class="fraco">Ninguém marcou bebida ainda.</p>'}</div>`);
  }

  function desenharRanking(r) {
    pintar('j-ranking', r.length ? r.slice(0, 30).map((x) => `<div class="item"><div class="item-topo">
      <b style="width:34px;text-align:center">${x.posicao}º</b><span class="avatar">${A().emojiDe(x.avatar)}</span>
      <div class="item-nome" style="flex:1">${esc(x.nome)}</div><b style="color:var(--laranja-claro)">${x.pontos}</b></div></div>`).join('')
      : '<p class="fraco">Ninguém no ranking ainda.</p>'
      + '<button class="botao secundario pequeno" type="button" data-acao="tel-modo" data-modo="ranking" style="margin-top:8px">Mostrar ranking no telão</button>');
  }

  function desenhar(j) {
    dados = j;
    desenharPrevisoes(j.previsoes);
    desenharMaldicao(j.maldicao);
    desenharEnigmas(j.enigmas);
    desenharBebidas(j.bebidas);
    desenharRanking(j.ranking);
  }

  // ------------------------------------------------------------------ ações
  let indiceTelao = 0;
  const painel = document.querySelector('[data-painel="jogos"]');
  painel.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-acao]');
    if (!b || b.disabled) return;
    const { acao: oque, id } = b.dataset;
    const api = A().api;
    const fazer = async (fn, msg) => { b.disabled = true; await A().acao(fn, msg); b.disabled = false; A().recarregar(); };
    if (oque === 'prev-encerrar') { if (confirmarToque(b)) await fazer(() => api('POST', '/previsoes/encerrar'), 'Previsões encerradas.'); }
    if (oque === 'prev-reabrir') await fazer(() => api('POST', '/previsoes/reabrir'), 'Previsões reabertas.');
    if (oque === 'prev-publicar') { if (confirmarToque(b, 'Toque de novo: publicar e dar os pontos')) await fazer(() => api('POST', '/previsoes/publicar'), 'Resultados publicados. Pontos no ranking.'); }
    if (oque === 'prev-despublicar') { if (confirmarToque(b)) await fazer(() => api('POST', '/previsoes/despublicar'), 'Resultados despublicados.'); }
    if (oque === 'tel-prev') {
      const total = dados ? dados.previsoes.perguntas.length : 10;
      indiceTelao = Math.max(0, Math.min(total - 1, indiceTelao + Number(b.dataset.passo)));
      await fazer(() => api('PUT', '/telao', { modo: 'previsoes', previsao: indiceTelao }), `Telão: previsão ${indiceTelao + 1}.`);
    }
    if (oque === 'tel-modo') await fazer(() => api('PUT', '/telao', { modo: b.dataset.modo }), 'Telão atualizado.');
    if (oque === 'mal-ligar') await fazer(() => api('PUT', '/maldicao', { ligada: id === '1' }), id === '1' ? 'Sorteios ligados.' : 'Sorteios pausados.');
    if (oque === 'mal-intensidade') await fazer(() => api('PUT', '/maldicao', { intensidade: id }), 'Intensidade salva.');
    if (oque === 'mal-intervalo') {
      await fazer(() => api('PUT', '/maldicao', { minMin: Number($('mal-min').value), maxMin: Number($('mal-max').value) }), 'Intervalo salvo.');
    }
    if (oque === 'mal-sortear') { if (confirmarToque(b, 'Toque de novo: sortear agora')) await fazer(() => api('POST', '/maldicao/sortear', { id: novoId() }), 'Maldição sorteada! Olhe o telão.'); }
    if (oque === 'mal-cumprida') await fazer(() => api('POST', `/maldicao/${id}/resolver`, { estado: 'cumprida' }), 'Cumprida. Pontos dados.');
    if (oque === 'mal-cancelar') { if (confirmarToque(b)) await fazer(() => api('POST', `/maldicao/${id}/resolver`, { estado: 'cancelada' }), 'Maldição cancelada.'); }
    if (oque === 'bonus-salvar') {
      const bonus = [...painel.querySelectorAll('[data-bonus]')].map((x) => Number(x.value));
      await fazer(() => api('PUT', '/enigmas-bonus', { bonus }), 'Bônus salvo.');
    }
    if (oque === 'tempo-salvar') await fazer(() => api('PUT', '/enigmas-tempo', { segundos: Number($('enigma-tempo').value) }), 'Tempo salvo.');
    if (oque === 'beb-levou') await fazer(() => api('PUT', `/colaboracao/bebida/${encodeURIComponent(id)}`, { levou: true }), 'Confirmado: +5.');
    if (oque === 'beb-desfazer') await fazer(() => api('PUT', `/colaboracao/bebida/${encodeURIComponent(id)}`, { levou: false }), 'Desfeito.');
  });

  painel.addEventListener('change', async (e) => {
    const s = e.target.closest('select[data-resposta]');
    if (!s) return;
    await A().acao(() => A().api('PUT', `/previsoes/${encodeURIComponent(s.dataset.resposta)}/resposta`, { resposta: s.value || null }), 'Resposta salva.');
    s.blur();
    A().recarregar();
  });

  painel.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-enigma]');
    if (!f) return;
    e.preventDefault();
    const v = (n) => f.elements[n].value;
    await A().acao(() => A().api('PUT', `/enigmas/${encodeURIComponent(f.dataset.enigma)}`, {
      titulo: v('titulo'), pergunta: v('pergunta'), respostas: v('respostas'), dica: v('dica'),
      abreEm: A().localParaIso(v('abreEm')), fechaEm: A().localParaIso(v('fechaEm')),
    }), 'Enigma salvo.');
    document.activeElement.blur();
    A().recarregar();
  });

  window.PVAdminJogos = { desenhar };
})();
