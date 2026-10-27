// Notificações no celular (Web Push), mesmo com o site fechado.
//
// PEÇAS
//  - Chaves VAPID: de VAPID_PUBLIC/VAPID_PRIVATE ou, se não houver, geradas uma vez e
//    guardadas no banco (config 'vapid'), para não mudarem a cada reinício.
//  - Inscrições: cada celular que ativou vira uma linha em push_inscricoes (até 5 por
//    pessoa; no 6º o servidor recusa e a pessoa escolhe qual aparelho remover).
//  - Envio: `enviar()` para todos, para uma pessoa ou para uma lista. Inscrições que
//    o serviço de push diz que morreram (404/410) são apagadas.
//  - push_enviados: histórico e trava contra envio repetido (chave única por aviso).
//
// TIPOS DE AVISO
//  - Agendados (véspera, faltam 2h, contribuições, portões, campeão do pós): a cada
//    30 s o servidor confere o horário (derivado da data da festa) e manda uma vez só.
//  - Atividade liberada: quando o admin ou o agendador libera, uma vez por atividade.
//  - Movimento dos amigos (contribuição, carona, música): fila no banco (push_fila),
//    sobrevive a reinícios; agrupados em lote de 2 min,
//    no máximo um aviso de cada tipo a cada 20 min, silenciados de 0h a 8h e não
//    vão para quem fez a ação nem para quem está com aquela tela aberta agora.
//  - Pessoal (ex.: "Você foi amaldiçoado"): só para a pessoa, via `enviarPara`.
//
// SEGURANÇA
//  - O servidor só envia para endereços de serviços de push conhecidos (Google,
//    Mozilla, Apple, Microsoft). Sem isso, alguém poderia cadastrar um endereço
//    qualquer e usar o servidor para fazer requisições (SSRF).
//  - Convidado não tem rota para enviar nada: só o servidor e o admin enviam.

const webpush = require('web-push');
const banco = require('./dados/banco');
const festa = require('./dados/festa');
const { ErroValidacao } = require('./dados/convidados');

const MAX_POR_CONVIDADO = 5;
// Destinos que um toque na notificação pode abrir. Qualquer outro vira a página inicial.
const DESTINOS = new Set(['/', '/#contribuicoes', '/#playlist', '/#caronas', '/#chegar', '/#pos', '/#avisos']);
const destinoSeguro = (u) => (DESTINOS.has(u) ? u : '/');
const HOSTS_PERMITIDOS = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, /\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/, /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

// --------------------------------------------------------- qualidade do conteúdo
// Toda notificação passa por aqui antes de sair. O Chrome no Android analisa o texto
// (título, corpo) no próprio aparelho e avisa "possível spam" quando parece genérico,
// enganoso ou apelativo. Regras: título identifica o Project V, texto específico da
// festa, sem palavras de propaganda, sem urgência falsa, sem link no texto.
const APELATIVO = /\b(gr[aá]tis|ganhe|ganhou|pr[eê]mio|urgente|urg[eê]ncia|clique aqui|toque aqui|[uú]ltima chance|imperd[ií]vel|oferta|promo[cç][aã]o|desconto|sorteio|vencedor|parab[eé]ns|corra|n[aã]o perca|exclusivo|agora mesmo)\b/i;
function problemaNoAviso({ titulo, corpo, url }) {
  const ti = String(titulo || ''); const co = String(corpo || '');
  if (!/^Project V\b/.test(ti)) return 'O título precisa começar com "Project V".';
  if (ti.length > 60) return 'Título longo demais (máximo 60 caracteres).';
  if (co.length < 15 || co.length > 180) return 'A mensagem precisa ter entre 15 e 180 caracteres.';
  if (APELATIVO.test(`${ti} ${co}`)) return 'Evite palavras de propaganda ou urgência (grátis, urgente, prêmio, não perca…): o Chrome pode marcar como spam.';
  if (/https?:\/\/|www\./i.test(`${ti} ${co}`)) return 'Não coloque links no texto: o toque na notificação já abre a tela certa.';
  if ((`${ti} ${co}`.match(/!/g) || []).length > 1) return 'Use no máximo um ponto de exclamação.';
  const letras = co.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letras.length > 10 && letras === letras.toUpperCase()) return 'Não escreva a mensagem toda em maiúsculas.';
  if (!DESTINOS.has(url)) return 'Destino inválido.';
  return null;
}
// Teto por pessoa: mesmo com todos os tipos somados, ninguém recebe mais que isto por hora.
// Testes que a própria pessoa pede têm um limite próprio (1 a cada 10 min por aparelho).
const MAX_POR_HORA = Number(process.env.PUSH_MAX_POR_HORA || 4);
const ESPERA_TESTE_MS = 10 * 60 * 1000;

async function registrar(linhas) {
  if (!linhas.length) return;
  const em = Date.now();
  await banco.lote(linhas.map((l) => ({
    sql: 'INSERT INTO push_log (chave, convidado_id, inscricao_id, resultado, codigo, em) VALUES (?, ?, ?, ?, ?, ?)',
    args: [l.chave, l.convidadoId, l.inscricaoId ?? null, l.resultado, l.codigo ?? null, em],
  })));
}
async function recebidosNaUltimaHora(ids) {
  if (!ids.length) return new Map();
  const linhas = await banco.tudo(
    `SELECT convidado_id, COUNT(DISTINCT chave) AS n FROM push_log
      WHERE resultado = 'ok' AND chave NOT LIKE 'teste:%' AND em > ? GROUP BY convidado_id`, [Date.now() - 3600 * 1000]);
  return new Map(linhas.map((l) => [l.convidado_id, Number(l.n)]));
}

// ------------------------------------------------------------------- envio
// Em teste (PUSH_FALSO=1) nada sai pela rede: os envios ficam em `caixa`.
const caixa = [];
let transporte = async (inscricao, carga) => webpush.sendNotification(inscricao, carga, { TTL: 6 * 60 * 60, urgency: 'high' });
if (process.env.PUSH_FALSO === '1') {
  transporte = async (inscricao, carga) => {
    caixa.push({ endpoint: inscricao.endpoint, ...JSON.parse(carga) });
    if (inscricao.endpoint.includes('/morta')) { const e = new Error('Gone'); e.statusCode = 410; throw e; }
    if (inscricao.endpoint.includes('/instavel')) { const e = new Error('Server error'); e.statusCode = 500; throw e; }
    return { statusCode: 201 };
  };
}

let chaves = null;
async function prepararChaves() {
  if (chaves) return chaves;
  if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
    chaves = { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE };
  } else {
    chaves = await festa.ler('vapid');
    if (!chaves) {
      chaves = webpush.generateVAPIDKeys();
      await banco.rodar('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)', ['vapid', JSON.stringify(chaves)]);
      chaves = await festa.ler('vapid'); // se outro processo gravou antes, vale a dele
    }
  }
  const assunto = process.env.VAPID_ASSUNTO || process.env.URL_PUBLICA || process.env.RENDER_EXTERNAL_URL || 'https://projectv-pec1.onrender.com';
  webpush.setVapidDetails(assunto, chaves.publicKey, chaves.privateKey);
  return chaves;
}

async function chavePublica() {
  return (await prepararChaves()).publicKey;
}

function enderecoPermitido(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch (_) { return false; }
  return u.protocol === 'https:' && !u.port && HOSTS_PERMITIDOS.some((r) => r.test(u.hostname));
}

const base64url = /^[A-Za-z0-9_-]+={0,2}$/;

// Nome curto do aparelho, só para a pessoa reconhecer na lista ("Android · Chrome").
// Vem do navegador e serve só de rótulo: nunca decide permissão de nada.
function nomeDoAparelho(ua = '', instalado = false) {
  const s = String(ua).slice(0, 400);
  let so = 'Computador';
  if (/iPhone/.test(s)) so = 'iPhone';
  else if (/iPad/.test(s) || (/Macintosh/.test(s) && /Mobile\//.test(s))) so = 'iPad';
  else if (/Android/.test(s)) so = 'Android';
  else if (/Windows/.test(s)) so = 'Windows';
  else if (/Mac OS X|Macintosh/.test(s)) so = 'Mac';
  else if (/Linux/.test(s)) so = 'Linux';
  if (so === 'iPhone' || so === 'iPad') return instalado ? `${so} · app na tela inicial` : `${so} · Safari`;
  let nav = 'navegador';
  if (/SamsungBrowser/.test(s)) nav = 'Samsung Internet';
  else if (/EdgA?\//.test(s)) nav = 'Edge';
  else if (/OPR\//.test(s)) nav = 'Opera';
  else if (/Firefox\//.test(s)) nav = 'Firefox';
  else if (/Chrome\//.test(s)) nav = 'Chrome';
  else if (/Safari\//.test(s)) nav = 'Safari';
  return `${so} · ${nav}${instalado ? ' (app)' : ''}`;
}

function validarInscricao(sub) {
  const endpoint = String((sub && sub.endpoint) || '');
  const p256dh = String((sub && sub.keys && sub.keys.p256dh) || '');
  const auth = String((sub && sub.keys && sub.keys.auth) || '');
  if (endpoint.length > 1000 || !enderecoPermitido(endpoint)) throw new ErroValidacao('Endereço de notificação inválido.');
  if (!base64url.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) throw new ErroValidacao('Chave de notificação inválida.');
  if (!base64url.test(auth) || auth.length < 16 || auth.length > 30) throw new ErroValidacao('Chave de notificação inválida.');
  return { endpoint, p256dh, auth };
}

async function listarAparelhos(convidadoId, endpointAtual = '') {
  const linhas = await banco.tudo(
    'SELECT id, endpoint, aparelho, criado_em FROM push_inscricoes WHERE convidado_id = ? ORDER BY criado_em', [convidadoId]);
  return linhas.map((l) => ({
    id: Number(l.id), nome: l.aparelho || 'Aparelho', desde: Number(l.criado_em), esteAparelho: l.endpoint === endpointAtual,
  }));
}

// Idempotente: ativar de novo no mesmo aparelho só atualiza as chaves.
// Retorna { novo, aparelhos } ou { limite: true, aparelhos } (já tem 5 e este é um 6º).
async function inscrever(convidadoId, sub, { ua = '', instalado = false } = {}) {
  const { endpoint, p256dh, auth } = validarInscricao(sub);
  const nome = nomeDoAparelho(ua, instalado === true);
  const existente = await banco.um('SELECT id, convidado_id FROM push_inscricoes WHERE endpoint = ?', [endpoint]);
  if (existente && existente.convidado_id === convidadoId) {
    await banco.rodar('UPDATE push_inscricoes SET p256dh = ?, auth = ?, aparelho = ? WHERE id = ?', [p256dh, auth, nome, existente.id]);
    return { novo: false, aparelhos: await listarAparelhos(convidadoId, endpoint) };
  }
  const n = await banco.um('SELECT COUNT(*) AS n FROM push_inscricoes WHERE convidado_id = ?', [convidadoId]);
  if (Number(n.n) >= MAX_POR_CONVIDADO) {
    return { limite: true, maximo: MAX_POR_CONVIDADO, aparelhos: await listarAparelhos(convidadoId, endpoint) };
  }
  // O mesmo celular pode ter mudado de dono (outro link aberto nele): o endereço é do aparelho.
  await banco.lote([
    { sql: 'DELETE FROM push_inscricoes WHERE endpoint = ?', args: [endpoint] },
    { sql: 'INSERT INTO push_inscricoes (convidado_id, endpoint, p256dh, auth, aparelho, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
      args: [convidadoId, endpoint, p256dh, auth, nome, Date.now()] },
  ]);
  return { novo: true, aparelhos: await listarAparelhos(convidadoId, endpoint) };
}

async function desinscrever(convidadoId, endpoint) {
  await banco.rodar('DELETE FROM push_inscricoes WHERE convidado_id = ? AND endpoint = ?', [convidadoId, String(endpoint || '')]);
}

// Só apaga aparelho da própria pessoa (o id de outra pessoa simplesmente não casa).
async function removerAparelho(convidadoId, id) {
  const r = await banco.rodar('DELETE FROM push_inscricoes WHERE convidado_id = ? AND id = ?', [convidadoId, Number(id) || 0]);
  return Boolean(r.rowsAffected);
}

async function removerDoConvidado(convidadoId) {
  await banco.rodar('DELETE FROM push_inscricoes WHERE convidado_id = ?', [convidadoId]);
}

async function estaInscrito(convidadoId, endpoint) {
  return Boolean(await banco.um('SELECT 1 FROM push_inscricoes WHERE convidado_id = ? AND endpoint = ?', [convidadoId, String(endpoint || '')]));
}

async function situacao(convidadoId, endpoint) {
  const aparelhos = await listarAparelhos(convidadoId, String(endpoint || ''));
  return { inscrito: aparelhos.some((a) => a.esteAparelho), total: aparelhos.length, maximo: MAX_POR_CONVIDADO, aparelhos };
}

async function resumo() {
  const r = await banco.um(
    `SELECT COUNT(*) AS aparelhos, COUNT(DISTINCT p.convidado_id) AS pessoas,
            (SELECT COUNT(*) FROM convidados WHERE ativo = 1) AS convidados
       FROM push_inscricoes p JOIN convidados c ON c.id = p.convidado_id AND c.ativo = 1`);
  return { aparelhos: Number(r.aparelhos), pessoas: Number(r.pessoas), convidados: Number(r.convidados) };
}

// Quem tem avisos ligados (para o admin escolher para quem mandar um teste).
async function inscritos() {
  const linhas = await banco.tudo(
    `SELECT c.id, c.nome, COUNT(p.id) AS aparelhos FROM convidados c JOIN push_inscricoes p ON p.convidado_id = c.id
      WHERE c.ativo = 1 GROUP BY c.id, c.nome ORDER BY c.nome`);
  return linhas.map((l) => ({ id: l.id, nome: l.nome, aparelhos: Number(l.aparelhos) }));
}

// ------------------------------------------------------------------- envio
// para: 'todos' | { ids: [...] } ; exceto: [ids] ; endpoint: só este aparelho
// chave: trava contra envio repetido (a mesma chave nunca sai duas vezes).
async function enviar({ titulo, corpo, url = '/', tag, para = 'todos', exceto = [], chave = null, endpoint = null }) {
  const problema = problemaNoAviso({ titulo, corpo, url });
  if (problema) throw new ErroValidacao(problema);
  await prepararChaves();
  if (chave) {
    // Reinício, dois processos ou clique duplo: o INSERT OR IGNORE garante uma vez só.
    const r = await banco.rodar(
      'INSERT OR IGNORE INTO push_enviados (chave, titulo, corpo, para, entregues, enviado_em) VALUES (?, ?, ?, 0, 0, ?)',
      [chave, titulo, corpo, Date.now()]);
    if (!r.rowsAffected) return { pulado: true, para: 0, aparelhos: 0, entregues: 0, falhas: 0, expiradas: 0 };
  }
  let linhas = await banco.tudo(
    'SELECT p.* FROM push_inscricoes p JOIN convidados c ON c.id = p.convidado_id AND c.ativo = 1');
  if (para !== 'todos') linhas = linhas.filter((l) => para.ids.includes(l.convidado_id));
  if (exceto.length) linhas = linhas.filter((l) => !exceto.includes(l.convidado_id));
  if (endpoint) linhas = linhas.filter((l) => l.endpoint === endpoint);

  const registro = chave || `avulso:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
  const log = [];
  // Teto por hora (não vale para testes, que já têm o próprio limite).
  let limitados = 0;
  if (!registro.startsWith('teste:')) {
    const contagem = await recebidosNaUltimaHora([...new Set(linhas.map((l) => l.convidado_id))]);
    const passou = new Set([...contagem].filter(([, n]) => n >= MAX_POR_HORA).map(([id]) => id));
    if (passou.size) {
      for (const l of linhas.filter((x) => passou.has(x.convidado_id))) log.push({ chave: registro, convidadoId: l.convidado_id, inscricaoId: l.id, resultado: 'limite' });
      limitados = passou.size;
      linhas = linhas.filter((l) => !passou.has(l.convidado_id));
    }
  }

  const carga = JSON.stringify({ titulo, corpo, url: destinoSeguro(url), tag: tag || chave || 'projectv' });
  let entregues = 0;
  let falhas = 0;
  const mortas = [];
  // Em lotes de 10 para não abrir centenas de conexões ao mesmo tempo.
  for (let i = 0; i < linhas.length; i += 10) {
    await Promise.all(linhas.slice(i, i + 10).map(async (l) => {
      // Segunda barreira contra SSRF: mesmo uma linha antiga/restaurada de backup
      // com endereço estranho nunca recebe requisição do servidor.
      const item = { chave: registro, convidadoId: l.convidado_id, inscricaoId: l.id };
      if (!enderecoPermitido(l.endpoint)) { mortas.push(l.id); log.push({ ...item, resultado: 'invalida' }); return; }
      // Uma tentativa só: erro temporário não vira repetição (nada de loop de retry).
      try {
        await transporte({ endpoint: l.endpoint, keys: { p256dh: l.p256dh, auth: l.auth } }, carga);
        entregues += 1;
        log.push({ ...item, resultado: 'ok' });
      } catch (erro) {
        if (erro.statusCode === 404 || erro.statusCode === 410) { mortas.push(l.id); log.push({ ...item, resultado: 'expirada', codigo: erro.statusCode }); }
        else {
          falhas += 1;
          log.push({ ...item, resultado: 'falha', codigo: erro.statusCode || null });
          console.error('[push] falha ao enviar:', erro.statusCode || '', erro.message);
        }
      }
    }));
  }
  if (mortas.length) {
    await banco.lote(mortas.map((id) => ({ sql: 'DELETE FROM push_inscricoes WHERE id = ?', args: [id] })));
  }
  await registrar(log).catch((e) => console.error('[push] registro:', e.message));
  const pessoas = new Set(linhas.map((l) => l.convidado_id)).size;
  await banco.rodar(
    `INSERT INTO push_enviados (chave, titulo, corpo, para, entregues, falhas, enviado_em) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chave) DO UPDATE SET para = excluded.para, entregues = excluded.entregues, falhas = excluded.falhas`,
    [registro, titulo, corpo, pessoas, entregues, falhas + mortas.length, Date.now()]);
  if (linhas.length || limitados) {
    console.log(`[push] ${registro} → ${entregues}/${linhas.length} aparelhos (${falhas} falhas, ${mortas.length} expirados, ${limitados} pessoas no limite/h)`);
  }
  return { para: pessoas, aparelhos: linhas.length, entregues, falhas, expiradas: mortas.length, limitados };
}

const enviarPara = (convidadoId, aviso) => enviar({ ...aviso, para: { ids: [convidadoId] } });

// Teste num aparelho só, SÓ quando a pessoa pede (botão "Testar notificação").
// Nada de envio automático ao ativar: mensagem de confirmação genérica logo depois de
// aceitar a permissão é o padrão típico de sites de spam.
// No máximo 1 teste a cada 10 min por aparelho (trava no banco, vale entre reinícios).
function textoTeste(agora = Date.now()) {
  return {
    titulo: 'Project V: teste de avisos',
    corpo: `Teste pedido por você às ${horaTexto(agora)}. Os avisos da festa de Halloween vão chegar assim.`,
  };
}
async function testarAparelho(convidadoId, endpoint) {
  await prepararChaves();
  const l = await banco.um('SELECT * FROM push_inscricoes WHERE convidado_id = ? AND endpoint = ?', [convidadoId, String(endpoint || '')]);
  if (!l) return { entregue: false, motivo: 'nao-inscrito' };
  if (!enderecoPermitido(l.endpoint)) return { entregue: false, motivo: 'invalido' };
  const agora = Date.now();
  const chave = `teste:aparelho:${l.id}:${Math.floor(agora / ESPERA_TESTE_MS)}`;
  const { titulo, corpo } = textoTeste(agora);
  const trava = await banco.rodar(
    'INSERT OR IGNORE INTO push_enviados (chave, titulo, corpo, para, entregues, enviado_em) VALUES (?, ?, ?, 1, 0, ?)',
    [chave, titulo, corpo, agora]);
  if (!trava.rowsAffected) return { entregue: false, motivo: 'espera' };
  const item = { chave, convidadoId, inscricaoId: l.id };
  try {
    await transporte({ endpoint: l.endpoint, keys: { p256dh: l.p256dh, auth: l.auth } },
      JSON.stringify({ titulo, corpo, url: '/#avisos', tag: 'teste' }));
    await banco.rodar('UPDATE push_enviados SET entregues = 1 WHERE chave = ?', [chave]);
    await registrar([{ ...item, resultado: 'ok' }]).catch(() => {});
    return { entregue: true };
  } catch (erro) {
    if (erro.statusCode === 404 || erro.statusCode === 410) {
      await banco.rodar('DELETE FROM push_inscricoes WHERE id = ?', [l.id]);
      await registrar([{ ...item, resultado: 'expirada', codigo: erro.statusCode }]).catch(() => {});
      return { entregue: false, motivo: 'expirada' };
    }
    await registrar([{ ...item, resultado: 'falha', codigo: erro.statusCode || null }]).catch(() => {});
    console.error('[push] teste falhou:', erro.statusCode || '', erro.message);
    return { entregue: false, motivo: 'falha' };
  }
}

// Registro por aparelho das últimas 24 h (inclui testes), para auditar repetição.
async function registro24h() {
  const linhas = await banco.tudo(
    `SELECT chave, resultado, COUNT(*) AS n, MAX(em) AS ultimo FROM push_log WHERE em > ?
      GROUP BY chave, resultado ORDER BY ultimo DESC LIMIT 200`, [Date.now() - 24 * 3600 * 1000]);
  const mapa = new Map();
  for (const l of linhas) {
    const k = l.chave.startsWith('teste:aparelho:') ? 'teste:aparelho' : l.chave.startsWith('teste:admin:') ? 'teste:admin' : l.chave;
    const r = mapa.get(k) || { chave: k, ok: 0, falha: 0, expirada: 0, limite: 0, invalida: 0, ultimo: 0 };
    r[l.resultado] = (r[l.resultado] || 0) + Number(l.n);
    r.ultimo = Math.max(r.ultimo, Number(l.ultimo));
    mapa.set(k, r);
  }
  return [...mapa.values()].sort((x, y) => y.ultimo - x.ultimo).slice(0, 40);
}

async function historico(limite = 30) {
  const linhas = await banco.tudo("SELECT * FROM push_enviados WHERE chave NOT LIKE 'teste:%' ORDER BY enviado_em DESC LIMIT ?", [limite]);
  return linhas.map((l) => ({
    chave: l.chave, titulo: l.titulo, corpo: l.corpo, para: Number(l.para), entregues: Number(l.entregues),
    falhas: Number(l.falhas || 0), enviadoEm: Number(l.enviado_em),
  }));
}

// ------------------------------------------------------ horários (Manaus)
const HORA = 3600 * 1000;
function horaManaus(ms) { return new Date(ms - 4 * HORA).getUTCHours(); }
const madrugada = (ms) => horaManaus(ms) < 8; // 0h às 7h59

// ------------------------------------------------- quem está olhando qual tela
// Só memória e só enquanto a aba está visível: é o "agora" de cada conexão.
// Serve para não avisar sobre uma música nova quem já está olhando a playlist.
const telas = new Map(); // socketId -> { convidadoId, tela }
function marcarTela(socketId, convidadoId, tela) {
  if (tela) telas.set(socketId, { convidadoId, tela: String(tela).slice(0, 30) });
  else telas.delete(socketId);
}
const sairTela = (socketId) => telas.delete(socketId);
function olhando(tela) {
  const ids = new Set();
  for (const t of telas.values()) if (t.tela === tela) ids.add(t.convidadoId);
  return [...ids];
}

// ---------------------------------------------- movimento dos amigos (agrupado)
const SOCIAIS = {
  contribuicao: {
    url: '/#contribuicoes', tela: 'contribuicoes',
    texto: (n) => (n === 1
      ? ['Project V: nova contribuição', 'Alguém adicionou uma contribuição à lista da festa. Veja o que ainda falta.']
      : ['Project V: novas contribuições', `${n} contribuições novas na lista da festa. Veja o que ainda falta.`]),
    duranteFesta: false,
  },
  carona: {
    url: '/#caronas', tela: 'caronas',
    texto: (n) => (n === 1
      ? ['Project V: nova carona', 'Alguém ofereceu carona para a festa. Veja as vagas disponíveis.']
      : ['Project V: novas caronas', `${n} caronas novas para a festa. Veja as vagas disponíveis.`]),
    duranteFesta: true,
  },
  musica: {
    url: '/#playlist', tela: 'playlist',
    texto: (n) => (n === 1
      ? ['Project V: música nova', 'Alguém sugeriu uma música para a playlist da festa. Vote nas suas preferidas.']
      : ['Project V: músicas novas', `${n} músicas novas na playlist da festa. Vote nas suas preferidas.`]),
    duranteFesta: false,
  },
};
const LOTE_MS = Number(process.env.PUSH_LOTE_MS || 2 * 60 * 1000);
const INTERVALO_MS = Number(process.env.PUSH_INTERVALO_MS || 20 * 60 * 1000);

// Fila no banco: um reinício do Render não perde o que estava para sair.
// Nunca derruba a ação da pessoa: se a fila falhar, só não haverá aviso.
async function evento(tipo, autorId, agora = Date.now()) {
  if (!SOCIAIS[tipo]) return;
  try {
    await banco.rodar(
      `INSERT INTO push_fila (tipo, n, autores, desde, ultimo_envio) VALUES (?, 1, json_array(?), ?, 0)
       ON CONFLICT(tipo) DO UPDATE SET
         n = push_fila.n + 1,
         desde = COALESCE(push_fila.desde, excluded.desde),
         autores = CASE WHEN EXISTS (SELECT 1 FROM json_each(push_fila.autores) WHERE value = ?)
                        THEN push_fila.autores ELSE json_insert(push_fila.autores, '$[#]', ?) END`,
      [tipo, autorId, agora, autorId, autorId]);
  } catch (erro) {
    console.error('[push] fila:', erro.message);
  }
}

async function despacharSociais(agora = Date.now()) {
  const fila = await banco.tudo('SELECT * FROM push_fila WHERE n > 0');
  if (!fila.length) return 0;
  const info = await festa.info();
  const emFesta = agora >= info.inicioMs && agora < info.fimMs + 2 * HORA;
  const depoisDaFesta = agora >= info.fimMs + 2 * HORA;
  let enviados = 0;
  for (const p of fila) {
    const cfg = SOCIAIS[p.tipo];
    const zerar = (ultimo) => banco.rodar(
      "UPDATE push_fila SET n = 0, autores = '[]', desde = NULL, ultimo_envio = ? WHERE tipo = ? AND n = ?",
      [ultimo, p.tipo, p.n]);
    if (!cfg || depoisDaFesta || (emFesta && !cfg.duranteFesta)) { await zerar(Number(p.ultimo_envio)); continue; }
    if (!emFesta && madrugada(agora)) continue; // segura até as 8h
    if (agora - Number(p.ultimo_envio) < INTERVALO_MS) continue;
    if (agora - Number(p.desde || agora) < LOTE_MS) continue; // espera o lote juntar
    // Reserva o lote: se outro processo já pegou (ou chegou evento novo), não manda duplicado.
    const r = await zerar(agora);
    if (!r.rowsAffected) continue;
    let autores = [];
    try { autores = JSON.parse(p.autores); } catch (_) { /* fila corrompida: ninguém fica de fora */ }
    const n = Number(p.n);
    const [titulo, corpo] = cfg.texto(n);
    await enviar({ titulo, corpo, url: cfg.url, tag: `social-${p.tipo}`, chave: `social:${p.tipo}:${agora}`, exceto: [...new Set([...autores, ...olhando(cfg.tela)])] });
    enviados += 1;
  }
  return enviados;
}

// ------------------------------------------------------- atividade liberada
const TEXTOS_LIBERADA = {
  previsoes: ['Project V: Previsões abertas', 'As apostas sobre a festa estão abertas até sábado às 17h.'],
  pos: ['Project V: votação do pós aberta', 'Vote no lugar para onde o grupo vai depois da meia-noite.'],
};
async function atividadeLiberada(atividade) {
  const [titulo, corpo] = TEXTOS_LIBERADA[atividade.id]
    || [`Project V: ${atividade.nome} liberado`.slice(0, 60), `A atividade ${atividade.nome} já está disponível no site da festa.`];
  return enviar({ titulo, corpo, url: atividade.id === 'pos' ? '/#pos' : '/', chave: `liberou:${atividade.id}` });
}

// ----------------------------------------------------------------- agendados
// Horários relativos ao início/fim da festa: mudar a data no admin muda tudo junto.
// Só envia dentro de uma janela depois do horário (servidor dormindo não manda aviso velho).
async function agendados() {
  const info = await festa.info();
  const lista = [
    { chave: 'vespera', quando: info.inicioMs - 22 * HORA, janela: 6 * HORA, url: '/',
      titulo: 'Project V é amanhã', corpo: `Festa de Halloween: ${PV_periodo(info)}. Veja as informações da festa.` },
    { chave: 'contribuicoes', quando: info.inicioMs - 7 * HORA, janela: 4 * HORA, url: '/#contribuicoes', dinamico: true },
    { chave: 'faltam2h', quando: info.inicioMs - 2 * HORA, janela: HORA, url: '/#chegar',
      titulo: `Project V começa às ${horaTexto(info.inicioMs)}`, corpo: 'Faltam 2 horas para a festa de Halloween. Veja como chegar.' },
    { chave: 'portoes', quando: info.inicioMs, janela: HORA, url: '/',
      titulo: 'Project V começou', corpo: 'A festa de Halloween começou. Acompanhe as atividades pelo site.' },
    { chave: 'campeao-pos', quando: info.fimMs, janela: 2 * HORA, url: '/#pos', dinamico: true },
  ];
  return { info, lista };
}

function horaTexto(ms) {
  const hh = horaManaus(ms); const mm = new Date(ms - 4 * HORA).getUTCMinutes();
  if (hh === 0 && mm === 0) return 'meia-noite';
  return mm ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`;
}
function PV_periodo(info) {
  const fim = horaTexto(info.fimMs);
  return `sábado, das ${horaTexto(info.inicioMs)} ${fim === 'meia-noite' ? 'à' : 'às'} ${fim}`;
}

async function textoDinamico(chave) {
  if (chave === 'contribuicoes') {
    const bebidas = require('./dados/bebidas');
    const b = await bebidas.paraAdmin();
    const faltando = b.itens.filter((i) => i.falta > 0).sort((x, y) => y.falta - x.falta);
    if (!faltando.length) return null; // tudo garantido: não incomoda ninguém
    const partes = faltando.slice(0, 2).map((i) => `${i.falta} ${i.falta === 1 ? i.unidade.replace(/^(\S+?)s\b/, '$1') : i.unidade} de ${i.nome}`);
    return ['Project V: lista de contribuições', `Ainda faltam ${partes.join(' e ')} para a festa. Veja o que você pode levar.`];
  }
  if (chave === 'campeao-pos') {
    const pos = require('./dados/pos');
    const r = await pos.resultado();
    if (!r.liberada || !r.total) return null;
    const lideres = r.opcoes.filter((o) => r.lideres.includes(o.id)).map((o) => o.nome);
    return lideres.length === 1
      ? ['Project V: resultado do pós', `O lugar mais votado para depois da festa foi ${lideres[0]}.`]
      : ['Project V: empate no pós', `Deu empate na votação do pós entre ${lideres.join(' e ')}.`];
  }
  return null;
}

async function verificarAgendados(agora = Date.now()) {
  const { lista } = await agendados();
  let enviados = 0;
  for (const a of lista) {
    if (agora < a.quando || agora > a.quando + a.janela) continue;
    if (await banco.um('SELECT 1 FROM push_enviados WHERE chave = ?', [`agenda:${a.chave}`])) continue;
    let { titulo, corpo } = a;
    if (a.dinamico) {
      const t = await textoDinamico(a.chave);
      if (!t) {
        // Nada a dizer: marca como resolvido para não tentar de novo.
        await banco.rodar('INSERT OR IGNORE INTO push_enviados (chave, titulo, corpo, para, entregues, enviado_em) VALUES (?, ?, ?, 0, 0, ?)',
          [`agenda:${a.chave}`, '(sem envio)', 'nada a avisar', agora]);
        continue;
      }
      [titulo, corpo] = t;
    }
    try {
      const r = await enviar({ titulo, corpo, url: a.url, chave: `agenda:${a.chave}` });
      if (!r.pulado) enviados += 1;
    } catch (erro) {
      // Texto montado com dados do admin que não passou na checagem: registra e não tenta de novo.
      console.error(`[push] agenda:${a.chave} recusado:`, erro.message);
      await banco.rodar('INSERT OR IGNORE INTO push_enviados (chave, titulo, corpo, para, entregues, enviado_em) VALUES (?, ?, ?, 0, 0, ?)',
        [`agenda:${a.chave}`, '(sem envio)', `recusado: ${erro.message}`.slice(0, 180), agora]);
    }
  }
  return enviados;
}

async function programados() {
  const { lista } = await agendados();
  const feitos = await banco.tudo("SELECT chave, enviado_em, para, entregues, falhas FROM push_enviados WHERE chave LIKE 'agenda:%'");
  const mapa = new Map(feitos.map((f) => [f.chave.slice(7), f]));
  const nomes = { vespera: 'Lembrete da véspera', contribuicoes: 'O que falta nas Contribuições', faltam2h: 'Faltam 2 horas',
    portoes: 'Portões abertos', 'campeao-pos': 'Campeão do pós' };
  return lista.map((a) => {
    const f = mapa.get(a.chave);
    return { chave: a.chave, nome: nomes[a.chave], quando: a.quando, enviado: Boolean(f), enviadoEm: f ? Number(f.enviado_em) : null,
      para: f ? Number(f.para) : 0, entregues: f ? Number(f.entregues) : 0, falhas: f ? Number(f.falhas || 0) : 0 };
  });
}

// ------------------------------------------------------------------ relógio
// Duas fontes de "tic", para não depender do processo ficar acordado:
//  1. intervalo de 30 s enquanto o processo está de pé;
//  2. `tocar()` em cada acesso (inclusive o /saude do monitor externo), no máximo
//     1 vez a cada 30 s. Quem acorda o Render free já dispara o que estiver na hora.
// Os dois são seguros juntos: cada aviso tem trava no banco.
let timer = null;
let ultimoToque = 0;
let rodando = null;
async function tic(agora = Date.now()) {
  await verificarAgendados(agora);
  await despacharSociais(agora);
}
function tocar() {
  if (process.env.PUSH_FALSO === '1') return; // nos testes o relógio é controlado à mão
  const agora = Date.now();
  if (rodando || agora - ultimoToque < 30 * 1000) return;
  ultimoToque = agora;
  rodando = tic(agora).catch((e) => console.error('[push]', e.message)).finally(() => { rodando = null; });
}
function iniciar() {
  if (timer || process.env.PUSH_FALSO === '1') return;
  prepararChaves().catch((e) => console.error('[push] chaves:', e.message));
  timer = setInterval(tocar, 30 * 1000);
  timer.unref();
  tocar();
}
function parar() { clearInterval(timer); timer = null; }

module.exports = {
  chavePublica, inscrever, desinscrever, removerAparelho, removerDoConvidado, estaInscrito, situacao, listarAparelhos,
  resumo, inscritos, enviar, enviarPara, testarAparelho, historico, registro24h, programados, evento, despacharSociais,
  verificarAgendados, atividadeLiberada, tic, tocar, iniciar, parar, enderecoPermitido, nomeDoAparelho,
  marcarTela, sairTela, olhando, caixa, MAX_POR_CONVIDADO, DESTINOS, problemaNoAviso, textoTeste, MAX_POR_HORA, ESPERA_TESTE_MS,
  _modelos: () => ({ SOCIAIS, TEXTOS_LIBERADA, agendados, textoDinamico }),
  _zerarSociais: async () => { await banco.rodar('DELETE FROM push_fila'); telas.clear(); },
};
