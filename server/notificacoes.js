// Notificações no celular (Web Push), mesmo com o site fechado.
//
// PEÇAS
//  - Chaves VAPID: de VAPID_PUBLIC/VAPID_PRIVATE ou, se não houver, geradas uma vez e
//    guardadas no banco (config 'vapid'), para não mudarem a cada reinício.
//  - Inscrições: cada celular que ativou vira uma linha em push_inscricoes.
//  - Envio: `enviar()` para todos, para uma pessoa ou para uma lista. Inscrições que
//    o serviço de push diz que morreram (404/410) são apagadas.
//  - push_enviados: histórico e trava contra envio repetido (chave única por aviso).
//
// TIPOS DE AVISO
//  - Agendados (véspera, faltam 2h, contribuições, portões, campeão do pós): a cada
//    30 s o servidor confere o horário (derivado da data da festa) e manda uma vez só.
//  - Atividade liberada: quando o admin ou o agendador libera, uma vez por atividade.
//  - Movimento dos amigos (contribuição, carona, música): agrupados em lote de 2 min,
//    no máximo um aviso de cada tipo a cada 20 min, silenciados de 0h a 8h e não
//    vão para quem fez a ação.
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

async function inscrever(convidadoId, sub) {
  const endpoint = String((sub && sub.endpoint) || '');
  const p256dh = String((sub && sub.keys && sub.keys.p256dh) || '');
  const auth = String((sub && sub.keys && sub.keys.auth) || '');
  if (endpoint.length > 1000 || !enderecoPermitido(endpoint)) throw new ErroValidacao('Endereço de notificação inválido.');
  if (!base64url.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) throw new ErroValidacao('Chave de notificação inválida.');
  if (!base64url.test(auth) || auth.length < 16 || auth.length > 30) throw new ErroValidacao('Chave de notificação inválida.');
  // O mesmo celular pode ter mudado de dono (outro link aberto nele): o endereço é do aparelho.
  await banco.rodar('DELETE FROM push_inscricoes WHERE endpoint = ?', [endpoint]);
  const n = await banco.um('SELECT COUNT(*) AS n FROM push_inscricoes WHERE convidado_id = ?', [convidadoId]);
  if (Number(n.n) >= MAX_POR_CONVIDADO) {
    // Guarda os aparelhos mais recentes: apaga o mais antigo.
    await banco.rodar(`DELETE FROM push_inscricoes WHERE id = (SELECT id FROM push_inscricoes WHERE convidado_id = ? ORDER BY criado_em LIMIT 1)`, [convidadoId]);
  }
  await banco.rodar('INSERT INTO push_inscricoes (convidado_id, endpoint, p256dh, auth, criado_em) VALUES (?, ?, ?, ?, ?)',
    [convidadoId, endpoint, p256dh, auth, Date.now()]);
}

async function desinscrever(convidadoId, endpoint) {
  await banco.rodar('DELETE FROM push_inscricoes WHERE convidado_id = ? AND endpoint = ?', [convidadoId, String(endpoint || '')]);
}

async function removerDoConvidado(convidadoId) {
  await banco.rodar('DELETE FROM push_inscricoes WHERE convidado_id = ?', [convidadoId]);
}

async function estaInscrito(convidadoId, endpoint) {
  return Boolean(await banco.um('SELECT 1 FROM push_inscricoes WHERE convidado_id = ? AND endpoint = ?', [convidadoId, String(endpoint || '')]));
}

async function resumo() {
  const r = await banco.um(
    `SELECT COUNT(*) AS aparelhos, COUNT(DISTINCT p.convidado_id) AS pessoas,
            (SELECT COUNT(*) FROM convidados WHERE ativo = 1) AS convidados
       FROM push_inscricoes p JOIN convidados c ON c.id = p.convidado_id AND c.ativo = 1`);
  return { aparelhos: Number(r.aparelhos), pessoas: Number(r.pessoas), convidados: Number(r.convidados) };
}

// para: 'todos' | { ids: [...] } ; exceto: [ids]
async function enviar({ titulo, corpo, url = '/', tag, para = 'todos', exceto = [], chave = null }) {
  await prepararChaves();
  if (chave) {
    // Trava: a mesma chave nunca sai duas vezes (reinício, dois processos, clique duplo).
    const r = await banco.rodar(
      'INSERT OR IGNORE INTO push_enviados (chave, titulo, corpo, para, entregues, enviado_em) VALUES (?, ?, ?, 0, 0, ?)',
      [chave, titulo, corpo, Date.now()]);
    if (!r.rowsAffected) return { pulado: true, para: 0, entregues: 0 };
  }
  let linhas = await banco.tudo(
    'SELECT p.* FROM push_inscricoes p JOIN convidados c ON c.id = p.convidado_id AND c.ativo = 1');
  if (para !== 'todos') linhas = linhas.filter((l) => para.ids.includes(l.convidado_id));
  if (exceto.length) linhas = linhas.filter((l) => !exceto.includes(l.convidado_id));

  const carga = JSON.stringify({ titulo, corpo, url, tag: tag || chave || 'projectv' });
  let entregues = 0;
  const mortas = [];
  // Em lotes de 10 para não abrir centenas de conexões ao mesmo tempo.
  for (let i = 0; i < linhas.length; i += 10) {
    await Promise.all(linhas.slice(i, i + 10).map(async (l) => {
      try {
        await transporte({ endpoint: l.endpoint, keys: { p256dh: l.p256dh, auth: l.auth } }, carga);
        entregues += 1;
      } catch (erro) {
        if (erro.statusCode === 404 || erro.statusCode === 410) mortas.push(l.id);
        else console.error('[push] falha ao enviar:', erro.statusCode || '', erro.message);
      }
    }));
  }
  if (mortas.length) {
    await banco.lote(mortas.map((id) => ({ sql: 'DELETE FROM push_inscricoes WHERE id = ?', args: [id] })));
  }
  const pessoas = new Set(linhas.map((l) => l.convidado_id)).size;
  const registro = chave || `avulso:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
  await banco.rodar(
    `INSERT INTO push_enviados (chave, titulo, corpo, para, entregues, enviado_em) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(chave) DO UPDATE SET para = excluded.para, entregues = excluded.entregues`,
    [registro, titulo, corpo, pessoas, entregues, Date.now()]);
  if (linhas.length) console.log(`[push] "${titulo}" → ${entregues}/${linhas.length} aparelhos`);
  return { para: pessoas, entregues };
}

const enviarPara = (convidadoId, aviso) => enviar({ ...aviso, para: { ids: [convidadoId] } });

async function historico(limite = 30) {
  const linhas = await banco.tudo('SELECT * FROM push_enviados ORDER BY enviado_em DESC LIMIT ?', [limite]);
  return linhas.map((l) => ({ chave: l.chave, titulo: l.titulo, corpo: l.corpo, para: Number(l.para), entregues: Number(l.entregues), enviadoEm: Number(l.enviado_em) }));
}

// ------------------------------------------------------ horários (Manaus)
const HORA = 3600 * 1000;
function horaManaus(ms) { return new Date(ms - 4 * HORA).getUTCHours(); }
const madrugada = (ms) => horaManaus(ms) < 8; // 0h às 7h59

// ---------------------------------------------- movimento dos amigos (agrupado)
const SOCIAIS = {
  contribuicao: {
    url: '/#contribuicoes',
    texto: (n) => (n === 1
      ? ['🍻 Nova contribuição', 'Alguém adicionou uma contribuição! Veja o que ainda falta.']
      : ['🍻 Novas contribuições', `${n} contribuições novas! Veja o que ainda falta.`]),
    duranteFesta: false,
  },
  carona: {
    url: '/#caronas',
    texto: (n) => (n === 1
      ? ['🚗 Nova carona', 'Alguém ofereceu carona! Precisa de uma vaga?']
      : ['🚗 Novas caronas', `${n} caronas novas! Precisa de uma vaga?`]),
    duranteFesta: true,
  },
  musica: {
    url: '/#playlist',
    texto: (n) => (n === 1
      ? ['🎵 Música nova', 'Alguém adicionou uma música. Vote nas melhores!']
      : ['🎵 Músicas novas', `${n} músicas novas na playlist. Vote nas melhores!`]),
    duranteFesta: false,
  },
};
const LOTE_MS = Number(process.env.PUSH_LOTE_MS || 2 * 60 * 1000);
const INTERVALO_MS = Number(process.env.PUSH_INTERVALO_MS || 20 * 60 * 1000);
const pendentes = new Map(); // tipo -> { n, autores:Set }
const ultimoEnvio = new Map(); // tipo -> ms

function evento(tipo, autorId) {
  if (!SOCIAIS[tipo]) return;
  const p = pendentes.get(tipo) || { n: 0, autores: new Set() };
  p.n += 1;
  p.autores.add(autorId);
  pendentes.set(tipo, p);
}

async function despacharSociais(agora = Date.now()) {
  if (!pendentes.size) return 0;
  const info = await festa.info();
  const emFesta = agora >= info.inicioMs && agora < info.fimMs + 2 * HORA;
  const depoisDaFesta = agora >= info.fimMs + 2 * HORA;
  let enviados = 0;
  for (const [tipo, p] of pendentes) {
    const cfg = SOCIAIS[tipo];
    if (depoisDaFesta || (emFesta && !cfg.duranteFesta)) { pendentes.delete(tipo); continue; }
    if (!emFesta && madrugada(agora)) continue; // segura até as 8h
    if (agora - (ultimoEnvio.get(tipo) || 0) < INTERVALO_MS) continue;
    if (!p.desde) { p.desde = agora; continue; } // espera o lote juntar
    if (agora - p.desde < LOTE_MS) continue;
    pendentes.delete(tipo);
    ultimoEnvio.set(tipo, agora);
    const [titulo, corpo] = cfg.texto(p.n);
    await enviar({ titulo, corpo, url: cfg.url, tag: `social-${tipo}`, exceto: [...p.autores] });
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
  const feitos = await banco.tudo("SELECT chave, enviado_em, para, entregues FROM push_enviados WHERE chave LIKE 'agenda:%'");
  const mapa = new Map(feitos.map((f) => [f.chave.slice(7), f]));
  const nomes = { vespera: 'Lembrete da véspera', contribuicoes: 'O que falta nas Contribuições', faltam2h: 'Faltam 2 horas',
    portoes: 'Portões abertos', 'campeao-pos': 'Campeão do pós' };
  return lista.map((a) => {
    const f = mapa.get(a.chave);
    return { chave: a.chave, nome: nomes[a.chave], quando: a.quando, enviado: Boolean(f), enviadoEm: f ? Number(f.enviado_em) : null,
      para: f ? Number(f.para) : 0, entregues: f ? Number(f.entregues) : 0 };
  });
}

// ------------------------------------------------------------------ relógio
let timer = null;
async function tic(agora = Date.now()) {
  await verificarAgendados(agora);
  await despacharSociais(agora);
}
function iniciar() {
  if (timer || process.env.PUSH_FALSO === '1') return;
  prepararChaves().catch((e) => console.error('[push] chaves:', e.message));
  timer = setInterval(() => tic().catch((e) => console.error('[push]', e.message)), 30 * 1000);
  timer.unref();
}
function parar() { clearInterval(timer); timer = null; }

module.exports = {
  chavePublica, inscrever, desinscrever, removerDoConvidado, estaInscrito, resumo,
  enviar, enviarPara, historico, programados, evento, despacharSociais, verificarAgendados,
  atividadeLiberada, tic, iniciar, parar, enderecoPermitido, caixa,
  _zerarSociais: () => { pendentes.clear(); ultimoEnvio.clear(); },
};
