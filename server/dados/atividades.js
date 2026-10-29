// Estado das atividades. O servidor é a única autoridade sobre o que está liberado:
// o relógio do celular nunca é consultado.
//
// Estados: bloqueada | agendada (abre sozinha em abre_em) | liberada | teste.
// O estado "efetivo" já considera o horário: agendada com abre_em no passado = liberada.
// "teste": aberta só para quem o admin marcou como testador; para os outros, bloqueada.

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
// Em teste: o testador vê como liberada (com `teste: true`); os outros, como bloqueada.
async function paraConvidado(agora = Date.now(), testador = false) {
  const mapa = await linhas();
  return ATIVIDADES.map((a) => {
    const l = mapa.get(a.id);
    let estado = l ? efetivo(l, agora) : 'bloqueada';
    const emTeste = estado === 'teste';
    if (emTeste) estado = testador ? 'liberada' : 'bloqueada';
    const base = { id: a.id, estado, enigma: a.enigma, abreEm: l && l.estado === 'agendada' ? Number(l.abre_em) : null };
    if (estado !== 'liberada') return base;
    return { ...base, nome: a.nome, icone: a.icone, descricao: a.descricao, ...(emTeste ? { teste: true } : {}) };
  });
}

// Pode este convidado usar a atividade agora? `teste` diz se é uma sessão de teste
// (tudo o que for gravado nela é marcado e some no "Apagar dados de teste").
async function acesso(id, convidado, agora = Date.now()) {
  const l = await banco.um('SELECT * FROM atividades WHERE id = ?', [id]);
  if (!l) return { liberada: false, teste: false };
  if (l.estado === 'teste') return { liberada: Boolean(convidado && Number(convidado.testador)), teste: true };
  return { liberada: efetivo(l, agora) === 'liberada', teste: false };
}

async function emTeste(id) {
  const l = await banco.um('SELECT estado FROM atividades WHERE id = ?', [id]);
  return Boolean(l) && l.estado === 'teste';
}

// Para ações do admin e do servidor: liberada de verdade OU em teste.
async function emUso(id, agora = Date.now()) {
  const l = await banco.um('SELECT * FROM atividades WHERE id = ?', [id]);
  if (!l) return { ativa: false, teste: false };
  if (l.estado === 'teste') return { ativa: true, teste: true };
  return { ativa: efetivo(l, agora) === 'liberada', teste: false };
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
  if (!['bloqueada', 'agendada', 'liberada', 'teste'].includes(estado)) throw new ErroValidacao('Estado inválido.');
  let abre = null;
  if (estado === 'agendada') {
    abre = typeof abreEm === 'number' ? abreEm : Date.parse(abreEm);
    if (!Number.isFinite(abre)) throw new ErroValidacao('Informe data e hora para agendar.');
  }
  // Em teste guarda o agendamento que existia: ao apagar os dados de teste, ele volta.
  if (estado === 'teste') {
    const atual = await banco.um('SELECT abre_em FROM atividades WHERE id = ?', [id]);
    abre = atual && atual.abre_em != null ? Number(atual.abre_em) : null;
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

module.exports = { efetivo, paraConvidado, paraAdmin, estaLiberada, acesso, emTeste, emUso, definir, proximaAbertura };
