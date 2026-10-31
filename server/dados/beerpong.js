// Beer Pong: inscrição → sorteio dos trios no telão → chaveamento (mata-mata) → campeão.
//
// SORTEIO: embaralha os inscritos e enche os times de 3 em 3, na ordem. Se o último time ficar com 1
// pessoa, ela ganha a companhia de alguém de um time de 3 (todo time tem pelo menos 2).
// CHAVE: mata-mata com "bye" (passa direto) quando o número de times não é potência de 2. O bye vai
// primeiro para os times com menos gente; entre iguais, por sorte.
// RESULTADO: só o organizador marca quem passou; o telão mostra o time avançando.
// PRÊMIOS: campeões +1000 cada; vice +500 cada (dados quando a final é marcada; desfazer tira).
// MODO TESTE: com a atividade "Em teste", só testadores se inscrevem; tudo marcado e apagável.
// FAKES (só em teste): o organizador escolhe de 0 a 28 jogadores de mentira para ver os cenários de times e
// chave. Eles não existem na tabela de convidados: não aparecem em lista, ranking nem confirmados, e não
// ganham pontos. Somem quando a atividade sai do modo teste ou com "Apagar dados de teste".

const crypto = require('crypto');
const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const pontos = require('./pontos');
const { ErroValidacao } = require('./convidados');

const POR_TIME = 3;
const MIN_INSCRITOS = 4; // dois times de 2
const PREMIOS = { campeao: 1000, vice: 500 };
const PASSO_SORTEIO_MS = 1300;
const NOMES_TIMES = [
  ['Vampiros', '🧛'], ['Bruxas', '🧙'], ['Zumbis', '🧟'], ['Lobisomens', '🐺'], ['Fantasmas', '👻'], ['Abóboras', '🎃'],
  ['Caveiras', '💀'], ['Morcegos', '🦇'], ['Aranhas', '🕷️'], ['Palhaços', '🤡'], ['Demônios', '👹'], ['Aliens', '👽'],
];
const MAX_FAKES = 28;
const NOMES_FAKES = ['Drácula', 'Morticia', 'Freddy', 'Samara', 'Chucky', 'Annabelle', 'Jason', 'Carrie', 'Pennywise', 'Wandinha',
  'Frankenstein', 'Medusa', 'Nosferatu', 'Regan', 'Ghostface', 'Elvira', 'Beetlejuice', 'Valak', 'Michael', 'Esther',
  'Damien', 'Lilith', 'Hannibal', 'Coraline', 'Jack', 'Sadako', 'Leatherface', 'Bellatrix'];
const AVATARES_FAKES = ['vampiro', 'bruxa', 'zumbi', 'lobisomem', 'fantasma', 'abobora', 'caveira', 'morcego', 'aranha', 'palhaco', 'demonio', 'alien'];
const FAKES = NOMES_FAKES.map((n, i) => ({ id: `fake-${String(i + 1).padStart(2, '0')}`, nome: `${n} Fake`, avatar: AVATARES_FAKES[i % AVATARES_FAKES.length], fake: true }));
const ehFake = (id) => typeof id === 'string' && id.startsWith('fake-');
const iniciais = (nome) => nome.trim().split(/\s+/).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
const primeiroNome = (nome) => nome.trim().split(/\s+/)[0];

function embaralhar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Divide em times de 3 (na ordem do sorteio); o último com 1 pessoa recebe alguém de um time de 3.
function montarTimes(ids) {
  const nomes = embaralhar(NOMES_TIMES);
  const times = [];
  ids.forEach((id, i) => {
    if (i % POR_TIME === 0) { const [nome, emoji] = nomes[times.length % nomes.length]; times.push({ id: `t${times.length + 1}`, nome, emoji, membros: [] }); }
    times[times.length - 1].membros.push(id);
  });
  const ultimo = times[times.length - 1];
  if (times.length > 1 && ultimo.membros.length === 1) {
    const doador = [...times].reverse().find((t) => t !== ultimo && t.membros.length === POR_TIME);
    if (doador) ultimo.membros.push(doador.membros.pop());
  }
  return times;
}

// Mata-mata com byes. Devolve as partidas (rodada, índice, a, b, vencedor).
function montarChave(times) {
  let tamanho = 1;
  while (tamanho < times.length) tamanho *= 2;
  const byes = tamanho - times.length;
  // Bye primeiro para quem tem menos gente; entre iguais, por sorte.
  const ordem = embaralhar(times).sort((x, y) => x.membros.length - y.membros.length);
  const comBye = ordem.slice(0, byes);
  const resto = embaralhar(ordem.slice(byes));
  const jogos1 = tamanho / 2;
  const slots = Array.from({ length: jogos1 }, () => [null, null]);
  // Espalha os byes pela chave (alternando metades) para não juntar todos de um lado.
  const posicoes = [];
  for (let i = 0; i < jogos1; i += 2) posicoes.push(i);
  for (let i = 1; i < jogos1; i += 2) posicoes.push(i);
  const posBye = posicoes.slice(0, byes);
  comBye.forEach((t, k) => { slots[posBye[k]][0] = t.id; });
  // Os outros times, de dois em dois, nas partidas sem bye (sobram exatamente 2 por partida).
  const livres = slots.filter((_, i) => !posBye.includes(i));
  livres.forEach((slot, k) => { slot[0] = resto[2 * k].id; slot[1] = resto[2 * k + 1].id; });
  const rodadas = Math.log2(tamanho);
  const partidas = [];
  for (let r = 1; r <= rodadas; r++) {
    const n = tamanho / 2 ** r;
    for (let i = 0; i < n; i++) {
      const p = { id: `r${r}j${i + 1}`, rodada: r, indice: i, a: null, b: null, vencedor: null, bye: false };
      if (r === 1) { [p.a, p.b] = slots[i]; if (!p.a || !p.b) { p.bye = true; p.vencedor = p.a || p.b; } }
      partidas.push(p);
    }
  }
  propagar(partidas);
  return { partidas, rodadas };
}

// Leva os vencedores para a próxima rodada (e desfaz o que não vale mais).
function propagar(partidas) {
  const porId = new Map(partidas.map((p) => [`${p.rodada}:${p.indice}`, p]));
  const maxR = Math.max(...partidas.map((p) => p.rodada));
  for (let r = 2; r <= maxR; r++) {
    for (const p of partidas.filter((x) => x.rodada === r)) {
      const f1 = porId.get(`${r - 1}:${p.indice * 2}`);
      const f2 = porId.get(`${r - 1}:${p.indice * 2 + 1}`);
      const a = f1 ? f1.vencedor : null;
      const b = f2 ? f2.vencedor : null;
      if (p.a !== a || p.b !== b) { p.a = a; p.b = b; if (p.vencedor && p.vencedor !== a && p.vencedor !== b) p.vencedor = null; }
    }
  }
}

const NOME_RODADA = (r, total) => {
  const falta = total - r;
  return ['Final', 'Semifinal', 'Quartas de final', 'Oitavas de final'][falta] || `Rodada ${r}`;
};

async function config() {
  return { estado: 'inscricao', teste: false, ...((await festa.ler('beerpong')) || {}) };
}
// Quantos fakes valem agora: só com a atividade "Em teste".
async function quantosFakes(cfg, agora = Date.now()) {
  if (!cfg.fakes) return 0;
  const uso = await atividades.emUso('beerpong', agora);
  return uso.teste ? Math.min(MAX_FAKES, cfg.fakes) : 0;
}
async function inscritos(cfg = null) {
  const c = cfg || await config();
  const reais = await banco.tudo(`SELECT c.id, c.nome, c.avatar FROM beerpong_inscritos i JOIN convidados c ON c.id = i.convidado_id AND c.ativo = 1
    ORDER BY i.em`);
  return [...reais, ...FAKES.slice(0, await quantosFakes(c))];
}
async function pessoas(ids) {
  const mapa = new Map(FAKES.filter((f) => ids.includes(f.id)).map((f) => [f.id, f]));
  const reais = ids.filter((id) => !ehFake(id));
  if (!reais.length) return mapa;
  const l = await banco.tudo(`SELECT id, nome, avatar FROM convidados WHERE id IN (${reais.map(() => '?').join(',')})`, reais);
  for (const p of l) mapa.set(p.id, p);
  return mapa;
}

// Visão pública da chave (telão, celular): times com nomes e monstros, partidas, próxima partida.
async function chavePublica(cfg) {
  if (!cfg.times) return null;
  const mapa = await pessoas(cfg.times.flatMap((t) => t.membros));
  const times = cfg.times.map((t) => ({ id: t.id, nome: t.nome, emoji: t.emoji,
    membros: t.membros.map((id) => { const p = mapa.get(id) || { nome: '?', avatar: null }; return { nome: primeiroNome(p.nome), iniciais: iniciais(p.nome), avatar: p.avatar }; }) }));
  const proxima = cfg.partidas.find((p) => p.a && p.b && !p.vencedor);
  return { times, partidas: cfg.partidas, rodadas: cfg.rodadas, nomesRodadas: Array.from({ length: cfg.rodadas }, (_, i) => NOME_RODADA(i + 1, cfg.rodadas)),
    proxima: proxima ? proxima.id : null, ultimo: cfg.ultimo || null };
}

function campeaoEVice(cfg) {
  const final = cfg.partidas.find((p) => p.rodada === cfg.rodadas);
  if (!final || !final.vencedor) return null;
  return { campeao: final.vencedor, vice: final.a === final.vencedor ? final.b : final.a };
}

// ------------------------------------------------------------------ convidado
async function paraConvidado(eu) {
  const cfg = await config();
  const lista = await inscritos(cfg);
  const saida = { estado: cfg.estado, inscrito: lista.some((p) => p.id === eu), inscritos: lista.length, premios: PREMIOS };
  if (cfg.times) {
    const meu = cfg.times.find((t) => t.membros.includes(eu));
    const chave = await chavePublica(cfg);
    saida.meuTime = meu ? chave.times.find((t) => t.id === meu.id) : null;
    if (meu) {
      const jogos = cfg.partidas.filter((p) => (p.a === meu.id || p.b === meu.id));
      const pendente = jogos.find((p) => p.a && p.b && !p.vencedor);
      const eliminado = jogos.some((p) => p.vencedor && p.vencedor !== meu.id);
      saida.situacao = eliminado ? 'eliminado' : pendente ? 'jogar' : 'esperando';
      if (pendente) {
        const outro = chave.times.find((t) => t.id === (pendente.a === meu.id ? pendente.b : pendente.a));
        saida.adversario = outro ? { nome: outro.nome, emoji: outro.emoji } : null;
        saida.agora = chave.proxima === pendente.id;
        saida.rodadaNome = chave.nomesRodadas[pendente.rodada - 1];
      }
    }
    const cv = campeaoEVice(cfg);
    if (cv) {
      const nome = (id) => { const t = chave.times.find((x) => x.id === id); return t ? `${t.emoji} ${t.nome}` : ''; };
      saida.resultado = { campeao: nome(cv.campeao), vice: nome(cv.vice), euCampeao: Boolean(meu && meu.id === cv.campeao), euVice: Boolean(meu && meu.id === cv.vice) };
    }
  }
  return saida;
}

async function inscrever(eu, quer, agora = Date.now()) {
  const { liberada, teste } = await atividades.acesso('beerpong', eu, agora);
  if (!liberada) throw new ErroValidacao('O Beer Pong ainda não está aberto.', 403);
  const cfg = await config();
  if (cfg.estado !== 'inscricao') throw new ErroValidacao('Os times já foram sorteados.', 409);
  if (quer) await banco.rodar('INSERT OR IGNORE INTO beerpong_inscritos (convidado_id, em, teste) VALUES (?, ?, ?)', [eu.id, agora, teste ? 1 : 0]);
  else await banco.rodar('DELETE FROM beerpong_inscritos WHERE convidado_id = ?', [eu.id]);
}

// ------------------------------------------------------------------ admin
async function paraAdmin(agora = Date.now()) {
  const [cfg, uso] = await Promise.all([config(), atividades.emUso('beerpong', agora)]);
  const lista = await inscritos(cfg);
  return { estado: cfg.estado, liberada: uso.ativa, emTeste: uso.teste, minimo: MIN_INSCRITOS, premios: PREMIOS,
    fakes: uso.teste ? Math.min(MAX_FAKES, cfg.fakes || 0) : 0, maxFakes: MAX_FAKES,
    inscritos: lista.map((p) => ({ id: p.id, nome: p.nome, avatar: p.avatar, ...(p.fake ? { fake: true } : {}) })), chave: await chavePublica(cfg) };
}

async function sortear(agora = Date.now()) {
  const uso = await atividades.emUso('beerpong', agora);
  if (!uso.ativa) throw new ErroValidacao('Libere o Beer Pong (ou coloque "Em teste") na aba Atividades antes.', 409);
  const cfg = await config();
  if (cfg.estado !== 'inscricao') throw new ErroValidacao('Os times já foram sorteados. Use "Recomeçar" para sortear de novo.', 409);
  const lista = await inscritos(cfg);
  if (lista.length < MIN_INSCRITOS) throw new ErroValidacao(`Precisa de pelo menos ${MIN_INSCRITOS} inscritos (dois times de 2).`, 409);
  const ordem = embaralhar(lista.map((p) => p.id));
  const times = montarTimes(ordem);
  const { partidas, rodadas } = montarChave(times);
  // Ordem em que os nomes aparecem no telão: a mesma do sorteio (time a time).
  const revelacao = times.flatMap((t) => t.membros.map((id) => ({ id, time: t.id })));
  await festa.gravar('beerpong', { estado: 'chave', teste: uso.teste, fakes: cfg.fakes || 0, times, partidas, rodadas, sorteioEm: agora, revelacao, ultimo: null });
  await festa.definirTelao({ modo: 'beerpong' });
  return { times: times.length };
}

async function marcar(partidaId, lado, agora = Date.now()) {
  const cfg = await config();
  if (!cfg.partidas) throw new ErroValidacao('Sorteie os times antes.', 409);
  const p = cfg.partidas.find((x) => x.id === partidaId);
  if (!p) throw new ErroValidacao('Partida não encontrada.', 404);
  if (!p.a || !p.b) throw new ErroValidacao('Essa partida ainda não tem os dois times.', 409);
  if (!['a', 'b'].includes(lado)) throw new ErroValidacao('Lado inválido.');
  const prox = cfg.partidas.find((x) => x.rodada === p.rodada + 1 && x.indice === Math.floor(p.indice / 2));
  if (prox && prox.vencedor) throw new ErroValidacao('A próxima partida já tem resultado: desfaça ela antes.', 409);
  p.vencedor = p[lado];
  propagar(cfg.partidas);
  cfg.ultimo = { partida: p.id, time: p.vencedor, em: agora };
  const cv = campeaoEVice(cfg);
  cfg.estado = cv ? 'fim' : 'chave';
  await festa.gravar('beerpong', cfg);
  await darPontos(cfg);
  await festa.definirTelao({ modo: 'beerpong' });
}

async function desfazer(partidaId) {
  const cfg = await config();
  const p = (cfg.partidas || []).find((x) => x.id === partidaId);
  if (!p || p.bye || !p.vencedor) throw new ErroValidacao('Nada para desfazer nessa partida.', 409);
  const prox = cfg.partidas.find((x) => x.rodada === p.rodada + 1 && x.indice === Math.floor(p.indice / 2));
  if (prox && prox.vencedor) throw new ErroValidacao('A próxima partida já tem resultado: desfaça ela antes.', 409);
  p.vencedor = null;
  propagar(cfg.partidas);
  cfg.ultimo = null;
  cfg.estado = 'chave';
  await festa.gravar('beerpong', cfg);
  await darPontos(cfg);
}

// Pontos de campeão e vice: refeitos do zero a cada mudança (desfazer a final tira).
async function darPontos(cfg) {
  const cv = campeaoEVice(cfg);
  await banco.transacao(async (tx) => {
    await tx.execute({ sql: "DELETE FROM pontos_log WHERE atividade = 'beerpong'", args: [] });
    if (!cv) return;
    for (const [id, valor, titulo] of [[cv.campeao, PREMIOS.campeao, 'campeão'], [cv.vice, PREMIOS.vice, 'vice']]) {
      const time = cfg.times.find((t) => t.id === id);
      for (const m of time ? time.membros : []) {
        await pontos.conceder({ convidadoId: m, atividade: 'beerpong', pontos: valor, motivo: `Beer Pong: ${titulo} (${time.nome})`,
          chave: `beerpong:${m}`, teste: cfg.teste }, tx);
      }
    }
  });
}

async function recomecar() {
  const cfg = await config();
  await banco.rodar("DELETE FROM pontos_log WHERE atividade = 'beerpong'");
  // Os fakes ficam: dá para sortear de novo com outra quantidade.
  await festa.gravar('beerpong', { estado: 'inscricao', teste: false, ...(cfg.fakes ? { fakes: cfg.fakes } : {}) });
}

// Quantos jogadores fakes entram (0 a 28). Só com o Beer Pong "Em teste" e antes do sorteio.
async function definirFakes(n, agora = Date.now()) {
  const uso = await atividades.emUso('beerpong', agora);
  if (!uso.teste) throw new ErroValidacao('Fakes só no modo teste: coloque o Beer Pong "Em teste" na aba Atividades.', 409);
  const qtd = Number(n);
  if (!Number.isInteger(qtd) || qtd < 0 || qtd > MAX_FAKES) throw new ErroValidacao(`Escolha de 0 a ${MAX_FAKES} fakes.`);
  const cfg = await config();
  if (cfg.estado !== 'inscricao') throw new ErroValidacao('Os times já foram sorteados: toque em "Recomeçar" para mudar a quantidade.', 409);
  await festa.gravar('beerpong', { ...cfg, fakes: qtd });
}

async function tirarInscrito(id) {
  const cfg = await config();
  if (cfg.estado !== 'inscricao') throw new ErroValidacao('Os times já foram sorteados.', 409);
  if (ehFake(String(id))) throw new ErroValidacao('Para tirar fakes, mude a quantidade.', 409);
  await banco.rodar('DELETE FROM beerpong_inscritos WHERE convidado_id = ?', [String(id)]);
}

// ------------------------------------------------------------------ telão
async function paraTelao() {
  const cfg = await config();
  const lista = await inscritos(cfg);
  const saida = { estado: cfg.estado, premios: PREMIOS, inscritos: lista.map((p) => ({ avatar: p.avatar, iniciais: iniciais(p.nome) })) };
  if (cfg.times) {
    saida.chave = await chavePublica(cfg);
    saida.sorteioEm = cfg.sorteioEm;
    saida.passoMs = PASSO_SORTEIO_MS;
    const mapa = await pessoas(cfg.revelacao.map((r) => r.id));
    saida.revelacao = cfg.revelacao.map((r) => { const p = mapa.get(r.id) || { nome: '?' }; return { nome: primeiroNome(p.nome), avatar: p.avatar, time: r.time }; });
    const cv = campeaoEVice(cfg);
    if (cv) saida.campeao = cv.campeao;
  }
  return saida;
}

module.exports = { montarTimes, montarChave, propagar, config, paraConvidado, inscrever, paraAdmin, sortear, marcar, desfazer, recomecar,
  tirarInscrito, paraTelao, definirFakes, PREMIOS, MIN_INSCRITOS, MAX_FAKES };
