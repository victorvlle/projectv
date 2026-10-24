// O Pós: para onde a noite continua depois da festa.
// A votação só abre quando a atividade "pos" está liberada (agendada para 23h) e
// fecha quando a festa termina. Um voto por pessoa, que pode ser trocado enquanto aberta.

const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const { ErroValidacao, limparTexto } = require('./convidados');

async function situacao(agora = Date.now()) {
  const [liberada, info] = await Promise.all([atividades.estaLiberada('pos', agora), festa.info()]);
  const encerrada = liberada && agora >= info.fimMs;
  return { liberada, aberta: liberada && !encerrada, encerrada, fechaEm: info.fimMs };
}

async function resultado(euId = null, agora = Date.now()) {
  const [sit, opcoes, meu] = await Promise.all([
    situacao(agora),
    banco.tudo(
      `SELECT o.id, o.nome, o.ordem,
              (SELECT COUNT(*) FROM pos_votos v JOIN convidados c ON c.id = v.convidado_id AND c.ativo = 1
                WHERE v.opcao_id = o.id) AS votos
         FROM pos_opcoes o ORDER BY o.ordem, o.id`),
    euId ? banco.um('SELECT opcao_id FROM pos_votos WHERE convidado_id = ?', [euId]) : null,
  ]);
  const lista = opcoes.map((o) => ({ id: Number(o.id), nome: o.nome, votos: Number(o.votos) }));
  const total = lista.reduce((s, o) => s + o.votos, 0);
  const max = Math.max(0, ...lista.map((o) => o.votos));
  const lideres = max > 0 ? lista.filter((o) => o.votos === max).map((o) => o.id) : [];
  return { ...sit, opcoes: lista, total, lideres, meuVoto: meu ? Number(meu.opcao_id) : null };
}

// Para o convidado: antes de liberar, não manda nada (nem as opções).
async function paraConvidado(euId) {
  const r = await resultado(euId);
  if (!r.liberada) return { liberada: false };
  return r;
}

async function votar(convidadoId, opcaoId) {
  const sit = await situacao();
  if (!sit.liberada) throw new ErroValidacao('A votação do pós ainda não abriu.', 403);
  if (sit.encerrada) throw new ErroValidacao('A votação do pós já terminou.', 403);
  const o = await banco.um('SELECT id FROM pos_opcoes WHERE id = ?', [Number(opcaoId)]);
  if (!o) throw new ErroValidacao('Opção inválida.', 404);
  await banco.rodar(
    `INSERT INTO pos_votos (convidado_id, opcao_id, atualizado_em) VALUES (?, ?, ?)
     ON CONFLICT(convidado_id) DO UPDATE SET opcao_id = excluded.opcao_id, atualizado_em = excluded.atualizado_em`,
    [convidadoId, o.id, Date.now()]);
}

// ------------------------------------------------------------------ admin
async function criarOpcao(nome) {
  const n = limparTexto(nome, 40);
  if (n.length < 2) throw new ErroValidacao('Escreva o nome do lugar.');
  const m = await banco.um('SELECT COUNT(*) AS n, COALESCE(MAX(ordem), -1) AS m FROM pos_opcoes');
  if (Number(m.n) >= 10) throw new ErroValidacao('No máximo 10 opções.');
  try {
    await banco.rodar('INSERT INTO pos_opcoes (nome, ordem) VALUES (?, ?)', [n, Number(m.m) + 1]);
  } catch (erro) {
    if (/UNIQUE/i.test(erro.message)) throw new ErroValidacao('Esse lugar já está na lista.', 409);
    throw erro;
  }
}

async function renomearOpcao(id, nome) {
  const n = limparTexto(nome, 40);
  if (n.length < 2) throw new ErroValidacao('Escreva o nome do lugar.');
  try {
    const r = await banco.rodar('UPDATE pos_opcoes SET nome = ? WHERE id = ?', [n, Number(id)]);
    if (!r.rowsAffected) throw new ErroValidacao('Opção não encontrada.', 404);
  } catch (erro) {
    if (/UNIQUE/i.test(erro.message)) throw new ErroValidacao('Esse lugar já está na lista.', 409);
    throw erro;
  }
}

async function removerOpcao(id) {
  const r = await banco.lote([
    { sql: 'DELETE FROM pos_votos WHERE opcao_id = ?', args: [Number(id)] },
    { sql: 'DELETE FROM pos_opcoes WHERE id = ?', args: [Number(id)] },
  ]);
  if (!r[1].rowsAffected) throw new ErroValidacao('Opção não encontrada.', 404);
}

module.exports = { situacao, resultado, paraConvidado, votar, criarOpcao, renomearOpcao, removerOpcao };
