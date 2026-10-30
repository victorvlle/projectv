// Painel do organizador.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let token = PV.guardado.ler('pv.admin');
  let estado = null;
  let avatares = [];
  let socket = null;
  let abaAtual = 'convidados';

  const emojiDe = (id) => (avatares.find((a) => a.id === id) || {}).emoji || '❔';

  // datetime-local <-> horário de Manaus (UTC-4, sem horário de verão).
  const msParaLocal = (ms) => new Date(ms - 4 * 3600 * 1000).toISOString().slice(0, 16);
  const localParaIso = (v) => `${v}:00-04:00`;

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

  async function acao(fn, sucesso) {
    try {
      const r = await fn();
      if (sucesso) PV.avisar(sucesso, 'ok');
      return r;
    } catch (erro) {
      if (erro.status !== 401) PV.avisar(erro.message, 'erro');
      return null;
    }
  }

  // ------------------------------------------------------------------ login
  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await PV.chamar('POST', '/api/admin/entrar', { corpo: { senha: $('senha').value } });
      token = r.token;
      PV.guardado.gravar('pv.admin', token);
      $('senha').value = '';
      iniciarPainel();
    } catch (erro) {
      PV.avisar(erro.message, 'erro');
    }
  });
  $('sair').addEventListener('click', sair);

  // ------------------------------------------------------------------- abas
  document.querySelector('.abas').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-aba]');
    if (!b) return;
    abaAtual = b.dataset.aba;
    document.querySelectorAll('.abas button').forEach((x) => x.classList.toggle('ativa', x === b));
    document.querySelectorAll('[data-painel]').forEach((p) => p.classList.toggle('oculto', p.dataset.painel !== abaAtual));
    if (abaAtual === 'festa') preencherFesta();
  });

  // -------------------------------------------------------------- convidados
  function desenharConvidados() {
    const lista = estado.convidados;
    const comPerfil = lista.filter((c) => c.ativo && c.perfilCompleto).length;
    $('resumo-convidados').innerHTML = `
      <div><b>${lista.filter((c) => c.ativo).length}</b><small>Pagantes</small></div>
      <div><b>${comPerfil}</b><small>Com perfil</small></div>
      <div><b>${lista.filter((c) => c.ativo && c.fora).length}</b><small>Fora</small></div>`;

    const termo = $('busca').value.trim().toLowerCase();
    const filtrados = lista.filter((c) => !termo || c.nome.toLowerCase().includes(termo));
    $('lista-convidados').innerHTML = filtrados.map((c) => `
      <div class="item ${c.ativo ? '' : 'inativo'}" data-id="${c.id}">
        <div class="item-topo">
          <span class="avatar">${c.avatar ? emojiDe(c.avatar) : '·'}</span>
          <div style="min-width:0">
            <div class="item-nome">${PV.esc(c.nome)}
              ${!c.ativo ? '<span class="selo off">desativado</span>'
                : c.perfilCompleto ? '<span class="selo ok">entrou</span>' : '<span class="selo pendente">não entrou</span>'}
              ${c.fora ? '<span class="selo fora">fora</span>' : ''}
              ${c.testador ? '<span class="selo teste">🧪 testador</span>' : ''}
            </div>
            <div class="item-sub">${c.pontos.toLocaleString('pt-BR')} pts</div>
          </div>
        </div>
        <div class="item-acoes">
          <button class="botao pequeno" data-acao="copiar">Copiar link</button>
          <button class="botao secundario pequeno" data-acao="whats">WhatsApp</button>
          <button class="botao secundario pequeno" data-acao="fora">${c.fora ? 'Está aqui' : 'Marcar fora'}</button>
          <button class="botao secundario pequeno" data-acao="regenerar">Novo link</button>
          <button class="botao secundario pequeno" data-acao="ativo">${c.ativo ? 'Desativar' : 'Reativar'}</button>
          <button class="botao secundario pequeno" data-acao="renomear">Renomear</button>
          <button class="botao secundario pequeno" data-acao="testador">${c.testador ? 'Tirar de testador' : 'Marcar testador'}</button>
          <button class="botao perigo pequeno" data-acao="excluir">Excluir</button>
        </div>
      </div>`).join('') || '<p class="fraco">Nenhum convidado ainda.</p>';
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      PV.avisar('Link copiado.', 'ok');
    } catch (_) {
      window.prompt('Copie o link:', texto);
    }
  }

  // Texto do convite no WhatsApp (aprovado pelo organizador em 24/10). Data, horário e
  // local vêm das informações da festa, então mudar no admin muda aqui também.
  function horaTexto(ms) {
    const [h, m] = PV.dataHora(ms, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':');
    if (h === '00' && m === '00') return 'meia-noite';
    return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
  }
  function mensagemConvite(primeiro, link) {
    const f = estado.festa;
    const semana = PV.dataHora(f.inicioMs, { weekday: 'long' }).replace(/-feira$/, '');
    const dia = PV.dataHora(f.inicioMs, { day: '2-digit', month: '2-digit' });
    const fim = horaTexto(f.fimMs);
    const quando = `${semana[0].toUpperCase()}${semana.slice(1)}, ${dia}, das ${horaTexto(f.inicioMs)} ${fim === 'meia-noite' ? 'à' : 'às'} ${fim}`;
    return [
      '🎃 *Project V — Edição Halloween* 🎃',
      '',
      `Fala, *${primeiro}*! Seu convite chegou 👻`,
      '',
      'Esse é o seu acesso à festa:',
      link,
      '',
      '⚠️ *Esse link é só seu.* Ele é único e está ligado ao seu nome. *Não repasse para ninguém*: quem abrir entra como você.',
      '',
      'Lá dentro você escolhe o seu monstro, acompanha a contagem regressiva e marca nas *Contribuições* o que puder levar. '
        + 'Com o tempo, os ícones vão sendo desbloqueados… fique de olho. 🔒',
      '',
      `🗓️ *${quando}*`,
      `📍 ${f.local}`,
      '🧛 Fantasia obrigatória!',
      '',
      'Te espero lá. Se tiver coragem. 💀',
    ].join('\n');
  }

  $('busca').addEventListener('input', () => estado && desenharConvidados());

  $('form-novos').addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = $('novos').value.trim();
    if (!texto) return;
    const r = await acao(() => api('POST', '/convidados', { nome: texto }));
    if (r) {
      $('novos').value = '';
      PV.avisar(`${r.criados.length} convidado(s) adicionado(s).`, 'ok');
      await carregar();
    }
  });

  $('lista-convidados').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-acao]');
    if (!b) return;
    const id = b.closest('.item').dataset.id;
    const c = estado.convidados.find((x) => x.id === id);
    if (!c) return;
    const primeiro = c.nome.split(' ')[0];
    switch (b.dataset.acao) {
      case 'copiar': return copiar(c.link);
      case 'whats':
        return window.open(`https://wa.me/?text=${encodeURIComponent(mensagemConvite(primeiro, c.link))}`, '_blank', 'noopener');
      case 'fora': await acao(() => api('PATCH', `/convidados/${id}`, { fora: !c.fora })); break;
      case 'testador':
        await acao(() => api('PATCH', `/convidados/${id}`, { testador: !c.testador }),
          c.testador ? `${c.nome} não é mais testador.` : `${c.nome} agora vê as atividades "Em teste".`);
        break;
      case 'ativo':
        if (c.ativo && !confirm(`Desativar ${c.nome}? O link dele para de funcionar.`)) return;
        await acao(() => api('PATCH', `/convidados/${id}`, { ativo: !c.ativo }), c.ativo ? 'Desativado.' : 'Reativado.');
        break;
      case 'regenerar':
        if (!confirm(`Gerar um link novo para ${c.nome}? O link antigo para de funcionar na hora.`)) return;
        await acao(() => api('POST', `/convidados/${id}/regenerar`), 'Link novo gerado. Mande para a pessoa.');
        break;
      case 'renomear': {
        const nome = prompt('Novo nome:', c.nome);
        if (!nome) return;
        await acao(() => api('PATCH', `/convidados/${id}`, { nome }), 'Nome atualizado.');
        break;
      }
      case 'excluir':
        if (!confirm(`Excluir ${c.nome} de vez? Os pontos dele também somem.`)) return;
        await acao(() => api('DELETE', `/convidados/${id}`), 'Excluído.');
        break;
      default: return;
    }
    await carregar();
  });

  // ---------------------------------------------------------------- bebidas
  let bebidas = null;
  function desenharBebidas() {
    if (!bebidas) return;
    $('bebidas-estado').textContent = bebidas.aberta ? '🟢 Lista aberta' : '🔒 Lista fechada';
    $('alternar-bebidas').textContent = bebidas.aberta ? 'Fechar lista' : 'Reabrir lista';
    const pessoas = (quem) => (quem.length ? `<div class="quem-admin">${quem.map((q) => `
      <div><span>${q.avatar ? emojiDe(q.avatar) : '·'} ${PV.esc(q.nome)} — <b>${q.quantidade}</b></span>
        <button type="button" data-tirar="${q.compromissoId}" aria-label="Remover">✕</button></div>`).join('')}</div>` : '');
    const itens = bebidas.itens.map((i) => {
      const ok = i.meta > 0 && i.falta === 0;
      const pct = i.meta > 0 ? Math.min(100, Math.round((i.total / i.meta) * 100)) : 0;
      return `<div class="item" data-item="${i.id}">
        <div class="item-topo" style="justify-content:space-between">
          <div><div class="item-nome">${PV.esc(i.nome)}</div>
            <div class="item-sub">${i.total}${i.meta > 0 ? ` de ${i.meta}` : ''} ${PV.esc(i.unidade)}${i.meta > 0 ? (ok ? ' · garantido' : ` · faltam ${i.falta}`) : ' · sem meta'}</div></div>
          <div class="item-acoes" style="margin:0;flex-wrap:nowrap">
            <button class="botao secundario pequeno" data-editar>Editar</button>
            <button class="botao perigo pequeno" data-excluir>Excluir</button>
          </div>
        </div>
        ${i.meta > 0 ? `<div class="barra-meta ${ok ? 'ok' : ''}"><i style="width:${pct}%"></i></div>` : ''}
        ${pessoas(i.quem)}
      </div>`;
    }).join('');
    const outras = bebidas.outras.map((o) => `<div class="item">
        <div class="item-nome">${PV.esc(o.nome)} <span class="selo fora">fora da lista</span></div>
        <div class="item-sub">${o.total} ${PV.esc(o.unidade)}</div>
        ${pessoas(o.quem)}
      </div>`).join('');
    $('lista-bebidas').innerHTML = itens + outras || '<p class="fraco">Nenhuma bebida na lista.</p>';
  }

  $('alternar-bebidas').addEventListener('click', async () => {
    const r = await acao(() => api('PUT', '/bebidas/aberta', { aberta: !bebidas.aberta }));
    if (r) { bebidas = r.bebidas; desenharBebidas(); }
  });

  $('form-bebida').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await acao(() => api('POST', '/bebidas/itens', {
      nome: $('b-nome').value, unidade: $('b-unidade').value, meta: Number($('b-meta').value || 0),
    }), 'Bebida adicionada.');
    if (r) {
      bebidas = r.bebidas; desenharBebidas();
      $('b-nome').value = ''; $('b-unidade').value = ''; $('b-meta').value = '0';
    }
  });

  $('lista-bebidas').addEventListener('click', async (e) => {
    const tirar = e.target.closest('[data-tirar]');
    const card = e.target.closest('[data-item]');
    let r = null;
    if (tirar) {
      if (!confirm('Remover esta bebida da parte dessa pessoa?')) return;
      r = await acao(() => api('DELETE', `/bebidas/compromissos/${tirar.dataset.tirar}`), 'Removido.');
    } else if (card && e.target.closest('[data-excluir]')) {
      const item = bebidas.itens.find((i) => i.id === Number(card.dataset.item));
      if (!confirm(`Tirar "${item.nome}" da lista? Quem já marcou continua levando (vira "fora da lista").`)) return;
      r = await acao(() => api('DELETE', `/bebidas/itens/${item.id}`), 'Tirado da lista.');
    } else if (card && e.target.closest('[data-editar]')) {
      const item = bebidas.itens.find((i) => i.id === Number(card.dataset.item));
      const nome = prompt('Nome:', item.nome);
      if (nome === null) return;
      const unidade = prompt('Unidade (latas, garrafas, sacos…):', item.unidade);
      if (unidade === null) return;
      const meta = prompt('Meta (0 = sem meta):', String(item.meta));
      if (meta === null) return;
      r = await acao(() => api('PATCH', `/bebidas/itens/${item.id}`, { nome, unidade, meta: Number(meta) }), 'Atualizado.');
    }
    if (r) { bebidas = r.bebidas; desenharBebidas(); }
  });

  // ------------------------------------------------- extras: pós, playlist, caronas
  let extras = null;
  function desenharExtras() {
    if (!extras) return;
    const p = extras.pos;
    $('pos-admin-status').textContent = p.encerrada ? '· encerrada' : p.aberta ? '· votação aberta' : '· fechada até as 23h';
    $('pos-admin').innerHTML = p.opcoes.map((o) => `
      <div class="item" data-pos="${o.id}">
        <div class="item-topo" style="justify-content:space-between">
          <div><div class="item-nome">${p.lideres.includes(o.id) ? '👑 ' : ''}${PV.esc(o.nome)}</div>
            <div class="item-sub">${o.votos} ${o.votos === 1 ? 'voto' : 'votos'}</div></div>
          <div class="item-acoes" style="margin:0;flex-wrap:nowrap">
            <button class="botao secundario pequeno" data-renomear>Renomear</button>
            <button class="botao perigo pequeno" data-excluir>Excluir</button>
          </div>
        </div>
      </div>`).join('');
    $('playlist-admin').innerHTML = extras.playlist.musicas.map((m, i) => `
      <div class="item" data-musica="${m.id}"><div class="item-topo" style="justify-content:space-between">
        <div><div class="item-nome">${i + 1}. ${PV.esc(m.titulo)} — ${PV.esc(m.artista)}</div>
          <div class="item-sub">🔥 ${m.votos} · sugerida por ${PV.esc(m.autor)}</div></div>
        <button class="botao perigo pequeno" data-tirar-musica>Tirar</button></div></div>`).join('')
      || '<p class="fraco">Nenhuma música ainda.</p>';
    $('caronas-admin').innerHTML = extras.caronas.caronas.map((c) => `
      <div class="item" data-carona="${c.id}"><div class="item-topo" style="justify-content:space-between">
        <div><div class="item-nome">${PV.esc(c.motorista)} · ${c.vagas - c.livres}/${c.vagas}</div>
          <div class="item-sub">${PV.esc(c.trajetoTexto)} · ${PV.esc(c.saindo)}${c.passageiros.length ? ' · ' + c.passageiros.map((x) => PV.esc(x.nome)).join(', ') : ''}</div></div>
        <button class="botao perigo pequeno" data-tirar-carona>Tirar</button></div></div>`).join('')
      || '<p class="fraco">Nenhuma carona ainda.</p>';
  }

  $('tela-painel').addEventListener('click', async (e) => {
    const pos = e.target.closest('[data-pos]');
    let ok = null;
    if (pos && e.target.closest('[data-renomear]')) {
      const nome = prompt('Novo nome:', extras.pos.opcoes.find((o) => o.id === Number(pos.dataset.pos)).nome);
      if (!nome) return;
      ok = await acao(() => api('PATCH', `/pos/opcoes/${pos.dataset.pos}`, { nome }), 'Renomeado.');
    } else if (pos && e.target.closest('[data-excluir]')) {
      if (!confirm('Excluir esse lugar? Os votos nele somem.')) return;
      ok = await acao(() => api('DELETE', `/pos/opcoes/${pos.dataset.pos}`), 'Excluído.');
    } else if (e.target.closest('[data-tirar-musica]')) {
      if (!confirm('Tirar essa música da playlist?')) return;
      ok = await acao(() => api('DELETE', `/playlist/${e.target.closest('[data-musica]').dataset.musica}`), 'Música retirada.');
    } else if (e.target.closest('[data-tirar-carona]')) {
      if (!confirm('Tirar essa carona? Quem reservou fica sem.')) return;
      ok = await acao(() => api('DELETE', `/caronas/${e.target.closest('[data-carona]').dataset.carona}`), 'Carona retirada.');
    }
    if (ok) carregar();
  });

  $('form-pos').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = $('pos-nova').value.trim();
    if (!nome) return;
    if (await acao(() => api('POST', '/pos/opcoes', { nome }), 'Lugar adicionado.')) { $('pos-nova').value = ''; carregar(); }
  });

  // ------------------------------------------------------------------ avisos
  let avisos = null;
  function desenharAvisos() {
    if (!avisos) return;
    const r = avisos.resumo;
    $('resumo-avisos').innerHTML = `
      <div><b>${r.pessoas}</b><small>Com avisos</small></div>
      <div><b>${Math.max(0, r.convidados - r.pessoas)}</b><small>Sem avisos</small></div>
      <div><b>${r.aparelhos}</b><small>Aparelhos</small></div>`;
    const escolhido = $('teste-para').value;
    $('teste-para').innerHTML = avisos.inscritos.length
      ? avisos.inscritos.map((i) => `<option value="${PV.esc(i.id)}">${PV.esc(i.nome)} (${i.aparelhos})</option>`).join('')
      : '<option value="">Ninguém ativou ainda</option>';
    if (avisos.inscritos.some((i) => i.id === escolhido)) $('teste-para').value = escolhido;
    $('teste-enviar').disabled = !avisos.inscritos.length;
    const NOMES = { 'agenda:vespera': 'Véspera', 'agenda:contribuicoes': 'Contribuições', 'agenda:faltam2h': 'Faltam 2 horas',
      'agenda:portoes': 'Portões', 'agenda:campeao-pos': 'Campeão do pós', 'teste:aparelho': 'Testes pedidos pelos convidados',
      'teste:admin': 'Testes do organizador' };
    const nomeDe = (k) => NOMES[k] || (k.startsWith('manual:') ? 'Aviso do organizador' : k.startsWith('liberou:') ? `Liberou ${k.slice(8)}`
      : k.startsWith('social:') ? `Movimento dos amigos (${k.split(':')[1]})` : k);
    $('registro-avisos').innerHTML = (avisos.registro || []).map((r) => `
      <div class="item"><div class="item-nome">${PV.esc(nomeDe(r.chave))}</div>
        <div class="item-sub">${PV.dataCurta(r.ultimo)} · ${r.ok} entregue(s)${r.falha ? ` · <span class="falhou">${r.falha} falha(s)</span>` : ''}${r.expirada ? ` · ${r.expirada} expirada(s)` : ''}${r.limite ? ` · ${r.limite} segurado(s) pelo limite/h` : ''}</div></div>`).join('')
      || '<p class="fraco">Nada nas últimas 24 horas.</p>';
    $('programados').innerHTML = avisos.programados.map((p) => `
      <div class="item"><div class="item-nome">${PV.esc(p.nome)}
        ${p.enviado ? '<span class="selo ok">enviado</span>' : '<span class="selo pendente">pendente</span>'}</div>
        <div class="item-sub">${PV.dataCurta(p.quando)}${p.enviado ? ` · chegou em ${p.entregues} aparelho(s)${p.falhas ? ` · ${p.falhas} falha(s)` : ''}` : ''}</div></div>`).join('');
    $('historico-avisos').innerHTML = avisos.historico.filter((h) => h.titulo !== '(sem envio)').map((h) => `
      <div class="item"><div class="item-nome">${PV.esc(h.titulo)}</div>
        <div class="item-sub">${PV.esc(h.corpo)}</div>
        <div class="item-sub">${PV.dataCurta(h.enviadoEm)} · ${h.para} pessoa(s), ${h.entregues} aparelho(s)${h.falhas ? ` · <span class="falhou">${h.falhas} falha(s)</span>` : ''}</div></div>`).join('')
      || '<p class="fraco">Nada enviado ainda.</p>';
  }

  // Envio em massa: primeiro revisa (público estimado + prévia), depois confirma.
  // O id do envio nasce na revisão: clicar duas vezes em "Confirmar" não manda duas vezes.
  const novoId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
  let envioPendente = null;
  function fecharConfirmacao() { envioPendente = null; $('confirmar-aviso').classList.add('oculto'); $('aviso-revisar').disabled = false; }
  $('form-aviso').addEventListener('submit', (e) => {
    e.preventDefault();
    const corpo = $('aviso-corpo').value.trim();
    if (corpo.length < 2) { PV.avisar('Escreva a mensagem.', 'erro'); return; }
    const r = avisos ? avisos.resumo : { pessoas: 0, aparelhos: 0 };
    const sel = $('aviso-url');
    const tituloBruto = $('aviso-titulo').value.trim();
    envioPendente = { id: novoId(), titulo: tituloBruto, corpo, url: sel.value };
    const tituloFinal = !tituloBruto ? 'Project V' : /^project v\b/i.test(tituloBruto) ? tituloBruto : `Project V: ${tituloBruto}`;
    $('aviso-revisar').disabled = true;
    const box = $('confirmar-aviso');
    box.innerHTML = r.aparelhos ? `
      <p><b>Vai para ${r.pessoas} pessoa(s), em ${r.aparelhos} aparelho(s).</b></p>
      <div class="previa"><b>${PV.esc(tituloFinal)}</b><span>${PV.esc(corpo)}</span><small>Ao tocar: ${PV.esc(sel.options[sel.selectedIndex].text)}</small></div>
      <div class="linha-teste"><button class="botao" type="button" id="aviso-confirmar">Confirmar envio</button>
        <button class="botao secundario" type="button" id="aviso-cancelar">Cancelar</button></div>`
      : `<p>Ninguém ativou as notificações ainda: não há para quem mandar.</p>
        <button class="botao secundario" type="button" id="aviso-cancelar">Fechar</button>`;
    box.classList.remove('oculto');
    (box.querySelector('#aviso-confirmar') || box.querySelector('#aviso-cancelar')).focus();
  });
  document.addEventListener('click', async (e) => {
    if (e.target.id === 'aviso-cancelar') fecharConfirmacao();
    if (e.target.id !== 'aviso-confirmar' || !envioPendente) return;
    const botao = e.target;
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    const r = await acao(() => api('POST', '/avisos', envioPendente));
    if (!r) { botao.disabled = false; botao.textContent = 'Tentar de novo'; return; } // mesmo id: não duplica
    const falhas = r.falhas ? ` · ${r.falhas} falha(s)` : '';
    const expiradas = r.expiradas ? ` · ${r.expiradas} aparelho(s) expirado(s) removido(s)` : '';
    $('confirmar-aviso').innerHTML = r.pulado
      ? '<p>Esse aviso já tinha sido enviado. Nada foi repetido.</p>'
      : `<p class="ok-envio">Enviado: chegou ao serviço de push em ${r.entregues} de ${r.aparelhos} aparelho(s)${falhas}${expiradas}.</p>`;
    envioPendente = null;
    $('aviso-corpo').value = '';
    $('aviso-revisar').disabled = false;
    carregar();
  });

  $('teste-enviar').addEventListener('click', async () => {
    const id = $('teste-para').value;
    if (!id) return;
    const b = $('teste-enviar');
    b.disabled = true;
    const r = await acao(() => api('POST', '/avisos/teste', { convidadoId: id }));
    $('teste-resultado').textContent = r
      ? `Teste para ${r.nome}: chegou ao serviço de push em ${r.entregues} de ${r.aparelhos} aparelho(s)${r.falhas ? `, ${r.falhas} falha(s)` : ''}.`
      : '';
    setTimeout(() => { b.disabled = false; }, 3000);
  });

  // -------------------------------------------------------------- atividades
  function desenharAtividades() {
    $('lista-atividades').innerHTML = estado.atividades.map((a) => `
      <div class="item ${a.estado === 'teste' ? 'item-teste' : ''}" data-id="${a.id}">
        <div class="item-topo">
          <span class="avatar">${a.icone}</span>
          <div>
            <div class="item-nome">${PV.esc(a.nome)}</div>
            <div class="item-sub">Cadeado: “${PV.esc(a.enigma)}” · agora: <b>${a.efetivo === 'teste' ? 'em teste (só testadores)' : a.efetivo}</b>
              ${a.estado === 'agendada' && a.abreEm ? ` · abre ${PV.dataCurta(a.abreEm)}` : ''}</div>
          </div>
        </div>
        <div class="estados">
          ${[['bloqueada', 'Bloqueada'], ['teste', '🧪 Em teste'], ['agendada', 'Agendada'], ['liberada', 'Liberada']].map(([s, rot]) => `<button data-estado="${s}" class="${a.estado === s ? 'ativo' : ''}">${rot}</button>`).join('')}
        </div>
        <div class="agendar">
          <input type="datetime-local" value="${a.abreEm ? msParaLocal(a.abreEm) : ''}" aria-label="Data e hora para abrir">
          <button class="botao secundario pequeno" data-agendar>Agendar</button>
        </div>
      </div>`).join('');
  }

  $('lista-atividades').addEventListener('click', async (e) => {
    const item = e.target.closest('.item');
    if (!item) return;
    const id = item.dataset.id;
    const bEstado = e.target.closest('button[data-estado]');
    if (bEstado && bEstado.dataset.estado !== 'agendada') {
      await acao(() => api('PUT', `/atividades/${id}`, { estado: bEstado.dataset.estado }), 'Atualizado.');
      return carregar();
    }
    if (bEstado || e.target.closest('[data-agendar]')) {
      const v = item.querySelector('input[type=datetime-local]').value;
      if (!v) return PV.avisar('Escolha data e hora para agendar.', 'erro');
      await acao(() => api('PUT', `/atividades/${id}`, { estado: 'agendada', abreEm: localParaIso(v) }), 'Agendado.');
      return carregar();
    }
    return null;
  });

  // Testadores e botão de apagar dados de teste.
  function desenharTeste() {
    const t = estado.convidados.filter((c) => c.testador && c.ativo).map((c) => c.nome);
    const emTeste = estado.atividades.filter((a) => a.estado === 'teste').map((a) => a.nome);
    $('teste-resumo').textContent = `Testadores: ${t.length ? t.join(', ') : 'ninguém (marque na aba Convidados)'}. `
      + `Em teste agora: ${emTeste.length ? emTeste.join(', ') : 'nenhuma atividade'}.`;
  }
  $('apagar-teste').addEventListener('click', async () => {
    if (!confirm('Apagar todos os dados de teste? Pontos, respostas, votos, cartas e maldições de teste somem, e as atividades em teste voltam a ficar bloqueadas.')) return;
    const r = await acao(() => api('POST', '/teste/apagar'));
    if (r) {
      PV.avisar(`Dados de teste apagados: ${r.pontos} pontos, ${r.quiz} respostas, ${r.votos} votos, ${r.cartas} cartas, ${r.maldicoes} maldições, ${r.palpites} palpites.`, 'ok');
      carregar();
    }
  });

  // ------------------------------------------------------------------- telão
  function desenharTelao() {
    document.querySelectorAll('#modos-telao button').forEach((b) => b.classList.toggle('ativo', b.dataset.modo === estado.telao.modo));
    if (document.activeElement !== $('msg-telao')) $('msg-telao').value = estado.telao.mensagem || '';
    const prog = $('programacao');
    if (!prog.contains(document.activeElement)) {
      const p = estado.telao.programacao || {};
      prog.innerHTML = estado.atividades.filter((a) => !['previsoes', 'correio', 'fotos'].includes(a.id)).map((a) => `<label class="item linha-prog">
        <span>${PV.esc(a.icone)} ${PV.esc(a.nome)}</span><input type="time" data-prog="${PV.esc(a.id)}" value="${PV.esc(p[a.id] || "")}"></label>`).join('');
    }
  }
  $('salvar-programacao').addEventListener('click', async () => {
    const programacao = {};
    document.querySelectorAll('#programacao [data-prog]').forEach((i) => { programacao[i.dataset.prog] = i.value; });
    await acao(() => api('PUT', '/telao', { programacao }), 'Programação no telão.');
    carregar();
  });
  $('modos-telao').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-modo]');
    if (!b) return;
    await acao(() => api('PUT', '/telao', { modo: b.dataset.modo }));
    carregar();
  });
  $('salvar-msg').addEventListener('click', async () => {
    await acao(() => api('PUT', '/telao', { modo: 'mensagem', mensagem: $('msg-telao').value }), 'Mensagem no telão.');
    carregar();
  });

  // ------------------------------------------------------------------- festa
  function preencherFesta() {
    if (!estado) return;
    const f = estado.festa;
    $('f-nome').value = f.nome || '';
    $('f-inicio').value = msParaLocal(f.inicioMs);
    $('f-fim').value = msParaLocal(f.fimMs);
    $('f-local').value = f.local || '';
    $('f-dress').value = f.dressCode || '';
    $('f-levar').value = f.oQueLevar || '';
    $('f-regras').value = f.regras || '';
    $('f-endereco').value = f.chegada.endereco || '';
    $('f-portaria').value = f.chegada.portaria || '';
    $('f-estacionamento').value = f.chegada.estacionamento || '';
    $('f-chegada-obs').value = f.chegada.obs || '';
  }
  $('form-festa').addEventListener('submit', async (e) => {
    e.preventDefault();
    await acao(() => api('PUT', '/festa', {
      nome: $('f-nome').value,
      inicio: localParaIso($('f-inicio').value),
      fim: localParaIso($('f-fim').value),
      local: $('f-local').value,
      dressCode: $('f-dress').value,
      oQueLevar: $('f-levar').value,
      regras: $('f-regras').value,
      chegadaEndereco: $('f-endereco').value,
      chegadaPortaria: $('f-portaria').value,
      chegadaEstacionamento: $('f-estacionamento').value,
      chegadaObs: $('f-chegada-obs').value,
    }), 'Informações salvas.');
    carregar();
  });

  // ------------------------------------------------------------------ backup
  $('baixar-backup').addEventListener('click', async () => {
    try {
      const resposta = await fetch('/api/admin/backup', { headers: { Authorization: `Bearer ${token}` } });
      if (!resposta.ok) throw new Error('Não consegui gerar o backup.');
      const blob = await resposta.blob();
      const nome = (resposta.headers.get('Content-Disposition') || '').match(/filename="(.+)"/);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nome ? nome[1] : 'projectv-backup.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      PV.avisar('Backup baixado.', 'ok');
    } catch (erro) {
      PV.avisar(erro.message, 'erro');
    }
  });
  $('restaurar-backup').addEventListener('click', async () => {
    const arquivo = $('arquivo-backup').files[0];
    if (!arquivo) return PV.avisar('Escolha o arquivo de backup.', 'erro');
    if (!confirm('Restaurar substitui TODOS os dados atuais. Continuar?')) return;
    const texto = await arquivo.text();
    const r = await acao(() => api('POST', '/restaurar', texto));
    if (r) {
      PV.avisar(`Restaurado: ${r.linhas} registros.`, 'ok');
      carregar();
    }
  });

  // -------------------------------------------------------------- carregar
  async function carregar() {
    const [r, b, x, av, jg] = await Promise.all([api('GET', '/estado'), api('GET', '/bebidas'), api('GET', '/extras'), api('GET', '/avisos'), api('GET', '/jogos')]);
    if (window.PVAdminJogos) window.PVAdminJogos.desenhar(jg);
    extras = x;
    avisos = av;
    PV.relogio.sincronizar(r.agora);
    estado = r;
    bebidas = b.bebidas;
    desenharBebidas();
    desenharExtras();
    desenharAvisos();
    const ondeBanco = { turso: 'banco: Turso', arquivo: 'banco: arquivo', memoria: 'banco: memória' }[r.banco] || '';
    $('info-banco').textContent = ondeBanco;
    desenharConvidados();
    desenharAtividades();
    desenharTeste();
    desenharTelao();
  }

  // Ponte para jogos.js (aba Jogos).
  window.PVAdmin = { token: () => token, api, acao, emojiDe, recarregar: () => carregar().catch(() => {}), msParaLocal, localParaIso };

  async function iniciarPainel() {
    $('tela-login').classList.add('oculto');
    $('tela-painel').classList.remove('oculto');
    try {
      avatares = (await PV.chamar('GET', '/api/avatares')).avatares;
      await carregar();
    } catch (_) { return; }
    const recarregar = PV.adiar(() => carregar().catch(() => {}));
    socket = PV.conectar({
      tipo: 'admin', token,
      aoConectar: recarregar,
      aoNegar: sair,
      eventos: { atualizar: recarregar },
    });
  }

  if (token) iniciarPainel();
  else $('tela-login').classList.remove('oculto');
})();
