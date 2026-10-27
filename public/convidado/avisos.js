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
  // Decisão registrada NESTE aparelho/navegador: 'ativar' | 'depois' | 'negado' | 'tutorial'.
  // Só controla se o modal de boas-vindas aparece; quem diz se os avisos funcionam é o servidor.
  // O app da Tela de Início do iPhone tem armazenamento próprio: lá a decisão começa vazia,
  // e o modal aparece de novo, agora com a ativação de verdade (passo 3 do tutorial).
  const DECISAO = 'pv.avisos.decisao';
  function decisao() {
    const d = PV.guardado.ler(DECISAO);
    if (d) return d;
    return PV.guardado.ler('pv.avisos.ativo') === '1' ? 'ativar' : null; // quem já tinha ativado na versão anterior
  }
  const decidir = (d) => PV.guardado.gravar(DECISAO, d);

  // ---------------------------------------------------------------- textos
  const T = {
    sucesso: 'Tudo certo! Você receberá os avisos do Project V.',
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

  let iniciado = false;
  async function atualizar() {
    // Antes do service worker estar registrado não dá para saber se já existe inscrição:
    // decidir cedo mostraria o modal para quem já recebe avisos.
    if (!iniciado || !C() || !C().eu()) return;
    try { atual = await calcular(); } catch (e) { console.error(e); atual = { estado: 'sem-conexao' }; }
    desenharCard();
    desenharPreferencias();
    talvezBoasVindas();
    if (sino) {
      const acao = atual.estado === 'reconectar' || (!decisao() && ['pronto', 'instalar'].includes(atual.estado));
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
  // Sem banner permanente: a home só mostra um card quando há algo a consertar
  // (permissão concedida, mas a inscrição sumiu). Ativar depois: sino no topo.
  function desenharCard() {
    if (!card) return;
    if (atual.estado === 'reconectar') {
      return mostrarCard(`<div class="avisos-topo"><span class="sino" aria-hidden="true">🔔</span><div>
          <b>Reconectar os avisos</b><p class="mudo">${T.expirou}</p></div></div>
        <div class="avisos-acoes"><button class="botao pequeno" type="button" data-avisos="ativar-direto">Reconectar</button></div>`);
    }
    return mostrarCard('');
  }

  // ------------------------------------------------------ boas-vindas
  // Primeira visita deste aparelho, sem decisão registrada e com algo a fazer.
  let boasVindasMostrada = false;
  function talvezBoasVindas() {
    const e = atual.estado;
    const d = decisao();
    if (!d && e === 'ativado') { decidir('ativar'); return; } // já recebe: nunca interrompe
    if (!d && e === 'bloqueado') { decidir('negado'); return; } // já negou: não insiste
    if (d || boasVindasMostrada || ocupado) return;
    if (!['pronto', 'instalar', 'app-embutido', 'ios-antigo'].includes(e)) return;
    const principal = $('tela-principal');
    if (!principal || principal.classList.contains('oculto')) return; // nunca por cima do perfil ou de outra tela
    if (folha && !folha.classList.contains('oculto')) return;
    boasVindasMostrada = true;
    folhaBoasVindas();
  }
  function folhaBoasVindas() {
    abrirFolha(`<button class="fechar-folha" type="button" data-avisos="sem-ativar" aria-label="Fechar">✕</button>
      <div class="folha-arte boas-vindas-arte" aria-hidden="true">${ARTE.boasVindas}</div>
      <h3 class="boas-vindas-titulo">Não perca nenhum aviso da noite!</h3>
      <p class="mudo boas-vindas-texto">Ative as notificações para receber novidades, surpresas e avisos importantes do Project V.</p>
      <ul class="pilulas" aria-label="Exemplos de avisos">
        <li><span aria-hidden="true">🔓</span>Jogos liberados</li><li><span aria-hidden="true">🚗</span>Caronas</li><li><span aria-hidden="true">⏳</span>Lembretes</li>
      </ul>
      <div class="folha-acoes">
        <button class="botao largo" type="button" data-avisos="quero" data-foco>Quero receber avisos</button>
        <button class="botao-discreto" type="button" data-avisos="sem-ativar">Continuar sem ativar</button>
      </div>`, 'Não perca nenhum aviso da noite!', 'boas-vindas');
  }
  // "Quero receber avisos": cada situação segue o seu caminho, sempre dentro do toque.
  function quero() {
    const e = atual.estado;
    if (e === 'instalar') { decidir('tutorial'); folhaIOS(0); return; }
    if (e === 'ios-antigo' || e === 'app-embutido' || e === 'indisponivel') {
      decidir('depois');
      folhaResultado({ icone: '📵', titulo: e === 'app-embutido' ? 'Abra no Safari' : 'Não dá por aqui',
        texto: { 'ios-antigo': T.iosAntigo, 'app-embutido': T.appEmbutido, indisponivel: T.incompativel }[e],
        botoes: '<button class="botao largo" type="button" data-avisos="fechar" data-foco>Continuar sem ativar</button>' });
      return;
    }
    if (e === 'bloqueado') { folhaResultado({ icone: '🔕', titulo: 'Notificações bloqueadas', texto: T.negada, extra: ajudaBloqueio() }); return; }
    ativar();
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
  let fecharSozinho = null;
  function abrirFolha(html, rotulo, tipo = '') {
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
    caixa.dataset.tipo = tipo;
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
    if (folha.firstElementChild.dataset.tipo === 'boas-vindas' && !decisao()) decidir('depois');
    clearTimeout(fecharSozinho);
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
        decidir('negado');
        folhaResultado({ icone: '🔕', titulo: 'Notificações bloqueadas', texto: T.negada, extra: ajudaBloqueio() });
        return;
      }
      if (perm !== 'granted') {
        decidir('depois');
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
    sucesso(r);
  }
  // Confirmação só depois do servidor; some sozinha (nada de banner permanente).
  function sucesso(r) {
    PV.guardado.gravar('pv.avisos.ativo', '1');
    decidir('ativar');
    folhaResultado({
      icone: '🎃', titulo: 'Notificações ativadas', texto: T.sucesso,
      extra: '<p class="fraco">Quer conferir? Toque no sino 🔔 e em “Testar notificação”.</p>',
    });
    fecharSozinho = setTimeout(() => { if (!travada) fecharFolha(); }, 3500);
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
        sucesso(r);
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
      retorno(erro.status === 404 ? T.expirou : erro.status === 429 ? erro.message : 'Não conseguimos enviar o teste agora. Tente de novo em instantes.', 'erro');
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
      titulo: 'Abra no Safari',
      arte: () => ARTE.ios1,
      texto: () => 'Acesse o Project V pelo <b>Safari</b>.',
      dica: () => (naoSafariIOS || appEmbutido ? 'Você está em outro navegador: copie o seu link de convite e abra no Safari.' : 'Você já está no Safari. É só seguir.'),
    },
    {
      titulo: 'Adicione à Tela de Início',
      arte: () => ARTE.ios2,
      texto: () => 'Toque em <b>Compartilhar</b> e escolha <b>Adicionar à Tela de Início</b>. Se disponível, habilite <b>Abrir como App da Web</b> e toque em <b>Adicionar</b>.',
      dica: () => 'No iOS 26: toque no ⋯ (canto de baixo) › Compartilhar. Na lista que abrir, role para baixo até Adicionar à Tela de Início; se não estiver lá, toque em Ver Mais.',
    },
    {
      titulo: 'Ative os avisos',
      arte: () => ARTE.ios3,
      texto: () => 'Abra o Project V pelo <b>novo ícone</b> e toque em <b>Ativar notificações</b>. Depois, permita as notificações quando o iPhone perguntar.',
      dica: () => 'Seu convite vai junto: o ícone já abre com o seu acesso.',
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
      <p class="fraco passo-dica">${p.dica()}</p>
      <div class="folha-acoes lado">
        ${passo > 0 ? '<button class="botao secundario" type="button" data-avisos="ios-voltar">Voltar</button>' : '<span></span>'}
        <button class="botao" type="button" data-avisos="${ultimo ? 'fechar' : 'ios-proximo'}">${ultimo ? 'Entendi, vou fazer' : 'Próximo'}</button>
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
    boasVindas: `<svg viewBox="0 0 200 110" width="200" height="110">
      <circle cx="100" cy="58" r="44" fill="#2B2138"/><circle cx="100" cy="58" r="44" fill="none" stroke="#6B44A0" stroke-width="1.5" stroke-dasharray="3 5"/>
      <circle cx="152" cy="22" r="10" fill="#F3ECF8" opacity=".9"/><circle cx="157" cy="19" r="9" fill="#120D17"/>
      <path class="morcego" d="M30 30q6-6 10 0q4-6 10 0q-5 0-10 5q-5-5-10-5Z" fill="#6B44A0"/>
      <path class="morcego m2" d="M160 70q4-4 7 0q3-4 7 0q-4 0-7 4q-3-4-7-4Z" fill="#6B44A0"/>
      <path d="M100 32c-10 0-17 8-17 18v11l-6 7v2h46v-2l-6-7V50c0-10-7-18-17-18Z" fill="#E8620C"/>
      <circle cx="100" cy="75" r="5.5" fill="#FF8A3D"/>
      <path class="vibra" d="M72 40q-6 8-6 17M128 40q6 8 6 17" stroke="#B9AEC6" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <circle cx="117" cy="38" r="8" fill="#B3122E"/><text x="117" y="42" text-anchor="middle" font-family="Inter,system-ui" font-size="10" font-weight="800" fill="#fff">1</text></svg>`,
    ios1: `<svg viewBox="0 0 260 160" width="260" height="160">
      <rect x="40" y="6" width="180" height="170" rx="22" fill="#1B1424" stroke="#3A2E4A" stroke-width="2"/>
      ${[0, 1, 2, 3].map((c) => [0, 1].map((l) => (c === 1 && l === 1 ? '' : `<rect x="${62 + c * 38}" y="${26 + l * 52}" width="30" height="30" rx="8" fill="#2B2138"/>`)).join('')).join('')}
      <g class="destaque"><rect x="100" y="78" width="30" height="30" rx="8" fill="#F3ECF8"/>
        <circle cx="115" cy="93" r="11" fill="none" stroke="#6B44A0" stroke-width="2"/>
        <path d="M119 89l-3 6-5 2 3-6z" fill="#E8620C"/><circle cx="115" cy="93" r="18" fill="none" stroke="#E8620C" stroke-width="2"/></g>
      <text x="115" y="124" text-anchor="middle" font-family="Inter,system-ui" font-size="10" fill="#F3ECF8">Safari</text>
      <path class="dedo" d="M122 152c0-6 4-9 7-9s5 2 5 5v8" stroke="#F3ECF8" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
    ios2: `<svg viewBox="0 0 280 160" width="280" height="160">
      <rect x="8" y="30" width="112" height="100" rx="16" fill="#1B1424" stroke="#3A2E4A" stroke-width="2"/>
      <rect x="16" y="88" width="96" height="30" rx="9" fill="#2B2138"/>
      <path d="M30 103l5-5M30 103l5 5" stroke="#85789A" stroke-width="2.2" stroke-linecap="round"/>
      <g class="destaque"><circle cx="64" cy="103" r="13" fill="none" stroke="#E8620C" stroke-width="2.2"/>
        <rect x="58" y="101" width="12" height="10" rx="2" fill="none" stroke="#FF8A3D" stroke-width="1.8"/>
        <path d="M64 92v12M60 96l4-4 4 4" stroke="#FF8A3D" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
      <circle cx="94" cy="103" r="1.8" fill="#85789A"/><circle cx="99" cy="103" r="1.8" fill="#85789A"/><circle cx="89" cy="103" r="1.8" fill="#85789A"/>
      <circle cx="24" cy="44" r="9" fill="#B3122E"/><text x="24" y="48" text-anchor="middle" font-family="Inter,system-ui" font-size="10" font-weight="800" fill="#fff">1</text>
      <path d="M126 80h16m-6-6 6 6-6 6" stroke="#6B44A0" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="148" y="14" width="126" height="132" rx="16" fill="#221A2D" stroke="#3A2E4A" stroke-width="2"/>
      <rect x="158" y="26" width="106" height="22" rx="7" fill="#2B2138"/><rect x="158" y="54" width="106" height="22" rx="7" fill="#2B2138"/>
      <g class="destaque"><rect x="154" y="84" width="114" height="30" rx="8" fill="#3B1F5C" stroke="#E8620C" stroke-width="2"/>
        <text x="161" y="103" font-family="Inter,system-ui" font-size="9" font-weight="700" fill="#F3ECF8">Adicionar à Tela de Início</text></g>
      <rect x="158" y="120" width="106" height="16" rx="7" fill="#2B2138" opacity=".6"/>
      <circle cx="262" cy="26" r="9" fill="#B3122E"/><text x="262" y="30" text-anchor="middle" font-family="Inter,system-ui" font-size="10" font-weight="800" fill="#fff">2</text></svg>`,
    ios3: `<svg viewBox="0 0 280 160" width="280" height="160">
      <rect x="8" y="14" width="112" height="132" rx="16" fill="#1B1424" stroke="#3A2E4A" stroke-width="2"/>
      <rect x="22" y="30" width="24" height="24" rx="7" fill="#2B2138"/><rect x="52" y="30" width="24" height="24" rx="7" fill="#2B2138"/><rect x="82" y="30" width="24" height="24" rx="7" fill="#2B2138"/>
      <g class="destaque">${abobora(64, 88, 0.62)}<circle cx="64" cy="88" r="20" fill="none" stroke="#E8620C" stroke-width="2"/></g>
      <text x="64" y="122" text-anchor="middle" font-family="Inter,system-ui" font-size="9" fill="#F3ECF8">Project V</text>
      <circle cx="24" cy="128" r="9" fill="#B3122E"/><text x="24" y="132" text-anchor="middle" font-family="Inter,system-ui" font-size="10" font-weight="800" fill="#fff">1</text>
      <path d="M126 80h16m-6-6 6 6-6 6" stroke="#6B44A0" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="148" y="24" width="126" height="112" rx="16" fill="#221A2D" stroke="#3A2E4A" stroke-width="2"/>
      <text x="205" y="48" text-anchor="middle" font-family="Inter,system-ui" font-size="9.5" font-weight="700" fill="#F3ECF8">“Project V” quer</text>
      <text x="205" y="61" text-anchor="middle" font-family="Inter,system-ui" font-size="9.5" font-weight="700" fill="#F3ECF8">enviar notificações</text>
      <rect x="158" y="76" width="106" height="22" rx="11" fill="#2B2138"/><text x="211" y="91" text-anchor="middle" font-family="Inter,system-ui" font-size="9" fill="#85789A">Não Permitir</text>
      <g class="destaque"><rect x="158" y="104" width="106" height="24" rx="12" fill="#E8620C"/>
        <text x="211" y="120" text-anchor="middle" font-family="Inter,system-ui" font-size="10" font-weight="700" fill="#120D17">Permitir</text></g>
      <circle cx="262" cy="36" r="9" fill="#B3122E"/><text x="262" y="40" text-anchor="middle" font-family="Inter,system-ui" font-size="10" font-weight="800" fill="#fff">2</text></svg>`,
  };

  // ----------------------------------------------------------------- toques
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-avisos]');
    if (!b) return;
    const acao = b.dataset.avisos;
    if (acao === 'beneficios') ativar(); // botão da tela Notificações: direto ao pedido
    if (acao === 'quero') quero();
    if (acao === 'sem-ativar') { decidir('depois'); fecharFolha(); }
    // "continuar" e "ativar-direto" chamam o pedido nativo DENTRO do toque.
    if (acao === 'ativar-direto') ativar();
    if (acao === 'fechar') fecharFolha();
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
    iniciado = true;
    atualizar();
  }
  iniciar();

  // Para os testes de navegador.
  window.PVAvisos = { estado: () => atual.estado, atualizar };
})();
