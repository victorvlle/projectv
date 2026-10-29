// Correio das Trevas: cartas anônimas que aparecem no telão depois que o organizador aprova.
// Anônimas para todos os convidados; só o organizador vê quem mandou (para moderar).
// Sem pontos (pontuar viraria spam no telão).
//
// Travas: até 140 caracteres; 1 carta por minuto e no máximo 15 por pessoa.
// MODO TESTE: cartas mandadas com a atividade "Em teste" ficam marcadas e somem no "Apagar dados de teste".

const crypto = require('crypto');
const banco = require('./banco');
const atividades = require('./atividades');
const convidados = require('./convidados');
const { ErroValidacao, limparTexto } = convidados;

const MAX_CARACTERES = 140;
const MAX_POR_PESSOA = 15;
const INTERVALO_MS = 60 * 1000;

const apelido = (id) => `k${crypto.createHash('sha256').update(`pv-correio:${id}`).digest('hex').slice(0, 12)}`;

async function paraConvidado(euId) {
  const [minhas, pessoas] = await Promise.all([
    banco.tudo(
      `SELECT m.texto, m.estado, m.criado_em, p.nome AS para FROM correio m LEFT JOIN convidados p ON p.id = m.para_id
        WHERE m.autor_id = ? ORDER BY m.criado_em DESC LIMIT 20`, [euId]),
    convidados.confirmados(),
  ]);
  return {
    max: MAX_CARACTERES, limite: MAX_POR_PESSOA,
    minhas: minhas.map((m) => ({ texto: m.texto, estado: m.estado, em: Number(m.criado_em), para: m.para || null })),
    enviadas: minhas.length,
    pessoas: pessoas.filter((c) => c.id !== euId).map((c) => ({ id: apelido(c.id), nome: c.nome, avatar: c.avatar })),
  };
}

async function enviar(eu, { texto, para }, agora = Date.now()) {
  const { liberada, teste } = await atividades.acesso('correio', eu, agora);
  if (!liberada) throw new ErroValidacao('O Correio das Trevas ainda não está aberto.', 403);
  const t = limparTexto(texto, MAX_CARACTERES);
  if (t.length < 3) throw new ErroValidacao('Escreva a sua carta.');
  let paraId = null;
  if (para) {
    const alvo = (await convidados.confirmados()).find((c) => apelido(c.id) === String(para));
    if (!alvo) throw new ErroValidacao('Escolha uma pessoa da lista.');
    paraId = alvo.id;
  }
  const r = await banco.um('SELECT COUNT(*) AS n, MAX(criado_em) AS ultima FROM correio WHERE autor_id = ?', [eu.id]);
  if (Number(r.n) >= MAX_POR_PESSOA) throw new ErroValidacao(`Você já mandou ${MAX_POR_PESSOA} cartas. Chega de correspondência por hoje. 💀`, 429);
  if (r.ultima != null && agora - Number(r.ultima) < INTERVALO_MS) {
    throw new ErroValidacao('Espere um minuto antes de mandar outra carta.', 429);
  }
  await banco.rodar('INSERT INTO correio (autor_id, para_id, texto, criado_em, teste) VALUES (?, ?, ?, ?, ?)',
    [eu.id, paraId, t, agora, teste ? 1 : 0]);
}

// ------------------------------------------------------------------ admin
async function paraAdmin(agora = Date.now()) {
  const [linhas, uso] = await Promise.all([
    banco.tudo(
      `SELECT m.id, m.texto, m.estado, m.criado_em, m.teste, a.nome AS autor, p.nome AS para
         FROM correio m JOIN convidados a ON a.id = m.autor_id LEFT JOIN convidados p ON p.id = m.para_id
        ORDER BY CASE m.estado WHEN 'pendente' THEN 0 ELSE 1 END, m.criado_em DESC LIMIT 120`),
    atividades.emUso('correio', agora),
  ]);
  const cartas = linhas.map((l) => ({ id: Number(l.id), texto: l.texto, estado: l.estado, em: Number(l.criado_em), autor: l.autor, para: l.para || null, teste: Boolean(Number(l.teste)) }));
  return { liberada: uso.ativa, emTeste: uso.teste, pendentes: cartas.filter((c) => c.estado === 'pendente').length, cartas };
}

async function moderar(id, estado, agora = Date.now()) {
  if (!['aprovada', 'recusada'].includes(estado)) throw new ErroValidacao('Estado inválido.');
  const r = await banco.rodar('UPDATE correio SET estado = ?, moderado_em = ? WHERE id = ?', [estado, agora, Number(id)]);
  if (!r.rowsAffected) throw new ErroValidacao('Carta não encontrada.', 404);
}

// ------------------------------------------------------------------ telão
async function paraTelao() {
  const linhas = await banco.tudo(
    `SELECT m.id, m.texto, m.moderado_em, p.nome AS para, p.avatar AS para_avatar FROM correio m LEFT JOIN convidados p ON p.id = m.para_id
      WHERE m.estado = 'aprovada' ORDER BY m.moderado_em DESC LIMIT 30`);
  return { cartas: linhas.map((l) => ({ id: Number(l.id), texto: l.texto, para: l.para || null, paraAvatar: l.para_avatar || null, em: Number(l.moderado_em) })) };
}

module.exports = { paraConvidado, enviar, paraAdmin, moderar, paraTelao, apelido, MAX_CARACTERES };
