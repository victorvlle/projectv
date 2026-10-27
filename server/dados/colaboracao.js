// "Colaborar conta ponto": carona oferecida (+5), música na playlist (+5 cada) e bebida
// levada (+5, só depois que o organizador confirma na festa que a pessoa levou).
//
// Chaves únicas em pontos_log: "carona:<convidado>", "musica:<id da música>",
// "bebida:<convidado>". Tirar a carona ou a música tira os pontos dela.

const banco = require('./banco');
const festa = require('./festa');
const pontos = require('./pontos');
const { ErroValidacao } = require('./convidados');
const { PONTOS_COLABORACAO } = require('../jogos/conteudo');

// Confirmar bebida só a partir de 2 h antes do início (montagem) — "contabilizada na festa".
const ANTECEDENCIA_BEBIDA_MS = 2 * 3600 * 1000;

async function caronaOferecida(convidadoId) {
  await pontos.conceder({ convidadoId, atividade: 'colaboracao', pontos: PONTOS_COLABORACAO.carona,
    motivo: 'Ofereceu carona', chave: `carona:${convidadoId}` });
}
const caronaRetirada = (convidadoId) => pontos.revogar(`carona:${convidadoId}`);

async function musicaAdicionada(convidadoId, musicaId, titulo) {
  if (!Number.isFinite(musicaId) || musicaId <= 0) return;
  await pontos.conceder({ convidadoId, atividade: 'colaboracao', pontos: PONTOS_COLABORACAO.musica,
    motivo: `Música na playlist: ${titulo}`.slice(0, 120), chave: `musica:${musicaId}` });
}
const musicaRetirada = (musicaId) => pontos.revogar(`musica:${musicaId}`);

// Quem marcou alguma bebida, e se o organizador já confirmou que levou.
async function bebidasParaAdmin(agora = Date.now()) {
  const [linhas, info] = await Promise.all([
    banco.tudo(
      `SELECT c.id, c.nome, c.avatar,
              GROUP_CONCAT(COALESCE(i.nome, b.nome_livre) || ' (' || b.quantidade || ')', ', ') AS itens,
              EXISTS (SELECT 1 FROM pontos_log p WHERE p.chave = 'bebida:' || c.id) AS confirmado
         FROM bebidas_compromissos b
         JOIN convidados c ON c.id = b.convidado_id AND c.ativo = 1
         LEFT JOIN bebidas_itens i ON i.id = b.item_id
        WHERE b.quantidade > 0
        GROUP BY c.id, c.nome, c.avatar
        ORDER BY confirmado, c.nome COLLATE NOCASE`),
    festa.info(),
  ]);
  const liberaEm = info.inicioMs - ANTECEDENCIA_BEBIDA_MS;
  return {
    pontos: PONTOS_COLABORACAO.bebida, liberaEm, liberado: agora >= liberaEm,
    pessoas: linhas.map((l) => ({ id: l.id, nome: l.nome, avatar: l.avatar, itens: l.itens, confirmado: Boolean(Number(l.confirmado)) })),
  };
}

async function confirmarBebida(convidadoId, levou, agora = Date.now()) {
  const info = await festa.info();
  if (agora < info.inicioMs - ANTECEDENCIA_BEBIDA_MS) {
    throw new ErroValidacao('A confirmação das bebidas abre no dia da festa, 2 horas antes do início.', 409);
  }
  if (!levou) return { mudou: await pontos.revogar(`bebida:${convidadoId}`) };
  const tem = await banco.um('SELECT 1 FROM bebidas_compromissos WHERE convidado_id = ? AND quantidade > 0', [convidadoId]);
  if (!tem) throw new ErroValidacao('Essa pessoa não marcou nenhuma bebida.', 404);
  return { mudou: await pontos.conceder({ convidadoId, atividade: 'colaboracao', pontos: PONTOS_COLABORACAO.bebida,
    motivo: 'Levou a contribuição de bebida', chave: `bebida:${convidadoId}` }) };
}

module.exports = { caronaOferecida, caronaRetirada, musicaAdicionada, musicaRetirada, bebidasParaAdmin, confirmarBebida, ANTECEDENCIA_BEBIDA_MS };
