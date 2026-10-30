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
        · ${p.participantes} ${p.participantes === 1 ? 'pessoa respondeu' : 'pessoas responderam'} · ${p.enviaram} ${p.enviaram === 1 ? 'enviou' : 'enviaram'}</p>
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
          <div class="item-nome">${esc(x.nome)}${x.parceiro ? ` e ${esc(x.parceiro.nome)}` : ''}${x.teste ? ' <span class="selo teste">teste</span>' : ''}
            <span class="selo ${x.estado === 'cumprida' ? 'ok' : x.estado === 'cancelada' ? 'off' : 'pendente'}">${x.estado}</span></div>
          <div class="item-sub">${esc(PV.dataCurta(x.sorteadaEm))} · ${x.origem === 'auto' ? 'automático' : 'manual'} · ${esc(x.castigo)}</div></div></div>
        ${x.estado === 'sorteada' ? `<div class="item-acoes">
          <button class="botao pequeno" type="button" data-acao="mal-cumprida" data-id="${x.id}">Cumpriu (+${m.pontos})</button>
          <button class="botao secundario pequeno" type="button" data-acao="mal-cancelar" data-id="${x.id}">Cancelar</button></div>` : ''}</div>`).join('');
    pintar('j-maldicao', `
      ${m.liberada ? '' : '<p class="aviso-inline">A atividade está bloqueada: libere (ou coloque "Em teste") em Atividades para os sorteios acontecerem.</p>'}
      ${m.emTeste ? '<p class="selo teste" style="display:inline-block">🧪 Em teste: só os testadores são sorteados</p>' : ''}
      <p><span class="selo ${c.ligada ? 'ok' : 'fora'}">${c.ligada ? 'Ligada' : 'Pausada'}</span>
        ${c.ligada && c.proximaEm ? `Próximo sorteio por volta de ${esc(PV.dataHora(c.proximaEm, { hour: '2-digit', minute: '2-digit' }))}` : ''}</p>
      <div class="item-acoes">
        <button class="botao ${c.ligada ? 'secundario' : ''}" type="button" data-acao="mal-ligar" data-id="${c.ligada ? '0' : '1'}">${c.ligada ? 'Pausar sorteios' : 'Ligar sorteios automáticos'}</button>
        <button class="botao" type="button" data-acao="mal-sortear">Sortear agora</button>
      </div>
      <p class="fraco" style="margin:10px 0 6px">Ritmo (de quanto em quanto tempo sai uma maldição; os desafios são os mesmos em qualquer ritmo):</p>
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

  // ------------------------------------------------------------------ quiz
  const L = ['A', 'B', 'C', 'D'];
  let trocaQuiz = null;
  function desenharQuiz(q) {
    const rodando = ['preparar', 'pergunta', 'revelacao'].includes(q.fase);
    clearTimeout(trocaQuiz);
    if (rodando && q.fimEm) trocaQuiz = setTimeout(() => A().recarregar(), Math.max(500, q.fimEm - PV.relogio.agora() + 600));
    const fases = { sala: 'Sala aberta, esperando começar', preparar: 'Começando…', pergunta: `Pergunta ${(q.indice ?? 0) + 1} de ${q.total} valendo`,
      revelacao: `Mostrando a resposta da ${(q.indice ?? 0) + 1}`, fim: 'Quiz terminado' };
    const lista = q.perguntas.map((x) => {
      const jogada = x.reveladaEm != null;
      const barra = jogada ? `<div class="quiz-barra">${x.opcoes.map((o, i) => `<span class="${i === x.correta ? 'certa' : ''}">${L[i]}: ${x.porOpcao[i]}</span>`).join('')}<span>Total: ${x.respostas}</span></div>` : '';
      const editar = !jogada && !rodando ? `<details style="margin-top:8px"><summary>Editar</summary>
          <form data-quiz-form="${esc(x.id)}"><label>Pergunta</label><textarea name="texto" rows="2" maxlength="200">${esc(x.texto)}</textarea>
          ${x.opcoes.map((o, i) => `<div class="quiz-admin-op"><label><input type="radio" name="correta" value="${i}" ${i === x.correta ? 'checked' : ''}> ${L[i]}</label>
            <input type="text" name="op${i}" maxlength="60" value="${esc(o)}"></div>`).join('')}
          <p class="fraco">Marque a bolinha da opção certa.</p><button class="botao largo" type="submit">Salvar pergunta</button></form></details>` : '';
      return `<div class="item"><div class="item-nome">${x.ordem}. ${esc(x.texto)} ${jogada ? '<span class="selo ok">jogada</span>' : ''}</div>
        <div class="item-sub">Certa: ${L[x.correta]} · ${esc(x.opcoes[x.correta])}</div>${barra}${editar}</div>`;
    }).join('');
    const sala = q.sala.length ? q.sala.map((p) => `<span class="chip-sala"><span class="avatar mini">${A().emojiDe(p.avatar)}</span>${esc(p.nome)}</span>`).join('') : '<span class="fraco">Ninguém ainda.</span>';
    let acoes = '';
    if (q.fase === 'sala' || q.fase === 'fim') {
      acoes = `<label class="fraco">Perguntas <input type="number" id="quiz-quantas" min="1" max="${q.perguntas.length}" value="${q.perguntas.filter((x) => x.reveladaEm == null).length || q.perguntas.length}" style="width:70px"></label>
        <button class="botao" type="button" data-acao="quiz-iniciar" ${q.liberada && q.sala.length ? '' : 'disabled'}>▶ Iniciar quiz</button>
        <span class="fraco">Usa as próximas perguntas ainda não jogadas (dá para fazer em rodadas).</span>`;
    }
    if (rodando) acoes = '<button class="botao perigo" type="button" data-acao="quiz-encerrar">Parar o quiz agora</button>';
    pintar('j-quiz', `
      ${q.liberada ? '' : '<p class="aviso-inline">O Quiz está bloqueado: libere (ou coloque "Em teste") em Atividades. Aí as pessoas já conseguem entrar na sala.</p>'}
      ${q.emTeste ? '<p class="selo teste" style="display:inline-block">🧪 Em teste: só os testadores entram e respondem</p>' : ''}
      <p><span class="selo ${rodando ? 'pendente' : q.fase === 'fim' ? 'ok' : 'fora'}">${fases[q.fase]}</span></p>
      <p class="fraco">Como funciona: as pessoas tocam em <b>Entrar na sala</b> no celular e aparecem no telão. Você toca em <b>Iniciar quiz</b> e o resto é automático:
        5 s de preparação, ${q.tempoS} s por pergunta, ${q.revelaS} s mostrando a resposta certa e já vai para a próxima. No fim, o telão mostra quem mais acertou.
        Acerto vale de +${q.pontos} (respondeu na hora) a +${q.pontos / 2} (no fim do tempo), como no Kahoot.</p>
      <div class="item-acoes"><button class="botao secundario" type="button" data-acao="tel-modo" data-modo="quiz">Mostrar a sala no telão</button></div>
      <p style="margin:10px 0 6px"><b>Na sala (${q.sala.length}):</b></p><div class="sala-admin">${sala}</div>
      <div class="linha-teste" style="margin-top:12px">${acoes}</div>
      <div class="linha-teste" style="margin-top:8px"><label class="fraco">Tempo por pergunta (s) <input type="number" min="10" max="120" value="${q.tempoS}" id="quiz-tempo" style="width:80px"></label>
        <button class="botao secundario pequeno" type="button" data-acao="quiz-tempo" ${rodando ? 'disabled' : ''}>Salvar tempo</button>
        <button class="botao secundario pequeno" type="button" data-acao="quiz-recomecar" ${rodando ? 'disabled' : ''}>Recomeçar do zero</button></div>
      <p class="fraco">"Recomeçar do zero" esvazia a sala e apaga as respostas e os pontos do quiz (para testar de novo).</p>
      <details style="margin-top:10px"><summary>Perguntas (${q.perguntas.length})</summary><div class="lista" style="margin-top:10px">${lista}</div></details>`);
  }

  // -------------------------------------------------------------- concurso
  function desenharConcurso(c) {
    const rot = { fechado: ['Votação fechada', 'fora'], desfile: ['🎭 Hora do Desfile no telão', 'pendente'], aberto: ['Votação aberta', 'ok'], encerrado: ['Encerrada', 'pendente'], publicado: ['Resultado publicado', 'ok'] }[c.estado];
    const acoes = [];
    if (c.estado === 'fechado') acoes.push(`<button class="botao" type="button" data-acao="conc-desfile" ${c.liberada ? '' : 'disabled'}>🎭 Hora do Desfile Macabro</button>`);
    if (c.estado === 'fechado' || c.estado === 'desfile' || c.estado === 'encerrado') acoes.push(`<button class="botao ${c.estado === 'encerrado' ? 'secundario' : ''}" type="button" data-acao="conc-abrir" ${c.liberada ? '' : 'disabled'}>${c.estado === 'encerrado' ? 'Reabrir votação' : c.estado === 'desfile' ? 'Desfile acabou: abrir votação' : 'Abrir votação (sem desfile)'}</button>`);
    if (c.estado === 'aberto') acoes.push('<button class="botao" type="button" data-acao="conc-encerrar">Encerrar votação</button>');
    if (c.estado === 'encerrado') acoes.push('<button class="botao" type="button" data-acao="conc-publicar">Publicar resultado e dar os pontos</button>');
    if (c.estado === 'publicado') acoes.push('<button class="botao secundario" type="button" data-acao="conc-despublicar">Despublicar (tira os pontos)</button>');
    const cont = c.contagem.slice(0, 12).map((x) => `<div class="item"><div class="item-topo"><b style="width:30px;text-align:center">${x.posicao}º</b>
      <span class="avatar">${A().emojiDe(x.avatar)}</span><div class="item-nome" style="flex:1">${esc(x.nome)}</div>
      <span>${x.votos} ${x.votos === 1 ? 'voto' : 'votos'}${x.pontos ? ` · <b style="color:var(--laranja-claro)">+${x.pontos}</b>` : ''}</span></div></div>`).join('');
    const fila = (c.desfilantes || []).map((p) => `<span class="chip-sala"><span class="avatar mini">${A().emojiDe(p.avatar)}</span>${esc(p.nome)}
        ${['fechado', 'desfile'].includes(c.estado) ? `<button type="button" class="tirar" data-acao="conc-tirar" data-id="${esc(p.id)}" aria-label="Tirar ${esc(p.nome)} da lista">✕</button>` : ''}</span>`).join('');
    pintar('j-concurso', `
      ${c.liberada ? '' : '<p class="aviso-inline">O Concurso está bloqueado: libere (ou coloque "Em teste") em Atividades antes de abrir a votação.</p>'}
      ${c.emTeste ? '<p class="selo teste" style="display:inline-block">🧪 Em teste: só os testadores votam</p>' : ''}
      <p><span class="selo ${rot[1]}">${rot[0]}</span> · ${c.eleitores} ${c.eleitores === 1 ? 'pessoa votou' : 'pessoas votaram'} · prêmios ${c.premios.join(' / ')}</p>
      <p style="margin:10px 0 6px"><b>Querem desfilar (${(c.desfilantes || []).length}):</b> <span class="fraco">só essas pessoas aparecem na votação</span></p>
      <div class="sala-admin">${fila || '<span class="fraco">Ninguém ainda. Cada um toca em "Quero desfilar!" no celular.</span>'}</div>
      <div class="item-acoes" style="margin-top:10px">${acoes.join('')}<button class="botao secundario pequeno" type="button" data-acao="tel-modo" data-modo="concurso">Mostrar no telão</button></div>
      <p class="fraco" style="margin:8px 0">Ordem: <b>Hora do Desfile Macabro</b> (o telão chama a fila) → desfile ao vivo → <b>abrir votação</b> (o telão troca sozinho) → encerrar → publicar.
        Só você vê a contagem. Empate divide a colocação.</p>
      <div class="lista">${cont || '<p class="fraco">Nenhum voto ainda.</p>'}</div>`);
  }

  // --------------------------------------------------------------- correio
  function desenharCorreio(k) {
    const sel = { pendente: 'pendente', aprovada: 'ok', recusada: 'off' };
    const cartas = k.cartas.slice(0, 60).map((x) => `<div class="item carta-admin">
      <div class="item-sub">De <b>${esc(x.autor)}</b>${x.para ? ` para <b>${esc(x.para)}</b>` : ''} · ${esc(PV.dataCurta(x.em))}
        <span class="selo ${sel[x.estado]}">${x.estado}</span>${x.teste ? ' <span class="selo teste">teste</span>' : ''}</div>
      ${x.foto ? `<img class="foto-admin" data-foto="/api/admin/correio/foto/${x.id}" alt="Foto enviada">` : ''}
      ${x.texto ? `<p>${esc(x.texto)}</p>` : ''}
      <div class="item-acoes" style="margin-top:8px">
        ${x.estado !== 'aprovada' ? `<button class="botao pequeno" type="button" data-acao="cor-aprovar" data-id="${x.id}">Aprovar (vai ao telão)</button>` : ''}
        ${x.estado !== 'recusada' ? `<button class="botao secundario pequeno" type="button" data-acao="cor-recusar" data-id="${x.id}">${x.estado === 'aprovada' ? 'Tirar do telão' : 'Recusar'}</button>` : ''}
        <button class="botao secundario pequeno" type="button" data-acao="cor-apagar" data-id="${x.id}">🗑️ Apagar</button>
      </div></div>`).join('');
    pintar('j-correio', `
      ${k.liberada ? '' : '<p class="aviso-inline">O Mural está bloqueado: libere (ou coloque "Em teste") em Atividades.</p>'}
      ${k.emTeste ? '<p class="selo teste" style="display:inline-block">🧪 Em teste: só os testadores mandam</p>' : ''}
      <div class="item ${k.auto ? '' : 'travado'}" style="margin:8px 0">
        <div class="item-nome">${k.auto ? '🟢 Entrada automática: o que mandam vai direto ao telão' : '🔒 Travado: cada envio espera você aprovar'}</div>
        <div class="item-acoes" style="margin-top:8px">${k.auto
          ? '<button class="botao secundario pequeno" type="button" data-acao="cor-auto" data-auto="0">🔒 Travar (aprovar um por um)</button>'
          : '<button class="botao pequeno" type="button" data-acao="cor-auto" data-auto="1">🟢 Destravar (entra direto)</button>'}</div>
        ${k.auto ? '' : `<p class="fraco" style="margin:8px 0 0"><b>${k.pendentes}</b> ${k.pendentes === 1 ? 'envio esperando' : 'envios esperando'} aprovação. Destravar não aprova os que já estão esperando.</p>`}
      </div>
      <p class="fraco">Quem mandou é anônimo para todos, menos para você. Apagar tira do telão e das Fotos da festa de vez.</p>
      <p class="fraco">${k.fotos} ${k.fotos === 1 ? 'foto guardada' : 'fotos guardadas'} (${String(k.fotosMb).replace('.', ',')} MB). As aprovadas aparecem em "Fotos da festa" (abre domingo) para todos baixarem. As fotos não entram no backup.</p>
      <div class="item-acoes"><button class="botao secundario pequeno" type="button" data-acao="tel-modo" data-modo="correio">Mostrar mural no telão</button>
        ${k.fotos ? '<button class="botao secundario pequeno" type="button" data-acao="cor-apagar-fotos">Apagar todas as fotos</button>' : ''}</div>
      <div class="lista" style="margin-top:10px">${cartas || '<p class="fraco">Nada enviado ainda.</p>'}</div>`);
    PV.preencherFotos($('j-correio'), A().token());
  }

  // -------------------------------------------------------------- beer pong
  function desenharBeerpongAdmin(b) {
    let corpo = '';
    if (b.estado === 'inscricao') {
      const lista = b.inscritos.map((p) => `<span class="selo">${A().emojiDe(p.avatar)} ${esc(p.nome)}
        <button class="botao-x" type="button" data-acao="bp-tirar" data-id="${esc(p.id)}" aria-label="Tirar ${esc(p.nome)}">✕</button></span>`).join(' ');
      corpo = `<p class="fraco">🍺 <b>${b.inscritos.length}</b> ${b.inscritos.length === 1 ? 'inscrito' : 'inscritos'}: ${lista || 'ninguém ainda'}</p>
        <div class="item-acoes" style="margin-top:8px"><button class="botao" type="button" data-acao="bp-sortear" ${b.inscritos.length >= b.minimo ? '' : 'disabled'}>🎲 Sortear os times no telão</button></div>
        ${b.inscritos.length >= b.minimo ? '' : `<p class="fraco">Precisa de pelo menos ${b.minimo} inscritos.</p>`}`;
    } else if (b.chave) {
      const ch = b.chave;
      const nome = (id) => { const t = ch.times.find((x) => x.id === id); return t ? `${t.emoji} ${esc(t.nome)}` : '—'; };
      const membros = (id) => { const t = ch.times.find((x) => x.id === id); return t ? t.membros.map((m) => esc(m.nome)).join(', ') : ''; };
      corpo = ch.nomesRodadas.map((rn, i) => `<h4 style="margin:12px 0 6px">${esc(rn)}</h4>` + ch.partidas.filter((p) => p.rodada === i + 1).map((p) => {
        if (p.bye) return `<div class="item"><div class="item-sub">${nome(p.vencedor)} passa direto (bye)</div></div>`;
        if (!p.a || !p.b) return `<div class="item"><div class="item-sub">${p.a ? nome(p.a) : 'a definir'} × ${p.b ? nome(p.b) : 'a definir'}</div></div>`;
        const agora = ch.proxima === p.id ? ' <span class="selo ok">agora</span>' : '';
        if (p.vencedor) {
          return `<div class="item"><div class="item-nome">${nome(p.vencedor)} ✓ <span class="fraco">venceu ${nome(p.vencedor === p.a ? p.b : p.a)}</span></div>
            <div class="item-acoes"><button class="botao secundario pequeno" type="button" data-acao="bp-desfazer" data-id="${p.id}">Desfazer</button></div></div>`;
        }
        return `<div class="item"><div class="item-nome">${nome(p.a)} × ${nome(p.b)}${agora}</div>
          <div class="item-sub">${membros(p.a)} × ${membros(p.b)}</div>
          <div class="item-acoes" style="margin-top:8px">
            <button class="botao pequeno" type="button" data-acao="bp-venceu" data-id="${p.id}" data-lado="a">✓ ${nome(p.a)} passou</button>
            <button class="botao pequeno" type="button" data-acao="bp-venceu" data-id="${p.id}" data-lado="b">✓ ${nome(p.b)} passou</button></div></div>`;
      }).join('')).join('');
      corpo += `<div class="item-acoes" style="margin-top:12px"><button class="botao secundario pequeno" type="button" data-acao="bp-recomecar">Recomeçar (volta às inscrições)</button></div>`;
    }
    pintar('j-beerpong', `
      ${b.liberada ? '' : '<p class="aviso-inline">O Beer Pong está bloqueado: libere (ou coloque "Em teste") em Atividades.</p>'}
      ${b.emTeste ? '<p class="selo teste" style="display:inline-block">🧪 Em teste: só os testadores se inscrevem</p>' : ''}
      <p><span class="selo ${b.estado === 'inscricao' ? 'fora' : 'ok'}">${{ inscricao: 'Inscrições', chave: 'Chave em andamento', fim: 'Terminou' }[b.estado]}</span></p>
      ${corpo}
      <div class="item-acoes" style="margin-top:8px"><button class="botao secundario pequeno" type="button" data-acao="tel-modo" data-modo="beerpong">Mostrar no telão</button></div>
      <p class="fraco" style="margin-top:8px">Times de 3 (mínimo 2). Mata-mata: quem tem menos gente passa direto primeiro se faltar adversário. Você marca quem passou; o telão mostra o time avançando.
        Campeões +${b.premios.campeao} cada, vice +${b.premios.vice} cada.</p>`);
  }

  // ---------------------------------------------------------------- corrida
  const NOME_NAIPE = { espadas: 'Espadas', copas: 'Copas', ouros: 'Ouros', paus: 'Paus' };
  let corridaRelogioAdm = null;
  let corridaFimAdm = null;
  function desenharCorridaAdmin(c) {
    clearInterval(corridaRelogioAdm);
    clearTimeout(corridaFimAdm);
    const apostas = c.apostas.map((a) => `<div class="item"><div class="item-nome">${a.simbolo} ${NOME_NAIPE[a.naipe]} <span class="selo">${a.pessoas.length}</span></div>
      <div class="item-sub">${a.pessoas.length ? esc(a.pessoas.join(', ')) : 'ninguém'}</div></div>`).join('');
    let acoes = '';
    if (c.estado === 'fechada' || c.estado === 'fim') acoes = `<button class="botao" type="button" data-acao="cor-apostas">🎟️ Abrir apostas: 1 minuto (corrida ${c.rodada + 1})</button>`;
    if (c.estado === 'apostas') acoes = `<p style="margin:0 0 6px">⏱️ Larga sozinha em <b id="cor-adm-seg">1:00</b> · ${c.total} ${c.total === 1 ? 'confirmado' : 'confirmados'}</p>
      <button class="botao" type="button" data-acao="cor-largar" ${c.total ? '' : 'disabled'}>🏁 Largar agora</button>
      <button class="botao secundario pequeno" type="button" data-acao="cor-cancelar">Cancelar</button>`;
    if (c.estado === 'correndo') acoes = '<p class="fraco">🏇 Correndo no telão (~2 a 3 min)… os pontos saem sozinhos no fim.</p><button class="botao secundario pequeno" type="button" data-acao="cor-cancelar">Cancelar (sem pontos)</button>';
    const resultado = c.estado === 'fim' && c.ordem ? `<p><b>Corrida ${c.rodada}:</b> 1º ${NOME_NAIPE[c.ordem[0]]} (+${c.premios[0]}), 2º ${NOME_NAIPE[c.ordem[1]]} (+${c.premios[1]}),
      último ${c.ultimos.map((n) => NOME_NAIPE[n]).join(' e ')} (shot).</p>` : '';
    const vazia = c.semApostas && c.estado === 'fechada' ? '<p class="aviso-inline">O minuto acabou sem ninguém confirmado: a corrida não largou. Abra as apostas de novo quando quiser.</p>' : '';
    pintar('j-corrida', `
      ${c.liberada ? '' : '<p class="aviso-inline">A Corrida está bloqueada: libere (ou coloque "Em teste") em Atividades.</p>'}
      ${c.emTeste ? '<p class="selo teste" style="display:inline-block">🧪 Em teste: só os testadores apostam</p>' : ''}
      <p><span class="selo ${c.estado === 'apostas' || c.estado === 'correndo' ? 'ok' : 'fora'}">${{ fechada: 'Fechada', apostas: 'Apostas abertas', correndo: 'Correndo', fim: 'Terminou' }[c.estado]}</span> · corrida ${c.rodada}</p>
      ${resultado}${vazia}
      <div class="item-acoes" style="margin:8px 0">${acoes}
        <button class="botao secundario pequeno" type="button" data-acao="tel-modo" data-modo="corrida">Mostrar no telão</button></div>
      ${c.rodada && c.estado !== 'fechada' ? `<div class="lista">${apostas}</div>` : ''}
      <p class="fraco" style="margin-top:8px">Abrir apostas → cada um escolhe um naipe no celular e salva (1 minuto) → a corrida larga sozinha no fim do minuto
        (ou toque "Largar agora"). 10 casas, ~2 a 3 min no telão. Prêmios: 1º +${c.premios[0]}, 2º +${c.premios[1]}; quem apostou no último toma um shot.</p>`);
    if (c.estado === 'apostas' && c.fechaEm) {
      const tique = () => {
        const ms = Math.max(0, c.fechaEm - PV.relogio.agora());
        const seg = Math.ceil(ms / 1000);
        const el = document.getElementById('cor-adm-seg');
        if (el) el.textContent = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
        if (ms <= 0) { clearInterval(corridaRelogioAdm); corridaFimAdm = setTimeout(() => A().recarregar(), 1500); }
      };
      tique();
      corridaRelogioAdm = setInterval(tique, 500);
    }
    if (c.estado === 'correndo' && c.fimEm) corridaFimAdm = setTimeout(() => A().recarregar(), Math.max(1000, c.fimEm - PV.relogio.agora() + 1500));
  }

  // ---------------------------------------------------------------- monstro
  const ESTADO_MONSTRO = { aberta: 'Vila aberta (entre rodadas)', jogando: 'Rodada acontecendo', votacao: 'Votação aberta', revelada: 'Revelada' };
  function desenharMonstroAdmin(m) {
    const vila = m.vila.map((p) => `<span class="selo" title="${esc(p.nome)}">${A().emojiDe(p.avatar)} ${esc(p.nome)}
      ${m.estado === 'aberta' || m.estado === 'revelada' ? `<button class="botao-x" type="button" data-acao="mon-tirar" data-id="${esc(p.id)}" aria-label="Tirar ${esc(p.nome)} da vila">✕</button>` : ''}</span>`).join(' ');
    const opcoes = Array.from({ length: m.maximo }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === m.sugestao ? 'selected' : ''}>${n} ${n === 1 ? 'monstro' : 'monstros'}${n === m.sugestao ? ' (sugerido)' : ''}</option>`).join('');
    let corpo = '';
    if (m.estado === 'aberta' || m.estado === 'revelada') {
      corpo = m.vila.length >= m.minVila
        ? `<div class="linha-teste" style="margin-top:10px"><select id="mon-qtd">${opcoes}</select>
            <button class="botao" type="button" data-acao="mon-iniciar">▶️ Começar rodada ${m.rodada + 1}</button></div>
            <p class="fraco">Sorteia os monstros em segredo, avisa quem está na vila e o telão troca sozinho.</p>`
        : `<p class="fraco">Precisa de pelo menos ${m.minVila} pessoas na vila para começar.</p>`;
    }
    if (m.estado === 'jogando' || m.estado === 'votacao') {
      const monstros = (m.monstros || []).map((x) => `<div class="item"><div class="item-topo"><span class="avatar">${A().emojiDe(x.avatar)}</span><div>
        <div class="item-nome">${esc(x.nome)} <span class="selo pendente">${x.vitimas.length}/${m.missao} almas</span></div>
        <div class="item-sub">${x.vitimas.length ? esc(x.vitimas.join(', ')) : 'nenhum brinde ainda'}</div></div></div></div>`).join('');
      const prontas = (m.prontas || []).map((t, i) => `<button class="botao secundario pequeno" type="button" data-acao="mon-pronta" data-i="${i}">${esc(t)}</button>`).join('');
      corpo = `<p class="fraco" style="margin:10px 0 6px">🔒 Só você vê quem é monstro:</p><div class="lista">${monstros}</div>
        <h4 style="margin:14px 0 6px">Pistas para o telão</h4>
        <div class="item-acoes" style="flex-wrap:wrap">${prontas}</div>
        <div class="linha-teste" style="margin-top:8px"><input id="mon-pista" maxlength="140" placeholder="Escreva uma pista…" style="flex:1">
          <button class="botao secundario pequeno" type="button" data-acao="mon-pista">Mandar</button></div>
        ${(m.pistas || []).length ? `<p class="fraco" style="margin-top:6px">Já no telão: ${m.pistas.map((p) => esc(p.texto)).join(' · ')}</p>` : ''}
        <div class="item-acoes" style="margin-top:12px">
          ${m.estado === 'jogando' ? '<button class="botao" type="button" data-acao="mon-votacao">🗳️ Abrir votação</button>'
            : `<button class="botao" type="button" data-acao="mon-revelar">🎭 Revelar no telão (${m.votaram} ${m.votaram === 1 ? 'voto' : 'votos'})</button>`}
          <button class="botao secundario pequeno" type="button" data-acao="mon-cancelar">Cancelar rodada</button>
        </div>
        ${m.estado === 'votacao' && m.contagem.length ? `<p class="fraco" style="margin-top:8px">Votos até agora: ${m.contagem.map((c) => `${esc(c.nome)} (${c.votos})`).join(', ')}</p>` : ''}`;
    }
    if (m.estado === 'revelada' && m.resultado) {
      corpo = `<p style="margin-top:10px"><b>Rodada ${m.rodada}:</b> ${m.resultado.monstros.map((x) => `${esc(x.nome)} (${x.almas} almas, ${x.votos} votos, ${x.descoberto ? 'descoberto' : 'escapou'})`).join('; ')}.
        ${m.resultado.acertaram.length} ${m.resultado.acertaram.length === 1 ? 'pessoa acertou' : 'pessoas acertaram'}.</p>${corpo}`;
    }
    pintar('j-monstro', `
      ${m.liberada ? '' : '<p class="aviso-inline">O Monstro está bloqueado: libere (ou coloque "Em teste") em Atividades.</p>'}
      ${m.emTeste ? '<p class="selo teste" style="display:inline-block">🧪 Em teste: só os testadores entram na vila</p>' : ''}
      <p><span class="selo ${m.estado === 'jogando' || m.estado === 'votacao' ? 'ok' : 'fora'}">${ESTADO_MONSTRO[m.estado] || m.estado}</span> · rodada ${m.rodada}</p>
      <p class="fraco">🏘️ <b>${m.vila.length}</b> na vila: ${vila || 'ninguém ainda'}</p>
      ${corpo}
      <div class="item-acoes" style="margin-top:8px"><button class="botao secundario pequeno" type="button" data-acao="tel-modo" data-modo="monstro">Mostrar o Monstro no telão</button></div>
      <p class="fraco" style="margin-top:8px">Ordem: começar rodada → mandar pistas → abrir votação → revelar → começar a próxima. Missão do monstro: brindar com ${m.missao} pessoas.
        Pontos: +1000 para quem acertar; monstro que escapa (não é o mais votado) +1000 e +100 por alma.</p>`);
    dadosMonstro = m;
  }
  let dadosMonstro = null;

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
    pintar('j-ranking', (r.length ? r.slice(0, 30).map((x) => `<div class="item"><div class="item-topo">
      <b style="width:34px;text-align:center">${x.posicao}º</b><span class="avatar">${A().emojiDe(x.avatar)}</span>
      <div class="item-nome" style="flex:1">${esc(x.nome)}</div><b style="color:var(--laranja-claro)">${x.pontos.toLocaleString('pt-BR')}</b></div></div>`).join('')
      : '<p class="fraco">Ninguém no ranking ainda.</p>')
      + '<button class="botao secundario pequeno" type="button" data-acao="tel-modo" data-modo="ranking" style="margin-top:8px">Mostrar ranking no telão</button>');
  }

  function desenhar(j) {
    dados = j;
    desenharPrevisoes(j.previsoes);
    desenharMaldicao(j.maldicao);
    desenharEnigmas(j.enigmas);
    desenharBebidas(j.bebidas);
    desenharRanking(j.ranking);
    desenharQuiz(j.quiz);
    desenharConcurso(j.concurso);
    desenharCorreio(j.correio);
    if (j.monstro && $('j-monstro')) desenharMonstroAdmin(j.monstro); // O Monstro saiu da festa (30/10)
    if (j.corrida) desenharCorridaAdmin(j.corrida);
    if (j.beerpong) desenharBeerpongAdmin(j.beerpong);
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
    if (oque === 'quiz-iniciar') { if (confirmarToque(b, 'Toque de novo: começar agora')) await fazer(() => api('POST', '/quiz/iniciar', { quantas: Number($('quiz-quantas').value) }), 'Quiz começando! Olhe o telão.'); }
    if (oque === 'quiz-encerrar') { if (confirmarToque(b)) await fazer(() => api('POST', '/quiz/encerrar'), 'Quiz parado.'); }
    if (oque === 'quiz-recomecar') { if (confirmarToque(b, 'Toque de novo: apagar respostas e pontos do quiz')) await fazer(() => api('POST', '/quiz/recomecar'), 'Quiz zerado.'); }
    if (oque === 'quiz-tempo') await fazer(() => api('PUT', '/quiz-tempo', { segundos: Number($('quiz-tempo').value) }), 'Tempo salvo.');
    if (oque === 'conc-tirar') await fazer(() => api('DELETE', `/concurso/desfilantes/${encodeURIComponent(id)}`), 'Tirado da lista do desfile.');
    if (oque === 'conc-desfile') await fazer(() => api('POST', '/concurso/desfile'), 'Telão: Hora do Desfile Macabro!');
    if (oque === 'conc-abrir') await fazer(() => api('POST', '/concurso/abrir'), 'Votação aberta. O telão já mostra.');
    if (oque === 'conc-encerrar') { if (confirmarToque(b)) await fazer(() => api('POST', '/concurso/encerrar'), 'Votação encerrada.'); }
    if (oque === 'conc-publicar') { if (confirmarToque(b, 'Toque de novo: publicar e dar os pontos')) await fazer(() => api('POST', '/concurso/publicar'), 'Resultado no telão. Pontos dados.'); }
    if (oque === 'conc-despublicar') { if (confirmarToque(b)) await fazer(() => api('POST', '/concurso/despublicar'), 'Resultado despublicado.'); }
    if (oque === 'cor-aprovar') await fazer(() => api('POST', `/correio/${id}/aprovar`), 'Aprovado: vai para o telão.');
    if (oque === 'cor-recusar') await fazer(() => api('POST', `/correio/${id}/recusar`), 'Fora do telão.');
    if (oque === 'mon-iniciar') { if (confirmarToque(b, 'Toque de novo: sortear os monstros')) await fazer(() => api('POST', '/monstro/iniciar', { quantos: Number($('mon-qtd').value) }), 'Rodada começou! Os monstros já sabem.'); }
    if (oque === 'mon-votacao') { if (confirmarToque(b, 'Toque de novo: abrir a votação')) await fazer(() => api('POST', '/monstro/votacao'), 'Votação aberta. O telão já mostra.'); }
    if (oque === 'mon-revelar') { if (confirmarToque(b, 'Toque de novo: revelar e dar os pontos')) await fazer(() => api('POST', '/monstro/revelar'), 'Revelado no telão!'); }
    if (oque === 'mon-cancelar') { if (confirmarToque(b, 'Toque de novo: cancelar sem pontos')) await fazer(() => api('POST', '/monstro/cancelar'), 'Rodada cancelada.'); }
    if (oque === 'mon-tirar') await fazer(() => api('DELETE', `/monstro/vila/${encodeURIComponent(id)}`), 'Tirado da vila.');
    if (oque === 'mon-pronta' && dadosMonstro) await fazer(() => api('POST', '/monstro/pista', { texto: dadosMonstro.prontas[Number(b.dataset.i)] }), 'Pista no telão.');
    if (oque === 'mon-pista') {
      const t = $('mon-pista').value.trim();
      if (t.length >= 3) { await fazer(() => api('POST', '/monstro/pista', { texto: t }), 'Pista no telão.'); $('mon-pista').value = ''; }
    }
    if (oque === 'bp-tirar') await fazer(() => api('DELETE', `/beerpong/inscritos/${encodeURIComponent(id)}`), 'Tirado das inscrições.');
    if (oque === 'bp-sortear') { if (confirmarToque(b, 'Toque de novo: sortear os times')) await fazer(() => api('POST', '/beerpong/sortear'), 'Sorteando no telão!'); }
    if (oque === 'bp-venceu') { if (confirmarToque(b, 'Toque de novo para confirmar')) await fazer(() => api('POST', `/beerpong/partida/${id}/${b.dataset.lado}`), 'Resultado no telão.'); }
    if (oque === 'bp-desfazer') { if (confirmarToque(b)) await fazer(() => api('POST', `/beerpong/desfazer/${id}`), 'Desfeito.'); }
    if (oque === 'bp-recomecar') { if (confirmarToque(b, 'Toque de novo: apagar a chave')) await fazer(() => api('POST', '/beerpong/recomecar'), 'Voltou às inscrições.'); }
    if (oque === 'cor-apostas') await fazer(() => api('POST', '/corrida/apostas'), 'Apostas abertas! O telão já mostra.');
    if (oque === 'cor-largar') { if (confirmarToque(b, 'Toque de novo: LARGAR!')) await fazer(() => api('POST', '/corrida/largar'), 'Largada! Olhe o telão.'); }
    if (oque === 'cor-cancelar') { if (confirmarToque(b, 'Toque de novo: cancelar a corrida')) await fazer(() => api('POST', '/corrida/cancelar'), 'Corrida cancelada.'); }
    if (oque === 'cor-auto') await fazer(() => api('PUT', '/correio-auto', { auto: b.dataset.auto === '1' }), b.dataset.auto === '1' ? 'Destravado: entra direto no telão.' : 'Travado: você aprova cada envio.');
    if (oque === 'cor-apagar') { if (confirmarToque(b, 'Toque de novo: apagar')) await fazer(() => api('DELETE', `/correio/${id}`), 'Apagado.'); }
    if (oque === 'cor-apagar-fotos') { if (confirmarToque(b, 'Toque de novo: apagar TODAS (some das Fotos da festa)')) await fazer(() => api('POST', '/correio-fotos/apagar'), 'Fotos apagadas.'); }
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
    const fq = e.target.closest('form[data-quiz-form]');
    if (fq) {
      e.preventDefault();
      const correta = fq.querySelector('input[name=correta]:checked');
      await A().acao(() => A().api('PUT', `/quiz/${encodeURIComponent(fq.dataset.quizForm)}`, {
        texto: fq.elements.texto.value, opcoes: [0, 1, 2, 3].map((i) => fq.elements[`op${i}`].value), correta: correta ? Number(correta.value) : -1,
      }), 'Pergunta salva.');
      document.activeElement.blur();
      A().recarregar();
      return;
    }
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
