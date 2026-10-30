// Corrida de Cavalos (jogo de sorte com baralho).
//
// REGRAS: os 4 Ases (♠ ♥ ♦ ♣) são os cavalos. Ao lado da pista ficam 10 cartas viradas (uma por casa).
// O telão vira uma carta do baralho por vez: o cavalo daquele naipe anda uma casa. Quando TODOS os
// cavalos passam de uma casa, a carta lateral daquela casa vira e o cavalo do naipe dela VOLTA uma casa.
// Ganha quem passar da última casa primeiro.
//
// APOSTA: as apostas ficam abertas por 1 minuto. Cada convidado escolhe um naipe e SALVA a escolha
// (fica confirmado no jogo; depois de salvar não troca).
// FLUXO: abrir apostas (admin) → 1 minuto → largada automática (ou "Largar agora") → a corrida inteira é
// sorteada de uma vez no servidor e o telão anima no relógio do servidor (todo telão vê a mesma corrida).
// ANIMAÇÃO: cada carta tem o seu tempo (ver DURACAO): a carta sorteada aparece grande no meio, vai para
// o canto e só então o cavalo anda; a carta lateral que vira sobe para o meio, desvira, volta ao lugar
// e só então o cavalo daquele naipe volta uma casa.
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
const CASAS = 10; // cartas laterais; a chegada é a casa 11
const CHEGADA = CASAS + 1;
const PREPARO_MS = 5000; // "3, 2, 1… largada!"
const APOSTAS_MS = 60 * 1000; // tempo para escolher o cavalo
// Tempo de cada carta no telão (ms): sorteio no meio → canto → cavalo anda; lateral sobe → desvira → volta → cavalo volta.
const DURACAO = { anda: 3000, volta: 3600 };
const PASSO_MS = DURACAO.anda; // (compatibilidade)
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
  // Linha do tempo: quando cada carta começa (ms depois da largada).
  let t = 0;
  for (const e of eventos) { e.t = t; t += DURACAO[e.tipo]; }
  return { laterais, eventos, ordem, ultimos, final: pos, duracao: t };
}

async function config() {
  return { rodada: 0, estado: 'fechada', teste: false, ...((await festa.ler('corrida')) || {}) };
}
const duracaoDe = (cfg) => { const u = cfg.eventos[cfg.eventos.length - 1]; return u ? u.t + DURACAO[u.tipo] : 0; };
const fimDa = (cfg) => cfg.inicioEm + PREPARO_MS + duracaoDe(cfg) + 1500;

// Grava só se ninguém mudou a config no meio (duas largadas automáticas ao mesmo tempo viram uma).
async function trocarConfig(antigo, novo) {
  const r = await banco.rodar("UPDATE config SET valor = ? WHERE chave = 'corrida' AND valor = ?", [JSON.stringify(novo), JSON.stringify(antigo)]);
  return Boolean(r.rowsAffected);
}

async function apostasDa(rodada) {
  return banco.tudo(`SELECT a.convidado_id AS id, a.naipe, c.nome, c.avatar FROM corrida_apostas a
    JOIN convidados c ON c.id = a.convidado_id WHERE a.rodada = ? ORDER BY a.em`, [rodada]);
}

// Terminou a animação? Fecha a corrida e dá os pontos (idempotente: chamado em leituras e no agendador).
const relogioJogo = (agora) => require('./pausa').relogio(agora);

async function sincronizar(agoraReal = Date.now()) {
  const agora = await relogioJogo(agoraReal); // parado enquanto a Maldição pausa os jogos
  // Fim do minuto de apostas: larga sozinho (ou fecha, se ninguém apostou).
  const bruto = await festa.ler('corrida');
  if (bruto && bruto.estado === 'apostas' && bruto.fechaEm && agora >= bruto.fechaEm) {
    const temAposta = (await apostasDa(bruto.rodada)).length > 0;
    const novo = temAposta ? montarLargada(bruto, bruto.fechaEm) : { ...bruto, estado: 'fechada', semApostas: true };
    if (await trocarConfig(bruto, novo)) return true;
  }
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
  return { inicioEm: cfg.inicioEm, preparoMs: PREPARO_MS, duracao: DURACAO, eventos: cfg.eventos, laterais: cfg.laterais.map((l) => l.naipe),
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
  if (cfg.estado === 'apostas') saida.fechaEm = cfg.fechaEm;
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
  await sincronizar(agora);
  const cfg = await config();
  if (cfg.estado !== 'apostas' || (cfg.fechaEm && agora >= cfg.fechaEm)) {
    throw new ErroValidacao(cfg.estado === 'correndo' ? 'A corrida já largou!' : 'As apostas não estão abertas.', 409);
  }
  // Salvou, está confirmado: não troca mais.
  const r = await banco.rodar('INSERT OR IGNORE INTO corrida_apostas (rodada, convidado_id, naipe, em, teste) VALUES (?, ?, ?, ?, ?)',
    [cfg.rodada, eu.id, naipe, agora, cfg.teste ? 1 : 0]);
  if (!r.rowsAffected) throw new ErroValidacao('Você já confirmou o seu cavalo nesta corrida.', 409);
}

// ------------------------------------------------------------------ admin
async function paraAdmin(agora = Date.now()) {
  await sincronizar(agora);
  const [cfg, uso] = await Promise.all([config(), atividades.emUso('corrida', agora)]);
  const apostas = cfg.rodada ? await apostasDa(cfg.rodada) : [];
  return { estado: cfg.estado, rodada: cfg.rodada, liberada: uso.ativa, emTeste: uso.teste, premios: PREMIOS,
    apostas: NAIPES.map((n) => ({ naipe: n, simbolo: SIMBOLO[n], pessoas: apostas.filter((a) => a.naipe === n).map((a) => a.nome) })),
    total: apostas.length, ...(cfg.estado === 'correndo' ? { fimEm: fimDa(cfg) } : {}), ...(cfg.estado === 'apostas' ? { fechaEm: cfg.fechaEm } : {}),
    ...(cfg.semApostas ? { semApostas: true } : {}),
    ...(cfg.estado === 'fim' ? { ordem: cfg.ordem, ultimos: cfg.ultimos } : {}) };
}

async function abrirApostas(agora = Date.now()) {
  const uso = await atividades.emUso('corrida', agora);
  if (!uso.ativa) throw new ErroValidacao('Libere a Corrida (ou coloque "Em teste") na aba Atividades antes.', 409);
  const cfg = await config();
  if (cfg.estado === 'apostas') return;
  if (cfg.estado === 'correndo') throw new ErroValidacao('Espere a corrida terminar.', 409);
  await festa.gravar('corrida', { rodada: cfg.rodada + 1, estado: 'apostas', teste: uso.teste, fechaEm: agora + APOSTAS_MS });
  await festa.definirTelao({ modo: 'corrida' });
}

function montarLargada(cfg, agora) {
  const s = simular();
  return { ...cfg, estado: 'correndo', inicioEm: agora, laterais: s.laterais, eventos: s.eventos, ordem: s.ordem, ultimos: s.ultimos };
}

// "Largar agora" (antes de acabar o minuto).
async function largar(agora = Date.now()) {
  const cfg = await festa.ler('corrida');
  if (!cfg || cfg.estado !== 'apostas') throw new ErroValidacao('Abra as apostas antes de largar.', 409);
  if (!(await apostasDa(cfg.rodada)).length) throw new ErroValidacao('Ninguém confirmou o cavalo ainda.', 409);
  if (!(await trocarConfig(cfg, montarLargada(cfg, agora)))) throw new ErroValidacao('A corrida acabou de largar.', 409);
  await festa.definirTelao({ modo: 'corrida' });
}

async function cancelar() {
  const cfg = await config();
  if (cfg.estado !== 'apostas' && cfg.estado !== 'correndo') throw new ErroValidacao('Não há corrida para cancelar.', 409);
  await banco.rodar('DELETE FROM corrida_apostas WHERE rodada = ?', [cfg.rodada]);
  await festa.gravar('corrida', { rodada: cfg.rodada - 1, estado: 'fechada', teste: false });
}

// ------------------------------------------------------------------ telão
async function paraTelao(agoraReal = Date.now()) {
  await sincronizar(agoraReal);
  const agoraJogo = await relogioJogo(agoraReal);
  const agora = agoraReal;
  const cfg = await config();
  const apostas = cfg.rodada ? await apostasDa(cfg.rodada) : [];
  const ganhadores = cfg.estado === 'fim' ? apostas.filter((a) => a.naipe === cfg.ordem[0]).map((a) => a.nome) : [];
  const shot = cfg.estado === 'fim' ? apostas.filter((a) => cfg.ultimos.includes(a.naipe)).map((a) => a.nome) : [];
  return { estado: cfg.estado, rodada: cfg.rodada, premios: PREMIOS, casas: CASAS, ...(cfg.estado === 'apostas' ? { fechaEm: cfg.fechaEm } : {}),
    apostas: Object.fromEntries(NAIPES.map((n) => [n, apostas.filter((a) => a.naipe === n).map((a) => ({ avatar: a.avatar, iniciais: iniciais(a.nome) }))])),
    total: apostas.length, ganhadores, shot, ...publico(cfg, agora),
    ...(agoraJogo !== agoraReal && cfg.estado === 'correndo' ? { pausadaEm: agoraJogo } : {}) };
}

module.exports = { NAIPES, SIMBOLO, CASAS, CHEGADA, PREMIOS, PREPARO_MS, PASSO_MS, DURACAO, APOSTAS_MS, duracaoDe, simular, config, sincronizar, paraConvidado, apostar,
  paraAdmin, abrirApostas, largar, cancelar, paraTelao };
