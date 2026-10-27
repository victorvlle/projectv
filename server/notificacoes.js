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

// ------------------------------------------------------------------- envio
// Em teste (PUSH_FALSO=1) nada sai pela rede: os envios ficam em `caixa`.
const caixa = [];
let transporte = async (inscricao, carga) => webpush.sendNotification(inscricao, carga, { TTL: 6 * 60 * 60, urgency: 'high' });
if (process.env.PUSH_FALSO === '1') {
  transporte = async (inscricao, carga) => {
    caixa.push({ endpoint: inscricao.endpoint, ...JSON.parse(carga) });
    if (inscricao.endpoint.includes('/morta')) { const e = new Error('Gone'); e.statusCode = 410; throw e; }
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

  const carga = JSON.stringify({ titulo, corpo, url: destinoSeguro(url), tag: tag || chave || 'projectv' });
  let entregues = 0;
  let falhas = 0;
  const mortas = [];
  // Em lotes de 10 para não abrir centenas de conexões ao mesmo tempo.
  for (let i = 0; i < linhas.length; i += 10) {
    await Promise.all(linhas.slice(i, i + 10).map(async (l) => {
      // Segunda barreira contra SSRF: mesmo uma linha antiga/restaurada de backup
      // com endereço estranho nunca recebe requisição do servidor.
      if (!enderecoPermitido(l.endpoint)) { mortas.push(l.id); return; }
      try {
        await transporte({ endpoint: l.endpoint, keys: { p256dh: l.p256dh, auth: l.auth } }, carga);
        entregues += 1;
      } catch (erro) {
        if (erro.statusCode === 404 || erro.statusCode === 410) mortas.push(l.id);
        else { falhas += 1; console.error('[push] falha ao enviar:', erro.statusCode || '', erro.message); }
      }
    }));
  }
  if (mortas.length) {
    await banco.lote(mortas.map((id) => ({ sql: 'DELETE FROM push_inscricoes WHERE id = ?', args: [id] })));
  }
  const pessoas = new Set(linhas.map((l) => l.convidado_id)).size;
  const registro = chave || `avulso:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
  await banco.rodar(
    `INSERT INTO push_enviados (chave, titulo, corpo, para, entregues, falhas, enviado_em) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chave) DO UPDATE SET para = excluded.para, entregues = excluded.entregues, falhas = excluded.falhas`,
    [registro, titulo, corpo, pessoas, entregues, falhas + mortas.length, Date.now()]);
  if (linhas.length) console.log(`[push] "${titulo}" → ${entregues}/${linhas.length} aparelhos (${falhas} falhas, ${mortas.length} expirados)`);
  return { para: pessoas, aparelhos: linhas.length, entregues, falhas, expiradas: mortas.length };
}

const enviarPara = (convidadoId, aviso) => enviar({ ...aviso, para: { ids: [convidadoId] } });

// Teste num aparelho só (o que acabou de ativar, ou o que a pessoa escolheu).
// Não grava no histórico geral: é conversa entre o servidor e aquele celular.
const TESTE = { titulo: 'Project V', corpo: 'Notificações ativadas! Você está na lista para receber os avisos da festa.' };
async function testarAparelho(convidadoId, endpoint) {
  await prepararChaves();
  const l = await banco.um('SELECT * FROM push_inscricoes WHERE convidado_id = ? AND endpoint = ?', [convidadoId, String(endpoint || '')]);
  if (!l) return { entregue: false, motivo: 'nao-inscrito' };
  if (!enderecoPermitido(l.endpoint)) return { entregue: false, motivo: 'invalido' };
  try {
    await transporte({ endpoint: l.endpoint, keys: { p256dh: l.p256dh, auth: l.auth } },
      JSON.stringify({ ...TESTE, url: '/#avisos', tag: 'boas-vindas' }));
    return { entregue: true };
  } catch (erro) {
    if (erro.statusCode === 404 || erro.statusCode === 410) {
      await banco.rodar('DELETE FROM push_inscricoes WHERE id = ?', [l.id]);
      return { entregue: false, motivo: 'expirada' };
    }
    console.error('[push] teste falhou:', erro.statusCode || '', erro.message);
    return { entregue: false, motivo: 'falha' };
  }
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
      ? ['🍻 Nova contribuição', 'Alguém adicionou uma contribuição! Veja o que ainda falta.']
      : ['🍻 Novas contribuições', `${n} contribuições novas! Veja o que ainda falta.`]),
    duranteFesta: false,
  },
  carona: {
    url: '/#caronas', tela: 'caronas',
    texto: (n) => (n === 1
      ? ['🚗 Nova carona', 'Alguém ofereceu carona! Precisa de uma vaga?']
      : ['🚗 Novas caronas', `${n} caronas novas! Precisa de uma vaga?`]),
    duranteFesta: true,
  },
  musica: {
    url: '/#playlist', tela: 'playlist',
    texto: (n) => (n === 1
      ? ['🎵 Música nova', 'Alguém adicionou uma música. Vote nas melhores!']
      : ['🎵 Músicas novas', `${n} músicas novas na playlist. Vote nas melhores!`]),
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
    await enviar({ titulo, corpo, url: cfg.url, tag: `social-${p.tipo}`, exceto: [...new Set([...autores, ...olhando(cfg.tela)])] });
    enviados += 1;
  }
  return enviados;
}

// ------------------------------------------------------- atividade liberada
const TEXTOS_LIBERADA = {
  previsoes: ['🔮 As Previsões abriram!', 'Aposte no que vai rolar na festa. Fecha às 17h de sábado.'],
  pos: ['🌙 A votação do pós abriu!', 'Para onde a noite continua depois da meia-noite? Vote agora.'],
};
async function atividadeLiberada(atividade) {
  const [titulo, corpo] = TEXTOS_LIBERADA[atividade.id] || [`🔓 ${atividade.nome} foi liberado!`, 'Abra o Project V e participe.'];
  return enviar({ titulo, corpo, url: atividade.id === 'pos' ? '/#pos' : '/', chave: `liberou:${atividade.id}` });
}

// ----------------------------------------------------------------- agendados
// Horários relativos ao início/fim da festa: mudar a data no admin muda tudo junto.
// Só envia dentro de uma janela depois do horário (servidor dormindo não manda aviso velho).
async function agendados() {
  const info = await festa.info();
  const lista = [
    { chave: 'vespera', quando: info.inicioMs - 22 * HORA, janela: 6 * HORA, url: '/',
      titulo: '🎃 Amanhã é o Project V!', corpo: `${PV_periodo(info)}. Já escolheu a fantasia?` },
    { chave: 'contribuicoes', quando: info.inicioMs - 7 * HORA, janela: 4 * HORA, url: '/#contribuicoes', dinamico: true },
    { chave: 'faltam2h', quando: info.inicioMs - 2 * HORA, janela: HORA, url: '/',
      titulo: '⏳ Faltam 2 horas!', corpo: `Hoje às ${horaTexto(info.inicioMs)}. Fantasia pronta? Te espero lá. 💀` },
    { chave: 'portoes', quando: info.inicioMs, janela: HORA, url: '/',
      titulo: '🎃 Os portões estão abertos!', corpo: 'O Project V começou. Abra o site para acompanhar a noite.' },
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
  return `Sábado, das ${horaTexto(info.inicioMs)} ${fim === 'meia-noite' ? 'à' : 'às'} ${fim}`;
}

async function textoDinamico(chave) {
  if (chave === 'contribuicoes') {
    const bebidas = require('./dados/bebidas');
    const b = await bebidas.paraAdmin();
    const faltando = b.itens.filter((i) => i.falta > 0).sort((x, y) => y.falta - x.falta);
    if (!faltando.length) return null; // tudo garantido: não incomoda ninguém
    const partes = faltando.slice(0, 2).map((i) => `${i.falta} ${i.falta === 1 ? i.unidade.replace(/^(\S+?)s\b/, '$1') : i.unidade} de ${i.nome}`);
    return ['🍻 Ainda falta bebida!', `Faltam ${partes.join(' e ')} nas Contribuições. Bora fechar a lista?`];
  }
  if (chave === 'campeao-pos') {
    const pos = require('./dados/pos');
    const r = await pos.resultado();
    if (!r.liberada || !r.total) return null;
    const lideres = r.opcoes.filter((o) => r.lideres.includes(o.id)).map((o) => o.nome);
    return lideres.length === 1
      ? ['👑 Temos um pós!', `O pós de hoje é o ${lideres[0]}. Partiu!`]
      : ['👑 Deu empate no pós!', `Empate entre ${lideres.join(' e ')}. Decidam aí!`];
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
    const r = await enviar({ titulo, corpo, url: a.url, chave: `agenda:${a.chave}` });
    if (!r.pulado) enviados += 1;
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
  resumo, inscritos, enviar, enviarPara, testarAparelho, historico, programados, evento, despacharSociais,
  verificarAgendados, atividadeLiberada, tic, tocar, iniciar, parar, enderecoPermitido, nomeDoAparelho,
  marcarTela, sairTela, olhando, caixa, MAX_POR_CONVIDADO, DESTINOS,
  _zerarSociais: async () => { await banco.rodar('DELETE FROM push_fila'); telas.clear(); },
};
