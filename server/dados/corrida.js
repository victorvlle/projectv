// Corrida de Cavalos (jogo de sorte com baralho).
//
// REGRAS: os 4 Ases (♠ ♥ ♦ ♣) são os cavalos. Ao lado da pista ficam 7 cartas viradas (uma por casa).
// O telão vira uma carta do baralho por vez: o cavalo daquele naipe anda uma casa. Quando TODOS os
// cavalos passam de uma casa, a carta lateral daquela casa vira e o cavalo do naipe dela VOLTA uma casa.
// Ganha quem passar da última casa primeiro.
//
// APOSTA: cada convidado escolhe um naipe no celular enquanto as apostas estão abertas (pode trocar).
// FLUXO (admin): abrir apostas → largar (sorteia a corrida inteira de uma vez, no servidor) → o telão
// anima no relógio do servidor (todo telão vê a mesma corrida) → fim: pontos automáticos.
// PRÊMIOS: quem apostou no 1º colocado +500; no 2º +200; quem apostou no último toma um shot.
// MODO TESTE: com a atividade "Em teste", só testadores apostam; tudo marcado e apagável.

const crypto = require('crypto');
const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const pontos = require('./pontos');
const { ErroValidacao } = require('./convidados');

const NAIPES = ['espadas', 'copas', 'ouros', 'paus'];
const SIMBOLO = { espadas: '♠', copas: '♥', ouros: '♦', paus: '♣' };
const VALORES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CASAS = 7; // cartas laterais; a chegada é a casa 8
const CHEGADA = CASAS + 1;
const PREPARO_MS = 5000; // "3, 2, 1… largada!"
const PASSO_MS = 1400; // uma carta a cada 1,4 s
const PREMIOS = [500, 200];
const iniciais = (nome) => nome.trim().split(/\s+/).slice(0, 2).map((x) => x[0].toUpperCase()).join('');

function embaralhar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Sorteia a corrida inteira. Devolve as cartas laterais, os eventos (na ordem) e a classificação.
function simular() {
  const baralho = embaralhar(NAIPES.flatMap((n) => VALORES.map((v) => ({ naipe: n, valor: v }))));
  const laterais = baralho.splice(0, CASAS);
  const pos = { espadas: 0, copas: 0, ouros: 0, paus: 0 };
  const chegouEm = { espadas: 0, copas: 0, ouros: 0, paus: 0 }; // evento em que chegou à posição atual
  const reveladas = new Set();
  const eventos = [];
  let pilha = baralho;
  let descarte = [];
  let vencedor = null;
  for (let guarda = 0; guarda < 400 && !vencedor; guarda++) {
    if (!pilha.length) { pilha = embaralhar(descarte); descarte = []; }
    const carta = pilha.shift();
    descarte.push(carta);
    pos[carta.naipe] += 1;
    chegouEm[carta.naipe] = eventos.length;
    eventos.push({ tipo: 'anda', naipe: carta.naipe, valor: carta.valor });
    if (pos[carta.naipe] >= CHEGADA) { vencedor = carta.naipe; break; }
    // Todos passaram da casa i: a lateral vira e o cavalo daquele naipe volta uma.
    let mudou = true;
    while (mudou) {
      mudou = false;
      const minimo = Math.min(...NAIPES.map((n) => pos[n]));
      for (let i = 1; i <= CASAS; i++) {
        if (reveladas.has(i) || minimo < i) continue;
        reveladas.add(i);
        const l = laterais[i - 1];
        if (pos[l.naipe] > 0) { pos[l.naipe] -= 1; chegouEm[l.naipe] = eventos.length; }
        eventos.push({ tipo: 'volta', casa: i, naipe: l.naipe, valor: l.valor });
        mudou = true;
        break;
      }
    }
  }
  // Classificação: mais longe primeiro; empate na casa, quem chegou nela antes.
  const ordem = [...NAIPES].sort((a, b) => (pos[b] - pos[a]) || (chegouEm[a] - chegouEm[b]));
  if (vencedor) { ordem.splice(ordem.indexOf(vencedor), 1); ordem.unshift(vencedor); }
  const minimo = Math.min(...NAIPES.map((n) => pos[n]));
  const ultimos = NAIPES.filter((n) => pos[n] === minimo && n !== ordem[0]);
  return { laterais, eventos, ordem, ultimos, final: pos };
}

async function config() {
  return { rodada: 0, estado: 'fechada', teste: false, ...((await festa.ler('corrida')) || {}) };
}
const fimDa = (cfg) => cfg.inicioEm + PREPARO_MS + cfg.eventos.length * PASSO_MS + 1500;

async function apostasDa(rodada) {
  return banco.tudo(`SELECT a.convidado_id AS id, a.naipe, c.nome, c.avatar FROM corrida_apostas a
    JOIN convidados c ON c.id = a.convidado_id WHERE a.rodada = ? ORDER BY a.em`, [rodada]);
}

// Terminou a animação? Fecha a corrida e dá os pontos (idempotente: chamado em leituras e no agendador).
async function sincronizar(agora = Date.now()) {
  const cfg = await config();
  if (cfg.estado !== 'correndo' || agora < fimDa(cfg)) return false;
  const apostas = await apostasDa(cfg.rodada);
  await banco.transacao(async (tx) => {
    for (const [k, naipe] of cfg.ordem.slice(0, PREMIOS.length).entries()) {
      for (const a of apostas.filter((x) => x.naipe === naipe)) {
        await pontos.conceder({ convidadoId: a.id, atividade: 'corrida', pontos: PREMIOS[k],
          motivo: `Corrida de Cavalos ${cfg.rodada}: apostou no ${k + 1}º lugar (${SIMBOLO[naipe]})`,
          chave: `corrida:${cfg.rodada}:${a.id}`, teste: cfg.teste }, tx);
      }
    }
  });
  const atual = await config();
  if (atual.estado === 'correndo' && atual.rodada === cfg.rodada) await festa.gravar('corrida', { ...atual, estado: 'fim' });
  return true;
}

function publico(cfg, agora) {
  // Durante a corrida e depois dela, o roteiro inteiro pode ir para as telas: as apostas já fecharam.
  if (cfg.estado !== 'correndo' && cfg.estado !== 'fim') return {};
  return { inicioEm: cfg.inicioEm, preparoMs: PREPARO_MS, passoMs: PASSO_MS, eventos: cfg.eventos, laterais: cfg.laterais.map((l) => l.naipe),
    lateraisValor: cfg.laterais.map((l) => l.valor), fimEm: fimDa(cfg), agora,
    ...(cfg.estado === 'fim' ? { ordem: cfg.ordem, ultimos: cfg.ultimos } : {}) };
}

// ------------------------------------------------------------------ convidado
async function paraConvidado(eu, agora = Date.now()) {
  await sincronizar(agora);
  const cfg = await config();
  const apostas = cfg.rodada ? await apostasDa(cfg.rodada) : [];
  const minha = apostas.find((a) => a.id === eu);
  const saida = { estado: cfg.estado, rodada: cfg.rodada, minha: minha ? minha.naipe : null, premios: PREMIOS,
    contagem: Object.fromEntries(NAIPES.map((n) => [n, apostas.filter((a) => a.naipe === n).length])) };
  if (cfg.estado === 'correndo') saida.fimEm = fimDa(cfg);
  if (cfg.estado === 'fim') {
    const lugar = minha ? cfg.ordem.indexOf(minha.naipe) + 1 : null;
    saida.resultado = { ordem: cfg.ordem, ultimos: cfg.ultimos, lugar, pontos: lugar && lugar <= PREMIOS.length ? PREMIOS[lugar - 1] : 0,
      shot: Boolean(minha && cfg.ultimos.includes(minha.naipe)) };
  }
  return saida;
}

async function apostar(eu, naipe, agora = Date.now()) {
  const { liberada } = await atividades.acesso('corrida', eu, agora);
  if (!liberada) throw new ErroValidacao('A Corrida de Cavalos ainda não está aberta.', 403);
  if (!NAIPES.includes(naipe)) throw new ErroValidacao('Escolha um dos quatro cavalos.');
  const cfg = await config();
  if (cfg.estado !== 'apostas') throw new ErroValidacao(cfg.estado === 'correndo' ? 'A corrida já largou!' : 'As apostas não estão abertas.', 409);
  await banco.rodar(
    `INSERT INTO corrida_apostas (rodada, convidado_id, naipe, em, teste) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(rodada, convidado_id) DO UPDATE SET naipe = excluded.naipe, em = excluded.em`,
    [cfg.rodada, eu.id, naipe, agora, cfg.teste ? 1 : 0]);
}

// ------------------------------------------------------------------ admin
async function paraAdmin(agora = Date.now()) {
  await sincronizar(agora);
  const [cfg, uso] = await Promise.all([config(), atividades.emUso('corrida', agora)]);
  const apostas = cfg.rodada ? await apostasDa(cfg.rodada) : [];
  return { estado: cfg.estado, rodada: cfg.rodada, liberada: uso.ativa, emTeste: uso.teste, premios: PREMIOS,
    apostas: NAIPES.map((n) => ({ naipe: n, simbolo: SIMBOLO[n], pessoas: apostas.filter((a) => a.naipe === n).map((a) => a.nome) })),
    total: apostas.length, ...(cfg.estado === 'correndo' ? { fimEm: fimDa(cfg) } : {}),
    ...(cfg.estado === 'fim' ? { ordem: cfg.ordem, ultimos: cfg.ultimos } : {}) };
}

async function abrirApostas(agora = Date.now()) {
  const uso = await atividades.emUso('corrida', agora);
  if (!uso.ativa) throw new ErroValidacao('Libere a Corrida (ou coloque "Em teste") na aba Atividades antes.', 409);
  const cfg = await config();
  if (cfg.estado === 'apostas') return;
  if (cfg.estado === 'correndo') throw new ErroValidacao('Espere a corrida terminar.', 409);
  await festa.gravar('corrida', { rodada: cfg.rodada + 1, estado: 'apostas', teste: uso.teste });
  await festa.definirTelao({ modo: 'corrida' });
}

async function largar(agora = Date.now()) {
  const cfg = await config();
  if (cfg.estado !== 'apostas') throw new ErroValidacao('Abra as apostas antes de largar.', 409);
  if (!(await apostasDa(cfg.rodada)).length) throw new ErroValidacao('Ninguém apostou ainda.', 409);
  const s = simular();
  await festa.gravar('corrida', { ...cfg, estado: 'correndo', inicioEm: agora, laterais: s.laterais, eventos: s.eventos, ordem: s.ordem, ultimos: s.ultimos });
  await festa.definirTelao({ modo: 'corrida' });
}

async function cancelar() {
  const cfg = await config();
  if (cfg.estado !== 'apostas' && cfg.estado !== 'correndo') throw new ErroValidacao('Não há corrida para cancelar.', 409);
  await banco.rodar('DELETE FROM corrida_apostas WHERE rodada = ?', [cfg.rodada]);
  await festa.gravar('corrida', { rodada: cfg.rodada - 1, estado: 'fechada', teste: false });
}

// ------------------------------------------------------------------ telão
async function paraTelao(agora = Date.now()) {
  await sincronizar(agora);
  const cfg = await config();
  const apostas = cfg.rodada ? await apostasDa(cfg.rodada) : [];
  const ganhadores = cfg.estado === 'fim' ? apostas.filter((a) => a.naipe === cfg.ordem[0]).map((a) => a.nome) : [];
  const shot = cfg.estado === 'fim' ? apostas.filter((a) => cfg.ultimos.includes(a.naipe)).map((a) => a.nome) : [];
  return { estado: cfg.estado, rodada: cfg.rodada, premios: PREMIOS, casas: CASAS,
    apostas: Object.fromEntries(NAIPES.map((n) => [n, apostas.filter((a) => a.naipe === n).map((a) => ({ avatar: a.avatar, iniciais: iniciais(a.nome) }))])),
    total: apostas.length, ganhadores, shot, ...publico(cfg, agora) };
}

module.exports = { NAIPES, SIMBOLO, CASAS, CHEGADA, PREMIOS, PREPARO_MS, PASSO_MS, simular, config, sincronizar, paraConvidado, apostar,
  paraAdmin, abrirApostas, largar, cancelar, paraTelao };
