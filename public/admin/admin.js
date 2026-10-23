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
    const filtrados = lista.filter((c) => !termo || `${c.nome} ${c.apelido || ''}`.toLowerCase().includes(termo));
    $('lista-convidados').innerHTML = filtrados.map((c) => `
      <div class="item ${c.ativo ? '' : 'inativo'}" data-id="${c.id}">
        <div class="item-topo">
          <span class="avatar">${c.avatar ? emojiDe(c.avatar) : '·'}</span>
          <div style="min-width:0">
            <div class="item-nome">${PV.esc(c.nome)}
              ${!c.ativo ? '<span class="selo off">desativado</span>'
                : c.perfilCompleto ? '<span class="selo ok">entrou</span>' : '<span class="selo pendente">não entrou</span>'}
              ${c.fora ? '<span class="selo fora">fora</span>' : ''}
            </div>
            <div class="item-sub">${c.apelido ? PV.esc(c.apelido) + ' · ' : ''}${c.pontos} pts</div>
          </div>
        </div>
        <div class="item-acoes">
          <button class="botao pequeno" data-acao="copiar">Copiar link</button>
          <button class="botao secundario pequeno" data-acao="whats">WhatsApp</button>
          <button class="botao secundario pequeno" data-acao="fora">${c.fora ? 'Está aqui' : 'Marcar fora'}</button>
          <button class="botao secundario pequeno" data-acao="regenerar">Novo link</button>
          <button class="botao secundario pequeno" data-acao="ativo">${c.ativo ? 'Desativar' : 'Reativar'}</button>
          <button class="botao secundario pequeno" data-acao="renomear">Renomear</button>
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
      case 'whats': {
        const msg = `Oi, ${primeiro}! 🎃 Seu convite do Project V — Edição Halloween: ${c.link}\nEle é só seu, não repasse 👻`;
        return window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      }
      case 'fora': await acao(() => api('PATCH', `/convidados/${id}`, { fora: !c.fora })); break;
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

  // -------------------------------------------------------------- atividades
  function desenharAtividades() {
    $('lista-atividades').innerHTML = estado.atividades.map((a) => `
      <div class="item" data-id="${a.id}">
        <div class="item-topo">
          <span class="avatar">${a.icone}</span>
          <div>
            <div class="item-nome">${PV.esc(a.nome)}</div>
            <div class="item-sub">Cadeado: “${PV.esc(a.enigma)}” · agora: <b>${a.efetivo}</b>
              ${a.estado === 'agendada' && a.abreEm ? ` · abre ${PV.dataCurta(a.abreEm)}` : ''}</div>
          </div>
        </div>
        <div class="estados">
          ${['bloqueada', 'agendada', 'liberada'].map((s) => `<button data-estado="${s}" class="${a.estado === s ? 'ativo' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
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

  // ------------------------------------------------------------------- telão
  function desenharTelao() {
    document.querySelectorAll('#modos-telao button').forEach((b) => b.classList.toggle('ativo', b.dataset.modo === estado.telao.modo));
    if (document.activeElement !== $('msg-telao')) $('msg-telao').value = estado.telao.mensagem || '';
  }
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
    $('f-local').value = f.local || '';
    $('f-dress').value = f.dressCode || '';
    $('f-levar').value = f.oQueLevar || '';
    $('f-regras').value = f.regras || '';
  }
  $('form-festa').addEventListener('submit', async (e) => {
    e.preventDefault();
    await acao(() => api('PUT', '/festa', {
      nome: $('f-nome').value,
      inicio: localParaIso($('f-inicio').value),
      local: $('f-local').value,
      dressCode: $('f-dress').value,
      oQueLevar: $('f-levar').value,
      regras: $('f-regras').value,
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
    const r = await api('GET', '/estado');
    PV.relogio.sincronizar(r.agora);
    estado = r;
    const ondeBanco = { turso: 'banco: Turso', arquivo: 'banco: arquivo', memoria: 'banco: memória' }[r.banco] || '';
    $('info-banco').textContent = ondeBanco;
    desenharConvidados();
    desenharAtividades();
    desenharTelao();
  }

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
