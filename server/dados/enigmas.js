// Enigmas de filmes de terror: 3 por dia (terça a quinta). Cada um fecha quando o próximo abre. Acerto +10; os 3 primeiros de cada enigma ganham bônus.
//
// CONTRA COLA ("modo prova")
//  - O texto do enigma só sai do servidor quando a pessoa toca em "Revelar". A partir daí o
//    servidor marca a hora e a pessoa tem um tempo limite (padrão 2 min) para responder.
//    Recarregar não zera o relógio: ele é do servidor.
//  - Se a página sai da tela com o enigma revelado (trocou de app/aba, bloqueou a tela,
//    recarregou), o celular avisa o servidor e o enigma é encerrado para aquela pessoa.
//  - O que NÃO dá para impedir: pesquisar em outro aparelho ao mesmo tempo. O tempo curto
//    e as perguntas difíceis são a defesa para isso.
//
// INTEGRIDADE
//  - A ordem dos acertos é decidida numa transação: dois acertos no mesmo instante nunca ficam
//    com a mesma posição. Pontos com chave única "enigma:<id>:<convidado>": nunca duplicam.
//  - A resposta certa nunca sai do servidor enquanto o enigma está aberto.

const banco = require('./banco');
const festa = require('./festa');
const pontos = require('./pontos');
const { ErroValidacao, limparTexto } = require('./convidados');
const { PONTOS_ENIGMA, BONUS_ENIGMA_PADRAO } = require('../jogos/conteudo');

const MAX_TENTATIVAS = 5;
const TEMPO_PADRAO_S = 120;
const FOLGA_MS = 3000; // atraso de rede na última resposta

function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(o|a|os|as|um|uma|uns|umas|e|de|do|da)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

async function bonus() {
  const b = await festa.ler('enigmasBonus');
  return Array.isArray(b) ? b.map((x) => Math.max(0, Math.min(50, Number(x) || 0))).slice(0, 3) : BONUS_ENIGMA_PADRAO;
}
async function tempoLimiteS() {
  const t = Number(await festa.ler('enigmasTempo'));
  return Number.isInteger(t) && t >= 30 && t <= 900 ? t : TEMPO_PADRAO_S;
}

// Quando o próximo enigma abre, o anterior fecha (ninguém responde atrasado).
// O fechamento efetivo é o menor entre o fecha_em gravado e a abertura do próximo.
async function lista() {
  const linhas = await banco.tudo('SELECT * FROM enigmas ORDER BY abre_em, ordem');
  const todos = linhas.map((l) => ({
    id: l.id, ordem: Number(l.ordem), titulo: l.titulo, pergunta: l.pergunta, respostas: JSON.parse(l.respostas),
    dica: l.dica, abreEm: Number(l.abre_em), fechaEm: Number(l.fecha_em), fechaGravado: Number(l.fecha_em),
  }));
  for (let i = 0; i < todos.length - 1; i++) {
    const proximo = todos.slice(i + 1).find((x) => x.abreEm > todos[i].abreEm);
    if (proximo) todos[i].fechaEm = Math.min(todos[i].fechaEm, proximo.abreEm);
  }
  return todos.sort((a, b) => a.ordem - b.ordem);
}

const estadoDe = (e, agora) => (agora < e.abreEm ? 'em-breve' : agora < e.fechaEm ? 'aberto' : 'fechado');

// Situação pessoal num enigma aberto.
function situacaoPessoal(m, tempoS, agora) {
  if (!m) return { fase: 'nao-revelado' };
  if (m.acertou_em != null) return { fase: 'resolvido' };
  if (m.saiu_em != null) return { fase: 'saiu' };
  if (m.revelado_em == null) return { fase: 'nao-revelado' };
  const expiraEm = Number(m.revelado_em) + tempoS * 1000;
  if (agora > expiraEm + FOLGA_MS) return { fase: 'tempo' };
  if (Number(m.tentativas) >= MAX_TENTATIVAS) return { fase: 'sem-tentativas' };
  return { fase: 'respondendo', expiraEm };
}

async function paraConvidado(euId, agora = Date.now()) {
  const [todos, meus, contagem, b, tempoS] = await Promise.all([
    lista(),
    banco.tudo('SELECT * FROM enigma_tentativas WHERE convidado_id = ?', [euId]),
    banco.tudo('SELECT enigma_id, COUNT(*) AS n FROM enigma_tentativas WHERE acertou_em IS NOT NULL GROUP BY enigma_id'),
    bonus(), tempoLimiteS(),
  ]);
  const mapa = new Map(meus.map((m) => [m.enigma_id, m]));
  const acertos = new Map(contagem.map((c) => [c.enigma_id, Number(c.n)]));
  return {
    pontos: PONTOS_ENIGMA, bonus: b, maxTentativas: MAX_TENTATIVAS, tempoS, agora,
    enigmas: todos.map((e) => {
      const estado = estadoDe(e, agora);
      const m = mapa.get(e.id);
      const base = { id: e.id, titulo: e.titulo, estado, abreEm: e.abreEm, fechaEm: e.fechaEm, acertadores: acertos.get(e.id) || 0 };
      if (estado === 'em-breve') return base;
      if (estado === 'fechado') {
        return { ...base, pergunta: e.pergunta, resposta: e.respostas[0], resolvi: Boolean(m && m.acertou_em),
          posicao: m && m.posicao ? Number(m.posicao) : null };
      }
      const s = situacaoPessoal(m, tempoS, agora);
      const saida = { ...base, fase: s.fase, resolvi: s.fase === 'resolvido', posicao: m && m.posicao ? Number(m.posicao) : null,
        tentativas: m ? Number(m.tentativas) : 0 };
      // O texto só vai para quem revelou e ainda está no tempo, ou para quem já acertou.
      if (s.fase === 'respondendo') return { ...saida, pergunta: e.pergunta, expiraEm: s.expiraEm };
      if (s.fase === 'resolvido') return { ...saida, pergunta: e.pergunta };
      return saida;
    }),
  };
}

async function abertoOuErro(enigmaId, agora) {
  const e = (await lista()).find((x) => x.id === String(enigmaId));
  if (!e) throw new ErroValidacao('Enigma não encontrado.', 404);
  const estado = estadoDe(e, agora);
  if (estado !== 'aberto') throw new ErroValidacao(estado === 'em-breve' ? 'Esse enigma ainda não abriu.' : 'Esse enigma já fechou.', 409);
  return e;
}

// Começa o relógio (uma vez só: revelar de novo não zera o tempo).
async function revelar(euId, enigmaId, agora = Date.now()) {
  const e = await abertoOuErro(enigmaId, agora);
  await banco.rodar(
    `INSERT INTO enigma_tentativas (enigma_id, convidado_id, tentativas, revelado_em) VALUES (?, ?, 0, ?)
     ON CONFLICT(enigma_id, convidado_id) DO UPDATE SET revelado_em = COALESCE(enigma_tentativas.revelado_em, excluded.revelado_em)`,
    [e.id, euId, agora]);
  return paraConvidado(euId, agora);
}

// A página saiu da tela com o enigma revelado: encerra para essa pessoa.
async function saiu(euId, enigmaId, agora = Date.now()) {
  const r = await banco.rodar(
    `UPDATE enigma_tentativas SET saiu_em = ?
      WHERE enigma_id = ? AND convidado_id = ? AND revelado_em IS NOT NULL AND acertou_em IS NULL AND saiu_em IS NULL`,
    [agora, String(enigmaId), euId]);
  return Boolean(r.rowsAffected);
}

async function responder(euId, enigmaId, resposta, agora = Date.now()) {
  const e = await abertoOuErro(enigmaId, agora);
  const texto = limparTexto(resposta, 60);
  if (!texto) throw new ErroValidacao('Escreva uma resposta.');
  const [b, tempoS] = await Promise.all([bonus(), tempoLimiteS()]);

  return banco.transacao(async (tx) => {
    const atual = (await tx.execute({ sql: 'SELECT * FROM enigma_tentativas WHERE enigma_id = ? AND convidado_id = ?', args: [e.id, euId] })).rows[0];
    const s = situacaoPessoal(atual, tempoS, agora);
    if (s.fase === 'resolvido') return { acertou: true, jaTinha: true, posicao: Number(atual.posicao), pontos: 0 };
    if (s.fase === 'nao-revelado') throw new ErroValidacao('Revele o enigma antes de responder.', 409);
    if (s.fase === 'saiu') throw new ErroValidacao('Você saiu da página com o enigma aberto. Esse enigma foi encerrado para você.', 409);
    if (s.fase === 'tempo') throw new ErroValidacao('O tempo acabou. Esse enigma foi encerrado para você.', 409);
    if (s.fase === 'sem-tentativas') throw new ErroValidacao('Suas tentativas para este enigma acabaram.', 429);
    const usadas = Number(atual.tentativas);
    const certo = e.respostas.map(normalizar).includes(normalizar(texto));
    if (!certo) {
      await tx.execute({ sql: 'UPDATE enigma_tentativas SET tentativas = tentativas + 1 WHERE enigma_id = ? AND convidado_id = ?', args: [e.id, euId] });
      return { acertou: false, restantes: MAX_TENTATIVAS - usadas - 1 };
    }
    const n = (await tx.execute({ sql: 'SELECT COUNT(*) AS n FROM enigma_tentativas WHERE enigma_id = ? AND acertou_em IS NOT NULL', args: [e.id] })).rows[0];
    const posicao = Number(n.n) + 1;
    await tx.execute({
      sql: 'UPDATE enigma_tentativas SET tentativas = tentativas + 1, acertou_em = ?, posicao = ? WHERE enigma_id = ? AND convidado_id = ?',
      args: [agora, posicao, e.id, euId] });
    const extra = b[posicao - 1] || 0;
    const total = PONTOS_ENIGMA + extra;
    const segundos = Math.round((agora - Number(atual.revelado_em)) / 1000);
    await pontos.conceder({ convidadoId: euId, atividade: 'enigma', pontos: total,
      motivo: `${e.titulo}: acertou em ${segundos}s${extra ? `, ${posicao}º lugar (+${extra} de bônus)` : ''}`, chave: `enigma:${e.id}:${euId}` }, tx);
    return { acertou: true, posicao, pontos: total, bonus: extra, segundos };
  });
}

async function paraAdmin(agora = Date.now()) {
  const [todos, linhas, b, tempoS] = await Promise.all([
    lista(),
    banco.tudo(`SELECT t.*, c.nome FROM enigma_tentativas t JOIN convidados c ON c.id = t.convidado_id ORDER BY t.posicao`),
    bonus(), tempoLimiteS(),
  ]);
  return {
    bonus: b, pontos: PONTOS_ENIGMA, tempoS, maxTentativas: MAX_TENTATIVAS,
    enigmas: todos.map((e) => {
      const deste = linhas.filter((l) => l.enigma_id === e.id);
      return {
        ...e, estado: estadoDe(e, agora),
        acertadores: deste.filter((l) => l.acertou_em != null)
          .map((l) => ({ nome: l.nome, posicao: Number(l.posicao), em: Number(l.acertou_em), segundos: Math.round((Number(l.acertou_em) - Number(l.revelado_em)) / 1000) })),
        revelaram: deste.filter((l) => l.revelado_em != null).length,
        sairam: deste.filter((l) => l.saiu_em != null).map((l) => l.nome),
      };
    }),
  };
}

async function editar(id, campos) {
  const e = (await lista()).find((x) => x.id === String(id));
  if (!e) throw new ErroValidacao('Enigma não encontrado.', 404);
  const titulo = campos.titulo !== undefined ? limparTexto(campos.titulo, 40) : e.titulo;
  const pergunta = campos.pergunta !== undefined ? limparTexto(campos.pergunta, 400) : e.pergunta;
  const dica = campos.dica !== undefined ? limparTexto(campos.dica, 120) : e.dica;
  let respostas = e.respostas;
  if (campos.respostas !== undefined) {
    const brutas = Array.isArray(campos.respostas) ? campos.respostas : String(campos.respostas).split(/[,;\n]/);
    respostas = brutas.map((r) => limparTexto(r, 60)).filter(Boolean).slice(0, 12);
  }
  const data = (v, atual) => {
    if (v === undefined) return atual;
    const ms = typeof v === 'number' ? v : Date.parse(v);
    if (!Number.isFinite(ms)) throw new ErroValidacao('Data inválida.');
    return ms;
  };
  const abreEm = data(campos.abreEm, e.abreEm);
  const fechaEm = data(campos.fechaEm, e.fechaGravado);
  if (titulo.length < 2 || pergunta.length < 10) throw new ErroValidacao('Escreva o título e o enigma.');
  if (!respostas.length) throw new ErroValidacao('Informe pelo menos uma resposta aceita.');
  if (fechaEm <= abreEm) throw new ErroValidacao('O enigma precisa fechar depois de abrir.');
  await banco.rodar('UPDATE enigmas SET titulo = ?, pergunta = ?, respostas = ?, dica = ?, abre_em = ?, fecha_em = ? WHERE id = ?',
    [titulo, pergunta, JSON.stringify(respostas), dica, abreEm, fechaEm, e.id]);
}

async function definirBonus(valores) {
  if (!Array.isArray(valores) || valores.length !== 3 || valores.some((v) => !Number.isInteger(v) || v < 0 || v > 50)) {
    throw new ErroValidacao('Bônus: três números inteiros de 0 a 50.');
  }
  await festa.gravar('enigmasBonus', valores);
}

async function definirTempo(segundos) {
  const s = Number(segundos);
  if (!Number.isInteger(s) || s < 30 || s > 900) throw new ErroValidacao('Tempo: de 30 a 900 segundos.');
  await festa.gravar('enigmasTempo', s);
}

module.exports = {
  normalizar, lista, paraConvidado, revelar, saiu, responder, paraAdmin, editar, definirBonus, definirTempo,
  MAX_TENTATIVAS, TEMPO_PADRAO_S,
};
