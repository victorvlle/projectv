// Estado das atividades. O servidor é a única autoridade sobre o que está liberado:
// o relógio do celular nunca é consultado.
//
// Estados: bloqueada | agendada (abre sozinha em abre_em) | liberada.
// O estado "efetivo" já considera o horário: agendada com abre_em no passado = liberada.

const banco = require('./banco');
const { ATIVIDADES, IDS, porId } = require('../atividades/catalogo');
const { ErroValidacao } = require('./convidados');

function efetivo(linha, agora = Date.now()) {
  if (linha.estado === 'agendada' && linha.abre_em != null && Number(linha.abre_em) <= agora) return 'liberada';
  return linha.estado;
}

async function linhas() {
  const rs = await banco.tudo('SELECT * FROM atividades');
  return new Map(rs.map((l) => [l.id, l]));
}

// Para o convidado: atividade bloqueada mostra só o enigma, sem nome real nem descrição.
async function paraConvidado(agora = Date.now()) {
  const mapa = await linhas();
  return ATIVIDADES.map((a) => {
    const l = mapa.get(a.id);
    const estado = l ? efetivo(l, agora) : 'bloqueada';
    const base = { id: a.id, estado, enigma: a.enigma, abreEm: l && l.estado === 'agendada' ? Number(l.abre_em) : null };
    if (estado !== 'liberada') return base;
    return { ...base, nome: a.nome, icone: a.icone, descricao: a.descricao };
  });
}

async function paraAdmin(agora = Date.now()) {
  const mapa = await linhas();
  return ATIVIDADES.map((a) => {
    const l = mapa.get(a.id);
    return {
      id: a.id, nome: a.nome, enigma: a.enigma, icone: a.icone,
      estado: l ? l.estado : 'bloqueada',
      efetivo: l ? efetivo(l, agora) : 'bloqueada',
      abreEm: l && l.abre_em != null ? Number(l.abre_em) : null,
    };
  });
}

async function estaLiberada(id, agora = Date.now()) {
  const l = await banco.um('SELECT * FROM atividades WHERE id = ?', [id]);
  return Boolean(l) && efetivo(l, agora) === 'liberada';
}

async function definir(id, { estado, abreEm }) {
  if (!IDS.has(id)) throw new ErroValidacao('Atividade desconhecida.', 404);
  if (!['bloqueada', 'agendada', 'liberada'].includes(estado)) throw new ErroValidacao('Estado inválido.');
  let abre = null;
  if (estado === 'agendada') {
    abre = typeof abreEm === 'number' ? abreEm : Date.parse(abreEm);
    if (!Number.isFinite(abre)) throw new ErroValidacao('Informe data e hora para agendar.');
  }
  await banco.rodar('UPDATE atividades SET estado = ?, abre_em = ?, atualizado_em = ? WHERE id = ?',
    [estado, abre, Date.now(), id]);
  return porId(id);
}

// Próximo instante em que alguma atividade agendada vai abrir (para o agendador).
async function proximaAbertura(agora = Date.now()) {
  const l = await banco.um(
    "SELECT MIN(abre_em) AS m FROM atividades WHERE estado = 'agendada' AND abre_em > ?", [agora]);
  return l && l.m != null ? Number(l.m) : null;
}

module.exports = { efetivo, paraConvidado, paraAdmin, estaLiberada, definir, proximaAbertura };
