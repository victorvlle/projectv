// Notificações no celular: card da página inicial, ativação guiada (Android e computador),
// passo a passo ilustrado do iPhone e a tela de preferências (#avisos).
//
// Regras que este arquivo segue:
//  - Detecta CAPACIDADE (PushManager, Notification, modo de exibição), não só o user-agent.
//  - O pedido nativo de permissão só acontece dentro do toque em "Continuar"/"Ativar".
//  - Só diz "ativado" depois que o servidor confirmou que gravou a inscrição.
//  - Permissão do navegador e inscrição no servidor são coisas diferentes e aparecem separadas.
//  - Nada de alert/confirm nativos.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = () => window.PVConvidado;
  const card = $('sec-avisos');
  const pref = $('pref-avisos');
  const sino = $('sino-barra');

  // ------------------------------------------------------------- capacidades
  const ua = navigator.userAgent;
  const ehIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ehAndroid = /Android/.test(ua);
  // Navegadores embutidos em apps (Instagram, Facebook…) no iPhone não deixam adicionar à Tela de Início.
  const appEmbutido = ehIOS && /FBAN|FBAV|Instagram|Line\/|GSA\/|LinkedInApp|Snapchat|TikTok|musical_ly/.test(ua);
  const naoSafariIOS = ehIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  function versaoIOS() {
    const m = ua.match(/(?:iPhone|CPU) OS (\d+)_(\d+)/) || (ehIOS && ua.match(/Version\/(\d+)\.(\d+)/));
    return m ? [Number(m[1]), Number(m[2])] : null;
  }
  const iosAntigo = () => { const v = versaoIOS(); return Boolean(v && (v[0] < 16 || (v[0] === 16 && v[1] < 4))); };
  const instalado = () => window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches;
  const suporta = () => window.isSecureContext !== false && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const reduzirMovimento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let registro = null;
  let codigo = null;
  let atual = { estado: 'carregando' };
  let ocupado = false;

  function base64ParaBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const bruto = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bruto, (c) => c.charCodeAt(0));
  }
  function mesmaChave(sub, chave) {
    try {
      const atualBytes = new Uint8Array(sub.options.applicationServerKey);
      const nova = base64ParaBytes(chave);
      return atualBytes.length === nova.length && atualBytes.every((b, i) => b === nova[i]);
    } catch (_) { return true; } // navegador que não informa: confia na assinatura existente
  }
  function pedirPermissao() {
    // Safari antigo usa callback; os novos, Promise. Chamado direto do toque.
    return new Promise((ok) => {
      const p = Notification.requestPermission(ok);
      if (p && typeof p.then === 'function') p.then(ok, () => ok(Notification.permission));
    });
  }
  async function pronto() {
    if (registro) return registro;
    registro = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, nao) => setTimeout(() => nao(new Error('sw')), 10000)),
    ]);
    return registro;
  }
  async function assinaturaAtual() {
    if (!registro) return null;
    try { return await registro.pushManager.getSubscription(); } catch (_) { return null; }
  }
  const adiado = () => Date.now() - Number(PV.guardado.ler('pv.avisos.depois') || 0) < 2 * 24 * 3600 * 1000;

  // ---------------------------------------------------------------- textos
  const T = {
    sucesso: 'Tudo pronto! Você vai receber os avisos importantes do Project V por aqui.',
    negada: 'As notificações estão bloqueadas neste aparelho. Você pode ativá-las nas configurações do navegador ou do sistema.',
    falha: 'Não conseguimos concluir a ativação agora. Sua participação na festa continua normal. Tente novamente em instantes.',
    incompativel: 'Este navegador não permite receber notificações por aqui. Você ainda pode acompanhar tudo diretamente no Project V.',
    expirou: 'Precisamos reconectar este aparelho para continuar enviando os avisos.',
    iosAntigo: 'Para receber avisos no iPhone é preciso o iOS 16.4 ou mais novo. Você ainda pode acompanhar tudo diretamente no Project V.',
    appEmbutido: 'Abra o Project V no Safari para conseguir ativar os avisos: procure no menu deste app a opção “Abrir no Safari” ou “Abrir no navegador”.',
  };

  function ajudaBloqueio() {
    if (ehIOS) {
      return `<ol class="passos"><li>Abra os <b>Ajustes</b> do iPhone.</li><li>Toque em <b>Notificações</b> e depois em <b>Project V</b>.</li>
        <li>Ligue <b>Permitir Notificações</b>.</li><li>Volte aqui e toque em <b>Verificar de novo</b>.</li></ol>`;
    }
    if (ehAndroid && instalado()) {
      return `<ol class="passos"><li>Mantenha o dedo no ícone do <b>Project V</b> e toque em <b>Informações do app</b> (ⓘ).</li>
        <li>Toque em <b>Notificações</b> e ligue <b>Permitir</b>.</li><li>Volte aqui e toque em <b>Verificar de novo</b>.</li></ol>`;
    }
    if (ehAndroid) {
      return `<ol class="passos"><li>Toque no ícone ao lado do endereço do site (ou em <b>⋮ › Configurações do site</b>).</li>
        <li>Abra <b>Permissões › Notificações</b> e escolha <b>Permitir</b>.</li><li>Volte aqui e toque em <b>Verificar de novo</b>.</li></ol>`;
    }
    return `<ol class="passos"><li>Clique no ícone à esquerda do endereço do site.</li>
      <li>Em <b>Notificações</b>, escolha <b>Permitir</b>.</li><li>Volte aqui e clique em <b>Verificar de novo</b>.</li></ol>`;
  }

  // ------------------------------------------------------------------ estado
  // pronto | instalar | ios-antigo | app-embutido | indisponivel | bloqueado | reconectar | ativado | sem-conexao
  async function calcular() {
    if (!suporta()) {
      if (ehIOS && !instalado()) {
        if (iosAntigo()) return { estado: 'ios-antigo' };
        if (appEmbutido) return { estado: 'app-embutido' };
        return { estado: 'instalar' };
      }
      if (ehIOS) return { estado: 'ios-antigo' }; // aberto pelo ícone e mesmo assim sem Push: sistema antigo
      return { estado: 'indisponivel' };
    }
    const permissao = Notification.permission;
    const sub = await assinaturaAtual();
    let servidor = null;
    try { servidor = await C().api('POST', '/api/eu/push/situacao', { endpoint: sub ? sub.endpoint : '' }); } catch (_) { /* sem rede */ }
    const base = { permissao, servidor, sub };
    if (permissao === 'denied') return { ...base, estado: 'bloqueado' };
    if (permissao === 'granted' && sub) {
      if (!servidor) return { ...base, estado: 'sem-conexao' };
      if (servidor.inscrito) return { ...base, estado: 'ativado' };
      return { ...base, estado: 'reconectar' };
    }
    if (permissao === 'granted' && PV.guardado.ler('pv.avisos.ativo') === '1') return { ...base, estado: 'reconectar' };
    return { ...base, estado: 'pronto' };
  }

  async function atualizar() {
    if (!C() || !C().eu()) return;
    try { atual = await calcular(); } catch (e) { console.error(e); atual = { estado: 'sem-conexao' }; }
    desenharCard();
    desenharPreferencias();
    if (sino) {
      const acao = ['pronto', 'instalar', 'reconectar'].includes(atual.estado);
      sino.dataset.estado = atual.estado === 'ativado' ? 'ativado' : acao ? 'acao' : '';
      sino.setAttribute('aria-label', atual.estado === 'ativado' ? 'Notificações (ativadas)' : 'Notificações');
    }
  }

  // ---------------------------------------------------------- card da home
  function mostrarCard(html, compacto = false) {
    card.innerHTML = html;
    card.classList.toggle('oculto', !html);
    card.classList.toggle('compacto', compacto);
  }
  function desenharCard() {
    if (!card) return;
    const e = atual.estado;
    if (e === 'ativado') {
      return mostrarCard(`<div class="avisos-linha"><span>🔔 Avisos ativados neste aparelho</span>
        <a class="link" href="#avisos">Gerenciar</a></div>`, true);
    }
    if (e === 'reconectar') {
      return mostrarCard(`<div class="avisos-topo"><span class="sino" aria-hidden="true">🔔</span><div>
          <b>Reconectar os avisos</b><p class="mudo">${T.expirou}</p></div></div>
        <div class="avisos-acoes"><button class="botao pequeno" type="button" data-avisos="ativar-direto">Reconectar</button></div>`);
    }
    if (adiado() || ['indisponivel', 'carregando', 'sem-conexao'].includes(e)) return mostrarCard('');
    if (e === 'pronto') {
      return mostrarCard(`<div class="avisos-topo"><span class="sino" aria-hidden="true">🔔</span><div>
          <b>Receba os avisos da festa</b>
          <p class="mudo">Quando um jogo abrir, alguém oferecer carona ou a votação do pós começar, você fica sabendo na hora.</p></div></div>
        <div class="avisos-acoes">
          <button class="botao pequeno" type="button" data-avisos="beneficios">Ativar notificações</button>
          <button class="botao secundario pequeno" type="button" data-avisos="depois">Agora não</button></div>`);
    }
    if (e === 'instalar') {
      return mostrarCard(`<div class="avisos-topo"><span class="sino" aria-hidden="true">🎃</span><div>
          <b>Não perca nenhum momento da festa</b>
          <p class="mudo">Adicione o Project V à Tela de Início para receber os avisos da festa, mesmo quando não estiver com o site aberto.</p></div></div>
        <div class="avisos-acoes">
          <button class="botao pequeno" type="button" data-avisos="ios">Como ativar no iPhone</button>
          <button class="botao secundario pequeno" type="button" data-avisos="depois">Agora não</button></div>`);
    }
    if (e === 'bloqueado') {
      return mostrarCard(`<div class="avisos-linha"><span>🔕 Notificações bloqueadas neste aparelho</span>
        <a class="link" href="#avisos">Como liberar</a></div>`, true);
    }
    const texto = { 'ios-antigo': T.iosAntigo, 'app-embutido': T.appEmbutido }[e];
    if (texto) {
      return mostrarCard(`<div class="avisos-linha"><span class="mudo">${texto}</span>
        <button type="button" class="link" data-avisos="depois" aria-label="Fechar">✕</button></div>`, true);
    }
    return mostrarCard('');
  }

  // --------------------------------------------------------- preferências
  function textoPermissao(p) {
    return { granted: 'Permitida', denied: 'Bloqueada', default: 'Ainda não pedida' }[p] || 'Não disponível';
  }
  function desenharPreferencias() {
    if (!pref) return;
    const e = atual.estado;
    const s = atual.servidor;
    const cab = {
      ativado: ['🔔', 'Ativadas neste aparelho', 'Você vai receber os avisos importantes do Project V por aqui.', 'ok'],
      pronto: ['🔕', 'Desativadas neste aparelho', 'Ative para saber na hora quando um jogo abrir ou alguém oferecer carona.', ''],
      reconectar: ['⚠️', 'Precisa reconectar', T.expirou, 'atencao'],
      bloqueado: ['🚫', 'Bloqueadas neste aparelho', T.negada, 'atencao'],
      instalar: ['📲', 'Falta um passo no iPhone', 'No iPhone, os avisos funcionam pelo Project V na Tela de Início.', ''],
      'ios-antigo': ['📵', 'Indisponíveis neste iPhone', T.iosAntigo, ''],
      'app-embutido': ['🧭', 'Abra no Safari', T.appEmbutido, ''],
      indisponivel: ['📵', 'Indisponíveis neste navegador', T.incompativel, ''],
      'sem-conexao': ['📡', 'Sem conexão', 'Não consegui falar com o servidor agora. Confira a internet e tente de novo.', 'atencao'],
      carregando: ['⏳', 'Verificando…', '', ''],
    }[e] || ['🔔', 'Notificações', '', ''];

    let acoes = '';
    if (e === 'ativado') {
      acoes = `<button class="botao largo" type="button" data-avisos="testar">Testar notificação</button>
        <button class="botao secundario largo" type="button" data-avisos="desativar">Desativar neste aparelho</button>`;
    } else if (e === 'pronto') {
      acoes = '<button class="botao largo" type="button" data-avisos="beneficios">Ativar notificações</button>';
    } else if (e === 'reconectar') {
      acoes = '<button class="botao largo" type="button" data-avisos="ativar-direto">Reconectar este aparelho</button>';
    } else if (e === 'instalar') {
      acoes = '<button class="botao largo" type="button" data-avisos="ios">Como ativar no iPhone</button>';
    } else if (e === 'bloqueado' || e === 'sem-conexao') {
      acoes = '<button class="botao secundario largo" type="button" data-avisos="verificar">Verificar de novo</button>';
    }

    const total = s ? s.total : null;
    const linhas = `
      <div><dt>Este aparelho</dt><dd>${e === 'ativado' ? '<span class="sim">Recebendo avisos</span>' : 'Não recebe avisos'}</dd></div>
      <div><dt>Permissão do navegador</dt><dd>${suporta() ? textoPermissao(Notification.permission) : 'Não disponível aqui'}</dd></div>
      <div><dt>Aparelhos ativos</dt><dd>${total === null ? '—' : `${total} de ${s.maximo}`}</dd></div>`;

    const outros = s && s.aparelhos ? s.aparelhos : [];
    const lista = outros.length ? `
      <section class="cartao pref-bloco"><h2 class="titulo-secao" style="margin-top:0">Seus aparelhos</h2>
        <ul class="lista-aparelhos">${outros.map((a) => `
          <li><span>${a.esteAparelho ? '📱 ' : ''}${PV.esc(a.nome)}${a.esteAparelho ? ' <em class="etiqueta">este</em>' : ''}
            <small class="fraco">desde ${PV.esc(PV.dataHora(a.desde, { day: '2-digit', month: '2-digit' }))}</small></span>
            ${a.esteAparelho ? '' : `<button class="botao secundario pequeno" type="button" data-avisos="remover" data-id="${a.id}">Remover</button>`}</li>`).join('')}
        </ul></section>` : '';

    pref.innerHTML = `
      <section class="cartao pref-estado ${cab[3]}">
        <div class="avisos-topo"><span class="sino" aria-hidden="true">${cab[0]}</span><div><b>${cab[1]}</b>
          ${cab[2] ? `<p class="mudo">${cab[2]}</p>` : ''}</div></div>
      </section>
      <section class="cartao pref-bloco"><dl class="pref-lista">${linhas}</dl></section>
      ${e === 'bloqueado' ? `<section class="cartao pref-bloco"><h2 class="titulo-secao" style="margin-top:0">Como liberar</h2>${ajudaBloqueio()}</section>` : ''}
      <div class="pref-acoes">${acoes}</div>
      <p class="pref-retorno" id="pref-retorno" role="status"></p>
      ${lista}
      <p class="fraco pref-nota">Os avisos nunca dizem quem fez o quê e não mostram nada pessoal na tela bloqueada.
        Desativar não muda nada no seu acesso: o Project V continua funcionando normalmente.</p>`;
  }
  function retorno(texto, tipo = '') {
    const el = $('pref-retorno');
    if (el) { el.textContent = texto; el.className = `pref-retorno ${tipo}`; }
  }

  // ---------------------------------------------------------- folha (modal)
  let folha = null;
  let focoAntes = null;
  let travada = false;
  function abrirFolha(html, rotulo) {
    if (!folha) {
      folha = document.createElement('div');
      folha.className = 'modal-fundo oculto';
      folha.id = 'folha-avisos';
      folha.innerHTML = '<div class="modal cartao folha" role="dialog" aria-modal="true" tabindex="-1"></div>';
      document.body.appendChild(folha);
      folha.addEventListener('click', (e) => { if (e.target === folha && !travada) fecharFolha(); });
      document.addEventListener('keydown', (e) => {
        if (folha.classList.contains('oculto')) return;
        if (e.key === 'Escape' && !travada) fecharFolha();
        if (e.key === 'Tab') prenderFoco(e);
      });
    }
    const caixa = folha.firstElementChild;
    caixa.innerHTML = html;
    caixa.setAttribute('aria-label', rotulo);
    if (folha.classList.contains('oculto')) {
      focoAntes = document.activeElement;
      folha.classList.remove('oculto');
      document.body.classList.add('sem-rolagem');
    }
    const alvo = caixa.querySelector('[data-foco]') || caixa.querySelector('h3') || caixa;
    if (alvo.tagName === 'H3') alvo.setAttribute('tabindex', '-1');
    alvo.focus({ preventScroll: true });
  }
  function fecharFolha() {
    if (!folha) return;
    travada = false;
    folha.classList.add('oculto');
    document.body.classList.remove('sem-rolagem');
    if (focoAntes && focoAntes.focus) focoAntes.focus({ preventScroll: true });
  }
  function prenderFoco(e) {
    const foco = [...folha.querySelectorAll('button, a[href], [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent);
    if (!foco.length) return;
    const [primeiro, ultimo] = [foco[0], foco[foco.length - 1]];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  }
  const fechar = '<button class="fechar-folha" type="button" data-avisos="fechar" aria-label="Fechar">✕</button>';

  function folhaBeneficios() {
    abrirFolha(`${fechar}
      <div class="folha-arte" aria-hidden="true">${ARTE.sino}</div>
      <h3>Fique por dentro da festa</h3>
      <ul class="beneficios">
        <li><span aria-hidden="true">🔓</span> Quando um jogo ou votação abrir</li>
        <li><span aria-hidden="true">🚗</span> Quando alguém oferecer carona</li>
        <li><span aria-hidden="true">⏳</span> Lembretes da véspera e da hora de sair de casa</li>
        <li><span aria-hidden="true">🤫</span> Sem nada pessoal: os avisos nunca dizem quem fez o quê</li>
      </ul>
      <p class="fraco">No próximo passo, o ${ehIOS ? 'iPhone' : 'navegador'} vai pedir permissão. Toque em <b>Permitir</b>.</p>
      <div class="folha-acoes">
        <button class="botao largo" type="button" data-avisos="continuar" data-foco>Continuar</button>
        <button class="botao secundario largo" type="button" data-avisos="fechar">Agora não</button>
      </div>`, 'Ativar notificações');
  }
  function folhaCarregando(texto) {
    travada = true;
    abrirFolha(`<div class="folha-carregando"><div class="spinner" aria-hidden="true"></div><p data-foco tabindex="-1">${texto}</p></div>`, texto);
  }
  function folhaResultado({ icone, titulo, texto, extra = '', botoes }) {
    travada = false;
    abrirFolha(`${fechar}<div class="folha-resultado"><div class="folha-icone" aria-hidden="true">${icone}</div>
      <h3>${titulo}</h3><p class="mudo">${texto}</p>${extra}</div>
      <div class="folha-acoes">${botoes || '<button class="botao largo" type="button" data-avisos="fechar" data-foco>Fechar</button>'}</div>`, titulo);
  }
  function folhaLimite(aparelhos, maximo) {
    travada = false;
    abrirFolha(`${fechar}<h3>Limite de aparelhos</h3>
      <p class="mudo">Você já tem ${maximo} aparelhos recebendo avisos. Remova um que você não usa mais para ativar neste.</p>
      <ul class="lista-aparelhos">${aparelhos.map((a) => `
        <li><span>${PV.esc(a.nome)}<small class="fraco">desde ${PV.esc(PV.dataHora(a.desde, { day: '2-digit', month: '2-digit' }))}</small></span>
          <button class="botao secundario pequeno" type="button" data-avisos="remover-e-ativar" data-id="${a.id}">Remover</button></li>`).join('')}
      </ul>
      <div class="folha-acoes"><button class="botao secundario largo" type="button" data-avisos="fechar">Cancelar</button></div>`, 'Limite de aparelhos');
  }

  // -------------------------------------------------------------- ativação
  // `pedir` = chamar o pedido nativo agora (estamos dentro do toque da pessoa).
  function ativar() {
    if (ocupado) return;
    ocupado = true;
    const pedido = Notification.permission === 'default' ? pedirPermissao() : Promise.resolve(Notification.permission);
    if (Notification.permission === 'default') folhaCarregando('Aguardando a sua resposta…');
    pedido.then(async (perm) => {
      if (perm === 'denied') {
        folhaResultado({ icone: '🔕', titulo: 'Notificações bloqueadas', texto: T.negada, extra: ajudaBloqueio() });
        return;
      }
      if (perm !== 'granted') {
        folhaResultado({ icone: '🔔', titulo: 'Tudo bem', texto: 'Você fechou o pedido sem escolher. Quando quiser, é só tentar de novo.' });
        return;
      }
      folhaCarregando('Ativando neste aparelho…');
      await concluir();
    }).catch((erro) => {
      console.error(erro);
      if (erro && erro.status === 401) { fecharFolha(); return; }
      falhou();
    }).finally(() => { ocupado = false; atualizar(); });
  }

  function falhou() {
    folhaResultado({ icone: '📡', titulo: 'Não deu certo agora', texto: T.falha,
      botoes: `<button class="botao largo" type="button" data-avisos="ativar-direto" data-foco>Tentar de novo</button>
        <button class="botao secundario largo" type="button" data-avisos="fechar">Fechar</button>` });
  }

  let assinaturaPendente = null;
  async function concluir(jaTentouRenovar = false) {
    const reg = await pronto();
    const { chave } = await C().api('GET', '/api/push/chave');
    let sub = await reg.pushManager.getSubscription();
    if (sub && !mesmaChave(sub, chave)) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ParaBytes(chave) });
    let r;
    try {
      r = await C().api('POST', '/api/eu/push', { inscricao: sub.toJSON(), instalado: instalado() });
    } catch (erro) {
      if (erro.codigo === 'limite') { assinaturaPendente = sub; folhaLimite(erro.dados.aparelhos || [], erro.dados.maximo || 5); return; }
      throw erro;
    }
    // O serviço de push disse que essa assinatura morreu: cria outra uma vez.
    if (r.teste && r.teste.motivo === 'expirada' && !jaTentouRenovar) {
      await sub.unsubscribe().catch(() => {});
      return concluir(true);
    }
    PV.guardado.gravar('pv.avisos.ativo', '1');
    PV.guardado.apagar('pv.avisos.depois');
    const chegou = r.teste && r.teste.entregue;
    folhaResultado({
      icone: '🎃', titulo: 'Notificações ativadas', texto: T.sucesso,
      extra: `<p class="fraco">${chegou ? 'Mandamos uma notificação de teste para este aparelho. Ela deve aparecer em alguns segundos.'
        : 'Não conseguimos entregar o teste agora. Use “Testar notificação” em Notificações daqui a pouco.'}</p>`,
    });
  }

  async function removerEAtivar(id) {
    if (ocupado) return;
    ocupado = true;
    folhaCarregando('Removendo o aparelho antigo…');
    try {
      await C().api('DELETE', `/api/eu/push/aparelhos/${encodeURIComponent(id)}`);
      folhaCarregando('Ativando neste aparelho…');
      if (!assinaturaPendente) await concluir();
      else {
        const r = await C().api('POST', '/api/eu/push', { inscricao: assinaturaPendente.toJSON(), instalado: instalado() });
        assinaturaPendente = null;
        PV.guardado.gravar('pv.avisos.ativo', '1');
        folhaResultado({ icone: '🎃', titulo: 'Notificações ativadas', texto: T.sucesso,
          extra: r.teste && r.teste.entregue ? '<p class="fraco">Mandamos uma notificação de teste para este aparelho.</p>' : '' });
      }
    } catch (erro) {
      if (erro.codigo === 'limite') folhaLimite(erro.dados.aparelhos || [], erro.dados.maximo || 5);
      else { console.error(erro); falhou(); }
    } finally { ocupado = false; atualizar(); }
  }

  async function testar(botao) {
    const sub = await assinaturaAtual();
    if (!sub) { atualizar(); return; }
    botao.disabled = true;
    retorno('Enviando…');
    try {
      await C().api('POST', '/api/eu/push/teste', { endpoint: sub.endpoint });
      retorno('Teste enviado! Ele deve aparecer em alguns segundos. Se não aparecer, confira se o modo silencioso ou “Não perturbe” está ligado.', 'ok');
    } catch (erro) {
      retorno(erro.status === 404 ? T.expirou : 'Não conseguimos enviar o teste agora. Tente de novo em instantes.', 'erro');
      if (erro.status === 404) atualizar();
    } finally {
      setTimeout(() => { botao.disabled = false; }, 4000);
    }
  }

  async function desativar(botao) {
    botao.disabled = true;
    const sub = await assinaturaAtual();
    try {
      if (sub) {
        await C().api('DELETE', '/api/eu/push', { endpoint: sub.endpoint });
        await sub.unsubscribe().catch(() => {});
      }
      PV.guardado.apagar('pv.avisos.ativo');
      PV.avisar('Notificações desativadas neste aparelho.', 'ok');
    } catch (_) {
      retorno('Não conseguimos desativar agora. Tente de novo em instantes.', 'erro');
    }
    atualizar();
  }

  // Remover outro aparelho pede um segundo toque (sem confirm nativo).
  const confirmando = new Map();
  async function removerOutro(botao) {
    const id = botao.dataset.id;
    if (!confirmando.has(id)) {
      botao.textContent = 'Tocar de novo';
      botao.classList.add('perigo');
      confirmando.set(id, setTimeout(() => { confirmando.delete(id); botao.textContent = 'Remover'; botao.classList.remove('perigo'); }, 4000));
      return;
    }
    clearTimeout(confirmando.get(id));
    confirmando.delete(id);
    botao.disabled = true;
    try {
      await C().api('DELETE', `/api/eu/push/aparelhos/${encodeURIComponent(id)}`);
      PV.avisar('Aparelho removido. Ele não recebe mais avisos.', 'ok');
    } catch (_) {
      PV.avisar('Não conseguimos remover agora. Tente de novo.', 'erro');
    }
    atualizar();
  }

  // ------------------------------------------------- passo a passo do iPhone
  const PASSOS = [
    {
      titulo: 'Abra o menu Compartilhar',
      arte: () => ARTE.passo1,
      texto: () => (naoSafariIOS
        ? 'Toque no botão <b>Compartilhar</b> <span class="icone-ios">⬆︎</span>, que fica na barra de endereço deste navegador.'
        : 'No Safari, toque no botão <b>Compartilhar</b> <span class="icone-ios">⬆︎</span> na barra de baixo. Nas versões mais novas ele pode estar dentro do botão <b>⋯</b>. Se a barra sumiu, role a página um pouco para cima.'),
    },
    {
      titulo: 'Adicione à Tela de Início',
      arte: () => ARTE.passo2,
      texto: () => 'Role a lista e toque em <b>Adicionar à Tela de Início</b> <span class="icone-ios">＋</span>. Se aparecer a opção <b>Abrir como App da Web</b>, deixe ligada. Depois toque em <b>Adicionar</b>: o ícone da abóbora do Project V vai aparecer no seu celular.',
    },
    {
      titulo: 'Abra o Project V pelo novo ícone',
      arte: () => ARTE.passo3,
      texto: () => 'Saia do navegador e abra o Project V <b>tocando no ícone</b> da Tela de Início. Voltar para a aba aberta não funciona: os avisos só existem no app do ícone. Seu convite vai junto, você entra direto.',
    },
    {
      titulo: 'Ative as notificações',
      arte: () => ARTE.passo4,
      texto: () => 'No app, toque em <b>Ativar notificações</b> e depois em <b>Permitir</b>. Vamos mandar um teste para você ver que está tudo certo.',
    },
  ];
  let passo = 0;
  function folhaIOS(n = 0) {
    passo = Math.max(0, Math.min(PASSOS.length - 1, n));
    const p = PASSOS[passo];
    const ultimo = passo === PASSOS.length - 1;
    abrirFolha(`${fechar}
      <p class="passo-de" aria-hidden="true">Passo ${passo + 1} de ${PASSOS.length}</p>
      <div class="pontos-progresso" role="progressbar" aria-valuemin="1" aria-valuemax="${PASSOS.length}" aria-valuenow="${passo + 1}"
        aria-label="Passo ${passo + 1} de ${PASSOS.length}">${PASSOS.map((_, i) => `<i class="${i < passo ? 'feito' : i === passo ? 'atual' : ''}"></i>`).join('')}</div>
      <div class="folha-arte ilustracao ${reduzirMovimento() ? '' : 'entrar'}" aria-hidden="true">${p.arte()}</div>
      <h3 data-foco tabindex="-1">${p.titulo}</h3>
      <p class="mudo passo-texto">${p.texto()}</p>
      <div class="folha-acoes lado">
        ${passo > 0 ? '<button class="botao secundario" type="button" data-avisos="ios-voltar">Voltar</button>' : '<span></span>'}
        <button class="botao" type="button" data-avisos="${ultimo ? 'fechar' : 'ios-proximo'}">${ultimo ? 'Entendi' : 'Próximo'}</button>
      </div>`, `Como ativar no iPhone, passo ${passo + 1} de ${PASSOS.length}`);
  }

  // Ilustrações próprias (SVG), nas cores do Project V.
  const abobora = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
      <rect x="-22" y="-22" width="44" height="44" rx="11" fill="#1B1424" stroke="#E8620C" stroke-width="1.5"/>
      <ellipse cx="0" cy="3" rx="14" ry="11.5" fill="#E8620C"/><ellipse cx="0" cy="3" rx="6" ry="11.5" fill="#FF8A3D" opacity=".55"/>
      <rect x="-1.5" y="-12" width="3" height="5" rx="1" fill="#7BC74D"/>
      <path d="M-7 0 l3 -3 l3 3z M1 0 l3 -3 l3 3z" fill="#120D17"/><path d="M-6 7 q6 4 12 0 l-2 1.5 l-2 -1 l-2 1 l-2 -1 l-2 1z" fill="#120D17"/></g>`;
  const ARTE = {
    sino: `<svg viewBox="0 0 120 90" width="120" height="90"><circle cx="60" cy="45" r="36" fill="#2B2138"/>
      <path d="M60 22c-9 0-15 7-15 16v10l-5 6v2h40v-2l-5-6V38c0-9-6-16-15-16Z" fill="#E8620C"/>
      <circle cx="60" cy="62" r="5" fill="#FF8A3D"/><path class="vibra" d="M36 30q-5 6-5 14M84 30q5 6 5 14" stroke="#B9AEC6" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`,
    passo1: `<svg viewBox="0 0 260 160" width="260" height="160">
      <rect x="40" y="6" width="180" height="170" rx="22" fill="#1B1424" stroke="#3A2E4A" stroke-width="2"/>
      <rect x="54" y="22" width="152" height="70" rx="8" fill="#221A2D"/>
      <text x="130" y="61" text-anchor="middle" font-family="Inter,system-ui" font-size="13" fill="#85789A">projectv…onrender.com</text>
      <rect x="54" y="104" width="152" height="40" rx="10" fill="#2B2138"/>
      <path d="M74 124l6-6M74 124l6 6" stroke="#85789A" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M104 118l6 6-6 6" stroke="#85789A" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <g class="destaque"><circle cx="130" cy="124" r="17" fill="none" stroke="#E8620C" stroke-width="2.5"/>
        <rect x="123" y="121" width="14" height="13" rx="2" fill="none" stroke="#FF8A3D" stroke-width="2"/>
        <path d="M130 111v15M125 116l5-5 5 5" stroke="#FF8A3D" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
      <rect x="152" y="117" width="14" height="14" rx="2" fill="none" stroke="#85789A" stroke-width="2"/>
      <circle cx="183" cy="124" r="2" fill="#85789A"/><circle cx="189" cy="124" r="2" fill="#85789A"/><circle cx="177" cy="124" r="2" fill="#85789A"/>
      <path class="dedo" d="M138 150c0-6 4-9 7-9s5 2 5 5v8" stroke="#F3ECF8" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
    passo2: `<svg viewBox="0 0 260 160" width="260" height="160">
      <rect x="30" y="10" width="200" height="150" rx="18" fill="#221A2D" stroke="#3A2E4A" stroke-width="2"/>
      <rect x="44" y="24" width="172" height="28" rx="8" fill="#2B2138"/><text x="58" y="43" font-family="Inter,system-ui" font-size="12" fill="#85789A">Copiar</text>
      <rect x="44" y="58" width="172" height="28" rx="8" fill="#2B2138"/><text x="58" y="77" font-family="Inter,system-ui" font-size="12" fill="#85789A">Adicionar aos Favoritos</text>
      <g class="destaque"><rect x="36" y="94" width="188" height="34" rx="9" fill="#3B1F5C" stroke="#E8620C" stroke-width="2"/>
        <text x="46" y="116" font-family="Inter,system-ui" font-size="11" font-weight="700" fill="#F3ECF8">Adicionar à Tela de Início</text>
        <rect x="200" y="102" width="18" height="18" rx="4" fill="none" stroke="#FF8A3D" stroke-width="2"/>
        <path d="M209 106v10M204 111h10" stroke="#FF8A3D" stroke-width="2" stroke-linecap="round"/></g>
      <rect x="44" y="134" width="172" height="20" rx="8" fill="#2B2138" opacity=".6"/></svg>`,
    passo3: `<svg viewBox="0 0 260 160" width="260" height="160">
      <rect x="40" y="6" width="180" height="170" rx="22" fill="#1B1424" stroke="#3A2E4A" stroke-width="2"/>
      ${[0, 1, 2, 3].map((c) => [0, 1].map((l) => (c === 2 && l === 1 ? '' : `<rect x="${62 + c * 38}" y="${26 + l * 52}" width="30" height="30" rx="8" fill="#2B2138"/>`)).join('')).join('')}
      <g class="destaque">${abobora(153, 93, 0.7)}<circle cx="153" cy="93" r="23" fill="none" stroke="#E8620C" stroke-width="2"/></g>
      <text x="153" y="128" text-anchor="middle" font-family="Inter,system-ui" font-size="10" fill="#F3ECF8">Project V</text>
      <path class="dedo" d="M160 152c0-6 4-9 7-9s5 2 5 5v8" stroke="#F3ECF8" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
    passo4: `<svg viewBox="0 0 260 160" width="260" height="160">
      <rect x="40" y="6" width="180" height="170" rx="22" fill="#120D17" stroke="#3A2E4A" stroke-width="2"/>
      <text x="130" y="44" text-anchor="middle" font-family="Inter,system-ui" font-size="26" font-weight="300" fill="#B9AEC6">17:00</text>
      <g class="destaque"><rect x="52" y="62" width="156" height="50" rx="12" fill="#2B2138" stroke="#E8620C" stroke-width="1.5"/>
        ${abobora(74, 87, 0.5)}
        <text x="90" y="81" font-family="Inter,system-ui" font-size="11" font-weight="700" fill="#F3ECF8">Project V</text>
        <text x="90" y="97" font-family="Inter,system-ui" font-size="9.5" fill="#B9AEC6">Notificações ativadas!</text></g>
      <rect x="70" y="124" width="56" height="26" rx="13" fill="#2B2138"/><text x="98" y="141" text-anchor="middle" font-family="Inter,system-ui" font-size="10" fill="#85789A">Não Permitir</text>
      <rect x="134" y="124" width="56" height="26" rx="13" fill="#E8620C"/><text x="162" y="141" text-anchor="middle" font-family="Inter,system-ui" font-size="10.5" font-weight="700" fill="#120D17">Permitir</text></svg>`,
  };

  // ----------------------------------------------------------------- toques
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-avisos]');
    if (!b) return;
    const acao = b.dataset.avisos;
    if (acao === 'beneficios') folhaBeneficios();
    // "continuar" e "ativar-direto" chamam o pedido nativo DENTRO do toque.
    if (acao === 'continuar' || acao === 'ativar-direto') ativar();
    if (acao === 'fechar') fecharFolha();
    if (acao === 'depois') { PV.guardado.gravar('pv.avisos.depois', String(Date.now())); desenharCard(); }
    if (acao === 'ios') folhaIOS(0);
    if (acao === 'ios-proximo') folhaIOS(passo + 1);
    if (acao === 'ios-voltar') folhaIOS(passo - 1);
    if (acao === 'testar') testar(b);
    if (acao === 'desativar') desativar(b);
    if (acao === 'verificar') { retorno('Verificando…'); atualizar(); }
    if (acao === 'remover') removerOutro(b);
    if (acao === 'remover-e-ativar') removerEAtivar(b.dataset.id);
  });

  // Ao voltar para o app (ex.: depois de liberar nos Ajustes), reavalia tudo.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
  window.addEventListener('pageshow', () => atualizar());
  document.addEventListener('pv:tela', (e) => { if (e.detail === 'tela-avisos' || e.detail === 'tela-principal') atualizar(); });

  // O manifesto com o código faz o atalho da Tela de Início abrir já com o convite.
  function prepararManifesto() {
    if (!codigo || document.querySelector('link[rel="manifest"]')) return;
    const l = document.createElement('link');
    l.rel = 'manifest';
    l.href = `/manifest/${codigo}.webmanifest`;
    document.head.appendChild(l);
  }

  async function iniciar() {
    if (!C() || !C().eu()) { setTimeout(iniciar, 400); return; }
    try { codigo = (await C().api('GET', '/api/eu')).eu.codigo; } catch (_) { return; }
    prepararManifesto();
    if (suporta()) {
      // Um registro só, no escopo "/", o mesmo de antes: nunca dois service workers concorrentes.
      try { registro = await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch (e) { console.error(e); }
    }
    atualizar();
  }
  iniciar();

  // Para os testes de navegador.
  window.PVAvisos = { estado: () => atual.estado, atualizar };
})();
