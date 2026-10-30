// Pontos e ranking. Tudo passa por pontos_log, cuja coluna `chave` é única:
// o mesmo ponto (ex.: "previsao:longnecks:<convidado>") nunca entra duas vezes,
// nem com página atualizada, clique duplo, requisição repetida ou dois processos.

const banco = require('./banco');

const NOMES_ATIVIDADE = {
  previsoes: 'Previsões', maldicao: 'Maldição', enigma: 'Enigmas (pré-festa)', colaboracao: 'Colaboração',
  quiz: 'Quiz Relâmpago', concurso: 'Concurso de Fantasia', monstro: 'O Monstro', corrida: 'Corrida de Cavalos', beerpong: 'Beer Pong',
};

// Retorna true se concedeu agora; false se já existia.
// `teste`: ponto de uma sessão de teste. Só os testadores (e o telão/admin) veem; o
// "Apagar dados de teste" remove todos.
async function conceder({ convidadoId, atividade, pontos, motivo, chave, teste = false }, executor = null) {
  const sql = `INSERT OR IGNORE INTO pontos_log (convidado_id, atividade, pontos, motivo, chave, criado_em, teste)
               SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM convidados WHERE id = ?)`;
  const args = [convidadoId, atividade, pontos, motivo, chave, Date.now(), teste ? 1 : 0, convidadoId];
  const r = executor ? await executor.execute({ sql, args }) : await banco.rodar(sql, args);
  return Boolean(r.rowsAffected);
}

async function revogar(chave) {
  const r = await banco.rodar('DELETE FROM pontos_log WHERE chave = ?', [chave]);
  return Boolean(r.rowsAffected);
}

async function jaTem(chave) {
  return Boolean(await banco.um('SELECT 1 FROM pontos_log WHERE chave = ?', [chave]));
}

// Ranking de quem já escolheu o monstro. Empate divide a posição (1, 2, 2, 4).
// `incluirTeste`: false para quem não é testador (pontos de teste não aparecem para eles).
async function ranking(incluirTeste = true) {
  const linhas = await banco.tudo(
    `SELECT c.id, c.nome, c.avatar, COALESCE(SUM(p.pontos), 0) AS pontos, MIN(c.primeiro_acesso_em) AS desde
       FROM convidados c LEFT JOIN pontos_log p ON p.convidado_id = c.id ${incluirTeste ? '' : 'AND p.teste = 0'}
      WHERE c.ativo = 1 AND c.avatar IS NOT NULL
      GROUP BY c.id, c.nome, c.avatar
      ORDER BY pontos DESC, c.nome COLLATE NOCASE`);
  let anterior = null;
  let posicao = 0;
  return linhas.map((l, i) => {
    const pts = Number(l.pontos);
    if (pts !== anterior) { posicao = i + 1; anterior = pts; }
    return { id: l.id, nome: l.nome, avatar: l.avatar, pontos: pts, posicao };
  });
}

async function extrato(convidadoId) {
  const linhas = await banco.tudo(
    'SELECT atividade, motivo, pontos, criado_em, teste FROM pontos_log WHERE convidado_id = ? ORDER BY criado_em DESC LIMIT 200', [convidadoId]);
  const porAtividade = {};
  for (const l of linhas) porAtividade[l.atividade] = (porAtividade[l.atividade] || 0) + Number(l.pontos);
  return {
    total: linhas.reduce((s, l) => s + Number(l.pontos), 0),
    porAtividade: Object.entries(porAtividade).map(([id, pontos]) => ({ id, nome: NOMES_ATIVIDADE[id] || id, pontos })),
    ultimos: linhas.slice(0, 15).map((l) => ({ atividade: NOMES_ATIVIDADE[l.atividade] || l.atividade, motivo: l.motivo, pontos: Number(l.pontos), em: Number(l.criado_em), teste: Boolean(l.teste) })),
  };
}

// Visão do convidado: top 10 + a própria posição (sem ids internos dos outros).
async function paraConvidado(euId, testador = false) {
  const r = await ranking(testador);
  const eu = r.find((x) => x.id === euId) || null;
  const limpar = (x) => ({ nome: x.nome, avatar: x.avatar, pontos: x.pontos, posicao: x.posicao, souEu: x.id === euId });
  return { top: r.slice(0, 10).map(limpar), eu: eu ? limpar(eu) : null, total: r.length, extrato: await extrato(euId) };
}

module.exports = { conceder, revogar, jaTem, ranking, extrato, paraConvidado, NOMES_ATIVIDADE };
