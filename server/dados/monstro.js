// O Monstro está entre nós: jogo de papéis secretos em rodadas.
//
// VILA: só joga quem tocou em "Quero entrar na vila" (vale para todas as rodadas; sai entre rodadas).
// RODADA (o organizador comanda pelo admin):
//   aberta (inscrições) → jogando (monstros sorteados em segredo) → votacao → revelada → nova rodada…
// MONSTRO: missão de brindar com MISSAO pessoas da vila. Ele mesmo marca no celular com quem brindou
//   (a vítima NÃO é avisada, senão descobriria na hora).
// PISTAS: o organizador escreve ou escolhe uma pronta e manda ao telão. Nenhuma sai sozinha.
// PONTOS (na revelação): +1000 para quem votou num monstro; monstro não descoberto (não foi o mais
//   votado) +1000 e +100 por vítima.
// SEGREDO: ninguém além do próprio monstro (e do organizador) sabe quem é monstro antes da revelação.
//   Pessoas aparecem para os outros por um apelido opaco, nunca pelo id interno.
// MODO TESTE: com a atividade "Em teste", só testadores entram; tudo fica marcado e some no
//   "Apagar dados de teste".

const crypto = require('crypto');
const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const pontos = require('./pontos');
const convidados = require('./convidados');
const { ErroValidacao, limparTexto } = convidados;
const { AVATARES } = require('../avatares');

const MISSAO = 5;
const PONTOS_ACERTO = 1000;
const PONTOS_ESCAPOU = 1000;
const PONTOS_POR_VITIMA = 100;
const MIN_VILA = 3;

const apelido = (id) => `v${crypto.createHash('sha256').update(`pv-monstro:${id}`).digest('hex').slice(0, 12)}`;
const iniciais = (nome) => nome.trim().split(/\s+/).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
const emojiDe = (id) => (AVATARES.find((a) => a.id === id) || {}).emoji || '❔';

function sugestao(n) {
  if (n <= 12) return 1;
  if (n <= 25) return 2;
  return 3;
}
const maximo = (n) => Math.max(1, Math.floor((n - 1) / 2));

async function config() {
  return { rodada: 0, estado: 'aberta', teste: false, ...((await festa.ler('monstro')) || {}) };
}

async function vila() {
  return banco.tudo(`SELECT c.id, c.nome, c.avatar FROM monstro_vila v JOIN convidados c ON c.id = v.convidado_id AND c.ativo = 1
    ORDER BY v.entrou_em`);
}
async function monstrosDa(rodada) {
  return banco.tudo(`SELECT c.id, c.nome, c.avatar FROM monstro_papeis p JOIN convidados c ON c.id = p.convidado_id
    WHERE p.rodada = ? ORDER BY c.nome COLLATE NOCASE`, [rodada]);
}
async function brindesDa(rodada) {
  return banco.tudo(`SELECT b.monstro_id, b.vitima_id, c.nome AS vitima FROM monstro_brindes b JOIN convidados c ON c.id = b.vitima_id
    WHERE b.rodada = ? ORDER BY b.em`, [rodada]);
}
async function pistasDa(rodada) {
  const l = await banco.tudo('SELECT texto, em FROM monstro_pistas WHERE rodada = ? ORDER BY em DESC, id DESC', [rodada]);
  return l.map((x) => ({ texto: x.texto, em: Number(x.em) }));
}
async function votosDa(rodada) {
  return banco.tudo('SELECT eleitor_id, suspeito_id FROM monstro_votos WHERE rodada = ?', [rodada]);
}

// Resultado da rodada (contagem e quem acertou). Usado na revelação, no telão e no celular.
async function resultado(rodada) {
  const [monstros, brindes, votos, pessoas] = await Promise.all([monstrosDa(rodada), brindesDa(rodada), votosDa(rodada), vila()]);
  const ids = new Set(monstros.map((m) => m.id));
  const contagem = new Map();
  for (const v of votos) contagem.set(v.suspeito_id, (contagem.get(v.suspeito_id) || 0) + 1);
  const maisVotos = Math.max(0, ...contagem.values());
  const lista = monstros.map((m) => {
    const votosM = contagem.get(m.id) || 0;
    const almas = brindes.filter((b) => b.monstro_id === m.id);
    return { id: m.id, nome: m.nome, avatar: m.avatar, votos: votosM, almas: almas.length, vitimas: almas.map((a) => a.vitima),
      descoberto: maisVotos > 0 && votosM === maisVotos };
  });
  const acertaram = votos.filter((v) => ids.has(v.suspeito_id)).map((v) => v.eleitor_id);
  const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
  return { monstros: lista, acertaram, acertaramNomes: acertaram.map((id) => nomes.get(id)).filter(Boolean), votaram: votos.length };
}

// ------------------------------------------------------------------ convidado
async function paraConvidado(eu) {
  const [cfg, pessoas] = await Promise.all([config(), vila()]);
  const naVila = pessoas.some((p) => p.id === eu);
  const saida = { estado: cfg.estado, rodada: cfg.rodada, naVila, naVilaTotal: pessoas.length, missao: MISSAO,
    premios: { acerto: PONTOS_ACERTO, escapou: PONTOS_ESCAPOU, porVitima: PONTOS_POR_VITIMA } };
  if (!cfg.rodada || cfg.estado === 'aberta') return saida;
  const [monstros, pistas] = await Promise.all([monstrosDa(cfg.rodada), pistasDa(cfg.rodada)]);
  const souMonstro = monstros.some((m) => m.id === eu);
  const ids = new Set(monstros.map((m) => m.id));
  saida.qtdMonstros = monstros.length;
  saida.pistas = pistas;
  saida.jogo = naVila || souMonstro;
  if (cfg.estado === 'jogando' || cfg.estado === 'votacao') {
    saida.souMonstro = souMonstro;
    if (souMonstro) {
      const meus = (await brindesDa(cfg.rodada)).filter((b) => b.monstro_id === eu);
      saida.comparsas = monstros.filter((m) => m.id !== eu).map((m) => m.nome);
      saida.vitimas = meus.map((b) => ({ id: apelido(b.vitima_id), nome: b.vitima }));
      // Vítimas possíveis: gente da vila que não é monstro.
      saida.alvos = pessoas.filter((p) => !ids.has(p.id)).map((p) => ({ id: apelido(p.id), nome: p.nome, avatar: p.avatar }));
    }
  }
  if (cfg.estado === 'votacao') {
    const meu = await banco.um('SELECT suspeito_id FROM monstro_votos WHERE rodada = ? AND eleitor_id = ?', [cfg.rodada, eu]);
    saida.meuVoto = meu ? apelido(meu.suspeito_id) : null;
    saida.suspeitos = pessoas.filter((p) => p.id !== eu).map((p) => ({ id: apelido(p.id), nome: p.nome, avatar: p.avatar }));
  }
  if (cfg.estado === 'revelada') {
    const r = await resultado(cfg.rodada);
    const meuVoto = await banco.um('SELECT suspeito_id FROM monstro_votos WHERE rodada = ? AND eleitor_id = ?', [cfg.rodada, eu]);
    const eraEu = r.monstros.find((m) => m.id === eu);
    saida.resultado = {
      monstros: r.monstros.map((m) => ({ nome: m.nome, avatar: m.avatar, almas: m.almas, votos: m.votos, descoberto: m.descoberto })),
      acertei: r.acertaram.includes(eu), voteiEm: meuVoto ? (pessoas.find((p) => p.id === meuVoto.suspeito_id) || {}).nome || null : null,
      eraMonstro: Boolean(eraEu), escapei: Boolean(eraEu && !eraEu.descoberto), acertaram: r.acertaram.length,
    };
  }
  return saida;
}

async function entrar(eu, quer, agora = Date.now()) {
  const { liberada, teste } = await atividades.acesso('monstro', eu, agora);
  if (!liberada) throw new ErroValidacao('O Monstro ainda não está aberto.', 403);
  const cfg = await config();
  if (quer) {
    await banco.rodar('INSERT OR IGNORE INTO monstro_vila (convidado_id, entrou_em, teste) VALUES (?, ?, ?)', [eu.id, agora, teste ? 1 : 0]);
    return;
  }
  if (cfg.estado === 'jogando' || cfg.estado === 'votacao') {
    throw new ErroValidacao('A rodada está acontecendo: você pode sair da vila quando ela terminar.', 409);
  }
  await banco.rodar('DELETE FROM monstro_vila WHERE convidado_id = ?', [eu.id]);
}

async function exigirRodada(eu, estado, agora) {
  const { liberada } = await atividades.acesso('monstro', eu, agora);
  if (!liberada) throw new ErroValidacao('O Monstro ainda não está aberto.', 403);
  const cfg = await config();
  if (cfg.estado !== estado) {
    throw new ErroValidacao(estado === 'votacao' ? 'A votação não está aberta.' : 'Não há rodada acontecendo agora.', 409);
  }
  return cfg;
}

// O monstro marca com quem brindou (ou desmarca, se tocou errado).
async function brindar(eu, vitimaApelido, marcar = true, agora = Date.now()) {
  const cfg = await exigirRodada(eu, 'jogando', agora);
  const monstros = await monstrosDa(cfg.rodada);
  if (!monstros.some((m) => m.id === eu.id)) throw new ErroValidacao('Só os monstros marcam brindes.', 403);
  const ids = new Set(monstros.map((m) => m.id));
  const alvo = (await vila()).find((p) => apelido(p.id) === String(vitimaApelido) && !ids.has(p.id));
  if (!alvo) throw new ErroValidacao('Escolha alguém da vila.');
  if (marcar) {
    await banco.rodar('INSERT OR IGNORE INTO monstro_brindes (rodada, monstro_id, vitima_id, em, teste) VALUES (?, ?, ?, ?, ?)',
      [cfg.rodada, eu.id, alvo.id, agora, cfg.teste ? 1 : 0]);
  } else {
    await banco.rodar('DELETE FROM monstro_brindes WHERE rodada = ? AND monstro_id = ? AND vitima_id = ?', [cfg.rodada, eu.id, alvo.id]);
  }
}

async function votar(eu, suspeitoApelido, agora = Date.now()) {
  const cfg = await exigirRodada(eu, 'votacao', agora);
  const pessoas = await vila();
  if (!pessoas.some((p) => p.id === eu.id)) throw new ErroValidacao('Só quem está na vila vota.', 403);
  const alvo = pessoas.find((p) => apelido(p.id) === String(suspeitoApelido));
  if (!alvo) throw new ErroValidacao('Escolha alguém da vila.');
  if (alvo.id === eu.id) throw new ErroValidacao('Não vale votar em você mesmo. 😉');
  await banco.rodar(
    `INSERT INTO monstro_votos (rodada, eleitor_id, suspeito_id, em, teste) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(rodada, eleitor_id) DO UPDATE SET suspeito_id = excluded.suspeito_id, em = excluded.em`,
    [cfg.rodada, eu.id, alvo.id, agora, cfg.teste ? 1 : 0]);
}

// ------------------------------------------------------------------ admin
function pistasProntas(monstros, brindes) {
  const prontas = [];
  const almas = brindes.length;
  const um = monstros.length === 1;
  const quem = um ? 'O monstro' : 'Um dos monstros';
  if (um) prontas.push(almas ? `O monstro já pegou ${almas} ${almas === 1 ? 'alma' : 'almas'}.` : 'O monstro ainda não pegou ninguém… ou está bem escondido.');
  else prontas.push(almas ? `Os monstros já pegaram ${almas} ${almas === 1 ? 'alma' : 'almas'}.` : 'Os monstros ainda não pegaram ninguém… ou estão bem escondidos.');
  for (const m of monstros) {
    const a = AVATARES.find((x) => x.id === m.avatar);
    if (a) prontas.push(`${quem} escolheu o avatar ${a.emoji} ${a.nome}.`);
    prontas.push(`O nome ${um ? 'do monstro' : 'de um dos monstros'} começa com a letra ${m.nome.trim()[0].toUpperCase()}.`);
  }
  if (monstros.length > 1) prontas.push(`Há ${monstros.length} monstros entre vocês, e eles se conhecem.`);
  return [...new Set(prontas)];
}

async function paraAdmin(agora = Date.now()) {
  const [cfg, uso, pessoas] = await Promise.all([config(), atividades.emUso('monstro', agora), vila()]);
  const saida = { ...cfg, liberada: uso.ativa, emTeste: uso.teste, missao: MISSAO, minVila: MIN_VILA,
    vila: pessoas.map((p) => ({ id: p.id, nome: p.nome, avatar: p.avatar })),
    sugestao: sugestao(pessoas.length), maximo: maximo(pessoas.length) };
  if (cfg.rodada && cfg.estado !== 'aberta') {
    const [monstros, brindes, pistas, votos] = await Promise.all([monstrosDa(cfg.rodada), brindesDa(cfg.rodada), pistasDa(cfg.rodada), votosDa(cfg.rodada)]);
    const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
    const contagem = new Map();
    for (const v of votos) contagem.set(v.suspeito_id, (contagem.get(v.suspeito_id) || 0) + 1);
    saida.monstros = monstros.map((m) => ({ nome: m.nome, avatar: m.avatar, vitimas: brindes.filter((b) => b.monstro_id === m.id).map((b) => b.vitima) }));
    saida.pistas = pistas;
    saida.prontas = cfg.estado === 'jogando' || cfg.estado === 'votacao' ? pistasProntas(monstros, brindes) : [];
    saida.votaram = votos.length;
    saida.contagem = [...contagem.entries()].map(([id, n]) => ({ nome: nomes.get(id) || '?', votos: n })).sort((a, b) => b.votos - a.votos);
  }
  if (cfg.estado === 'revelada') saida.resultado = await resultado(cfg.rodada);
  return saida;
}

async function iniciar(qtd, agora = Date.now()) {
  const uso = await atividades.emUso('monstro', agora);
  if (!uso.ativa) throw new ErroValidacao('Libere O Monstro (ou coloque "Em teste") na aba Atividades antes de começar.', 409);
  const cfg = await config();
  if (cfg.estado === 'jogando' || cfg.estado === 'votacao') throw new ErroValidacao('Já tem uma rodada acontecendo.', 409);
  const pessoas = await vila();
  if (pessoas.length < MIN_VILA) throw new ErroValidacao(`Precisa de pelo menos ${MIN_VILA} pessoas na vila para começar.`, 409);
  const n = Number(qtd) || sugestao(pessoas.length);
  if (!Number.isInteger(n) || n < 1 || n > maximo(pessoas.length)) {
    throw new ErroValidacao(`Com ${pessoas.length} na vila, dá para ter de 1 a ${maximo(pessoas.length)} monstros.`);
  }
  // Sorteio justo: embaralha a vila inteira e pega os primeiros.
  const ordem = [...pessoas];
  for (let i = ordem.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [ordem[i], ordem[j]] = [ordem[j], ordem[i]]; }
  const rodada = cfg.rodada + 1;
  const teste = uso.teste;
  await banco.lote(ordem.slice(0, n).map((p) => ({
    sql: 'INSERT INTO monstro_papeis (rodada, convidado_id, teste) VALUES (?, ?, ?)', args: [rodada, p.id, teste ? 1 : 0] })));
  await festa.gravar('monstro', { rodada, estado: 'jogando', inicioEm: agora, teste });
  await festa.definirTelao({ modo: 'monstro' });
  return { rodada, monstros: n, vila: pessoas.map((p) => p.id) };
}

async function mandarPista(texto, agora = Date.now()) {
  const cfg = await config();
  if (cfg.estado !== 'jogando' && cfg.estado !== 'votacao') throw new ErroValidacao('Não há rodada acontecendo.', 409);
  const t = limparTexto(texto, 140);
  if (t.length < 3) throw new ErroValidacao('Escreva a pista.');
  await banco.rodar('INSERT INTO monstro_pistas (rodada, texto, em, teste) VALUES (?, ?, ?, ?)', [cfg.rodada, t, agora, cfg.teste ? 1 : 0]);
}

async function abrirVotacao() {
  const cfg = await config();
  if (cfg.estado !== 'jogando') throw new ErroValidacao('A rodada não está acontecendo.', 409);
  await festa.gravar('monstro', { ...cfg, estado: 'votacao' });
  await festa.definirTelao({ modo: 'monstro' });
  return { vila: (await vila()).map((p) => p.id) };
}

async function revelar() {
  const cfg = await config();
  if (cfg.estado !== 'votacao') throw new ErroValidacao('Abra a votação antes de revelar.', 409);
  const r = await resultado(cfg.rodada);
  const teste = cfg.teste || (await atividades.emTeste('monstro'));
  await banco.transacao(async (tx) => {
    for (const id of r.acertaram) {
      await pontos.conceder({ convidadoId: id, atividade: 'monstro', pontos: PONTOS_ACERTO,
        motivo: `O Monstro (rodada ${cfg.rodada}): descobriu um monstro`, chave: `monstro:${cfg.rodada}:acerto:${id}`, teste }, tx);
    }
    for (const m of r.monstros.filter((x) => !x.descoberto)) {
      const total = PONTOS_ESCAPOU + PONTOS_POR_VITIMA * m.almas;
      await pontos.conceder({ convidadoId: m.id, atividade: 'monstro', pontos: total,
        motivo: `O Monstro (rodada ${cfg.rodada}): escapou com ${m.almas} ${m.almas === 1 ? 'alma' : 'almas'}`, chave: `monstro:${cfg.rodada}:escapou:${m.id}`, teste }, tx);
    }
  });
  await festa.gravar('monstro', { ...cfg, estado: 'revelada', reveladaEm: Date.now() });
  await festa.definirTelao({ modo: 'monstro' });
  return { acertaram: r.acertaram.length, escaparam: r.monstros.filter((x) => !x.descoberto).length };
}

// Volta para as inscrições (a vila continua) para começar outra rodada.
async function novaRodada() {
  const cfg = await config();
  if (cfg.estado === 'jogando' || cfg.estado === 'votacao') throw new ErroValidacao('Revele a rodada atual antes.', 409);
  await festa.gravar('monstro', { ...cfg, estado: 'aberta' });
}

// Cancela a rodada atual sem dar pontos (ex.: começou sem querer).
async function cancelarRodada() {
  const cfg = await config();
  if (cfg.estado !== 'jogando' && cfg.estado !== 'votacao') throw new ErroValidacao('Não há rodada para cancelar.', 409);
  const r = cfg.rodada;
  await banco.lote([
    { sql: 'DELETE FROM monstro_papeis WHERE rodada = ?', args: [r] },
    { sql: 'DELETE FROM monstro_brindes WHERE rodada = ?', args: [r] },
    { sql: 'DELETE FROM monstro_votos WHERE rodada = ?', args: [r] },
    { sql: 'DELETE FROM monstro_pistas WHERE rodada = ?', args: [r] },
  ]);
  await festa.gravar('monstro', { ...cfg, rodada: r - 1, estado: 'aberta' });
}

async function tirarDaVila(id) {
  const cfg = await config();
  if (cfg.estado === 'jogando' || cfg.estado === 'votacao') throw new ErroValidacao('Espere a rodada terminar para tirar alguém da vila.', 409);
  await banco.rodar('DELETE FROM monstro_vila WHERE convidado_id = ?', [String(id)]);
}

// ------------------------------------------------------------------ telão
async function paraTelao() {
  const [cfg, pessoas] = await Promise.all([config(), vila()]);
  const saida = { estado: cfg.estado, rodada: cfg.rodada, missao: MISSAO,
    vila: pessoas.map((p) => ({ avatar: p.avatar, iniciais: iniciais(p.nome) })) };
  if (!cfg.rodada || cfg.estado === 'aberta') return saida;
  const [monstros, brindes, pistas] = await Promise.all([monstrosDa(cfg.rodada), brindesDa(cfg.rodada), pistasDa(cfg.rodada)]);
  saida.qtdMonstros = monstros.length;
  saida.almas = brindes.length;
  saida.pistas = pistas.slice(0, 4);
  if (cfg.estado === 'votacao' || cfg.estado === 'revelada') {
    const votos = await banco.tudo('SELECT c.nome, c.avatar FROM monstro_votos v JOIN convidados c ON c.id = v.eleitor_id WHERE v.rodada = ? ORDER BY v.em', [cfg.rodada]);
    saida.eleitores = votos.map((v) => ({ avatar: v.avatar, iniciais: iniciais(v.nome) }));
  }
  if (cfg.estado === 'revelada') {
    const r = await resultado(cfg.rodada);
    saida.resultado = { monstros: r.monstros.map((m) => ({ nome: m.nome, avatar: m.avatar, almas: m.almas, votos: m.votos, descoberto: m.descoberto })),
      acertaram: r.acertaram.length, acertaramNomes: r.acertaramNomes.slice(0, 12), votaram: r.votaram };
  }
  return saida;
}

module.exports = { config, vila, paraConvidado, entrar, brindar, votar, paraAdmin, iniciar, mandarPista, abrirVotacao, revelar, novaRodada,
  cancelarRodada, tirarDaVila, paraTelao, apelido, sugestao, emojiDe, MISSAO, PONTOS_ACERTO, PONTOS_ESCAPOU, PONTOS_POR_VITIMA };
