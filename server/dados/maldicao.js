// A Maldição: de tempos em tempos o servidor sorteia um convidado que cumpre um castigo de bebida.
//
// QUEM SORTEIA: só o servidor. O agendador chama `tic()` a cada 5 s; o próximo horário fica
// no banco (config 'maldicao'). Cada sorteio automático tem a chave "auto:<horário previsto>",
// única na tabela: dois processos ou dois tics no mesmo instante geram UM sorteio só.
// O sorteio manual do admin usa "manual:<id do clique>": clique duplo também não duplica.
//
// FASES NO TELÃO (relativas a `sorteadaEm`, pelo relógio do servidor):
//   0–4 s alerta · 4–9 s suspense (roleta) · 9 s revelação · 9–69 s contagem para cumprir.
// Um telão que reconecta no meio pega a fase certa sem tocar o som de novo.
//
// PONTOS: só quando o admin confirma que cumpriu (+500; no castigo duplo, os dois).
//
// MODO TESTE: com a atividade "Em teste", só os testadores são sorteados e tudo fica marcado
// (some no "Apagar dados de teste").

const crypto = require('crypto');
const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const pontos = require('./pontos');
const { ErroValidacao } = require('./convidados');
const { CASTIGOS, INTENSIDADES, PONTOS_MALDICAO } = require('../jogos/conteudo');

const FASES = { alerta: 4000, suspense: 5000, cumprir: 60000 };
const DURACAO_TOTAL = FASES.alerta + FASES.suspense + FASES.cumprir;
const MINUTO = 60 * 1000;

async function config() {
  const padrao = { ligada: false, intensidade: 'moderado', minMin: 20, maxMin: 30, proximaEm: null };
  return { ...padrao, ...((await festa.ler('maldicao')) || {}) };
}

const sortearEntre = (min, max) => min + crypto.randomInt(0, Math.max(1, max - min + 1));
function proximoHorario(cfg, agora) {
  const min = Math.max(1, Number(cfg.minMin)); const max = Math.max(min, Number(cfg.maxMin));
  return agora + sortearEntre(min * MINUTO, max * MINUTO);
}

async function configurar({ ligada, intensidade, minMin, maxMin }, agora = Date.now()) {
  const cfg = await config();
  const novo = { ...cfg };
  if (intensidade !== undefined) {
    if (!INTENSIDADES[intensidade]) throw new ErroValidacao('Intensidade inválida.');
    novo.intensidade = intensidade;
    novo.minMin = INTENSIDADES[intensidade].minMin;
    novo.maxMin = INTENSIDADES[intensidade].maxMin;
  }
  if (minMin !== undefined || maxMin !== undefined) {
    const a = Number(minMin ?? novo.minMin); const b = Number(maxMin ?? novo.maxMin);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 2 || b > 180 || a > b) throw new ErroValidacao('Intervalo inválido (de 2 a 180 minutos, mínimo ≤ máximo).');
    novo.minMin = a; novo.maxMin = b;
  }
  if (ligada !== undefined) novo.ligada = ligada === true;
  // Ligou agora ou mudou o ritmo: o próximo sorteio é recalculado a partir de agora.
  if (novo.ligada && (!cfg.ligada || intensidade !== undefined || minMin !== undefined || maxMin !== undefined)) {
    novo.proximaEm = proximoHorario(novo, agora);
  }
  if (!novo.ligada) novo.proximaEm = null;
  await festa.gravar('maldicao', novo);
  return novo;
}

async function elegiveis(soTestadores = false) {
  return banco.tudo(`SELECT id, nome, avatar FROM convidados WHERE ativo = 1 AND fora = 0 AND avatar IS NOT NULL${soTestadores ? ' AND testador = 1' : ''}`);
}

function escolherCastigo(temParceiro) {
  const opcoes = CASTIGOS.filter((c) => !c.duplo || temParceiro);
  return opcoes[crypto.randomInt(0, opcoes.length)];
}

// Sorteia agora. Retorna o registro (ou o já existente com a mesma chave).
async function sortear({ origem, chave, agora = Date.now() }) {
  const existente = await banco.um('SELECT id FROM maldicoes WHERE chave = ?', [chave]);
  if (existente) return { repetido: true, maldicao: await buscar(Number(existente.id)) };
  const teste = await atividades.emTeste('maldicao');
  const pessoas = await elegiveis(teste);
  if (!pessoas.length) throw new ErroValidacao(teste ? 'Em teste só os testadores são sorteados, e nenhum está disponível (marque no admin quem testa).' : 'Ninguém disponível para sortear (todos fora ou sem monstro).', 409);
  // Quem foi amaldiçoado por último não é sorteado de novo em seguida (se houver outra opção).
  const ultimo = await banco.um("SELECT convidado_id FROM maldicoes WHERE estado != 'cancelada' ORDER BY id DESC LIMIT 1");
  const candidatos = pessoas.length > 1 && ultimo ? pessoas.filter((p) => p.id !== ultimo.convidado_id) : pessoas;
  const alvo = candidatos[crypto.randomInt(0, candidatos.length)];
  const outros = pessoas.filter((p) => p.id !== alvo.id);
  const castigo = escolherCastigo(outros.length > 0);
  const parceiro = castigo.duplo ? outros[crypto.randomInt(0, outros.length)] : null;
  const texto = castigo.texto.replace('{a}', alvo.nome).replace('{b}', parceiro ? parceiro.nome : '');
  const r = await banco.rodar(
    `INSERT OR IGNORE INTO maldicoes (convidado_id, parceiro_id, castigo, estado, origem, chave, sorteada_em, teste)
     VALUES (?, ?, ?, 'sorteada', ?, ?, ?, ?)`,
    [alvo.id, parceiro ? parceiro.id : null, texto, origem, chave, agora, teste ? 1 : 0]);
  const linha = await banco.um('SELECT id FROM maldicoes WHERE chave = ?', [chave]);
  return { repetido: !r.rowsAffected, maldicao: await buscar(Number(linha.id)) };
}

async function buscar(id) {
  const l = await banco.um(
    `SELECT m.*, c.nome, c.avatar, p.nome AS parceiro_nome, p.avatar AS parceiro_avatar
       FROM maldicoes m JOIN convidados c ON c.id = m.convidado_id LEFT JOIN convidados p ON p.id = m.parceiro_id
      WHERE m.id = ?`, [id]);
  if (!l) return null;
  return {
    id: Number(l.id), convidadoId: l.convidado_id, nome: l.nome, avatar: l.avatar,
    parceiro: l.parceiro_id ? { id: l.parceiro_id, nome: l.parceiro_nome, avatar: l.parceiro_avatar } : null,
    castigo: l.castigo, estado: l.estado, origem: l.origem, sorteadaEm: Number(l.sorteada_em),
    resolvidaEm: l.resolvida_em != null ? Number(l.resolvida_em) : null, teste: Boolean(Number(l.teste)),
  };
}

// O que o telão precisa para a animação (a roleta usa monstros de quem está na festa).
async function paraTelao(m) {
  const pessoas = await elegiveis(m.teste);
  const roleta = pessoas.map((p) => p.avatar);
  for (let i = roleta.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [roleta[i], roleta[j]] = [roleta[j], roleta[i]]; }
  return {
    id: m.id, sorteadaEm: m.sorteadaEm, fases: FASES, nome: m.nome, avatar: m.avatar, castigo: m.castigo,
    parceiro: m.parceiro ? { nome: m.parceiro.nome, avatar: m.parceiro.avatar } : null,
    estado: m.estado, roleta: roleta.slice(0, 18), pontos: PONTOS_MALDICAO,
  };
}

// A maldição "em cena": a última sorteada ainda não resolvida, até 2 min depois do fim da contagem.
async function atual(agora = Date.now()) {
  const l = await banco.um("SELECT id FROM maldicoes WHERE estado = 'sorteada' AND sorteada_em > ? ORDER BY sorteada_em DESC, id DESC LIMIT 1",
    [agora - DURACAO_TOTAL - 2 * MINUTO]);
  return l ? paraTelao(await buscar(Number(l.id))) : null;
}

async function resolver(id, estado, agora = Date.now()) {
  if (!['cumprida', 'cancelada'].includes(estado)) throw new ErroValidacao('Estado inválido.');
  const m = await buscar(Number(id));
  if (!m) throw new ErroValidacao('Maldição não encontrada.', 404);
  if (m.estado !== 'sorteada') return { jaResolvida: true, maldicao: m };
  const r = await banco.rodar("UPDATE maldicoes SET estado = ?, resolvida_em = ? WHERE id = ? AND estado = 'sorteada'", [estado, agora, m.id]);
  if (r.rowsAffected && estado === 'cumprida') {
    for (const pessoa of [m.convidadoId, m.parceiro && m.parceiro.id].filter(Boolean)) {
      await pontos.conceder({ convidadoId: pessoa, atividade: 'maldicao', pontos: PONTOS_MALDICAO,
        motivo: 'Cumpriu a maldição', chave: `maldicao:${m.id}:${pessoa}`, teste: m.teste });
    }
  }
  return { jaResolvida: !r.rowsAffected, maldicao: await buscar(m.id) };
}

async function historico(limite = 30) {
  const ids = await banco.tudo('SELECT id FROM maldicoes ORDER BY sorteada_em DESC, id DESC LIMIT ?', [limite]);
  return Promise.all(ids.map((l) => buscar(Number(l.id))));
}

async function paraAdmin(agora = Date.now()) {
  const [cfg, uso, lista, contagem] = await Promise.all([
    config(), atividades.emUso('maldicao', agora), historico(),
    banco.tudo("SELECT c.nome, COUNT(*) AS n FROM maldicoes m JOIN convidados c ON c.id = m.convidado_id WHERE m.estado != 'cancelada' GROUP BY c.id, c.nome ORDER BY n DESC LIMIT 5"),
  ]);
  return {
    config: cfg, liberada: uso.ativa, emTeste: uso.teste, intensidades: INTENSIDADES, pontos: PONTOS_MALDICAO, fases: FASES,
    historico: lista, maisAmaldicoados: contagem.map((l) => ({ nome: l.nome, n: Number(l.n) })),
  };
}

// Chamado pelo agendador. Devolve a maldição sorteada agora (para avisar telão/celular) ou null.
async function tic(agora = Date.now()) {
  const cfg = await config();
  if (!cfg.ligada) return null;
  if (!(await atividades.emUso('maldicao', agora)).ativa) return null;
  if (cfg.proximaEm == null) { await festa.gravar('maldicao', { ...cfg, proximaEm: proximoHorario(cfg, agora) }); return null; }
  if (agora < Number(cfg.proximaEm)) return null;
  const previsto = Number(cfg.proximaEm);
  let resultado = null;
  try {
    resultado = await sortear({ origem: 'auto', chave: `auto:${previsto}`, agora });
  } catch (erro) {
    if (erro.status !== 409) throw erro; // ninguém disponível: tenta no próximo intervalo
  }
  // Próximo horário: só avança se ninguém avançou antes (compare-and-swap no JSON da config).
  const atualCfg = await config();
  if (Number(atualCfg.proximaEm) === previsto) await festa.gravar('maldicao', { ...atualCfg, proximaEm: proximoHorario(atualCfg, agora) });
  return resultado && !resultado.repetido ? resultado.maldicao : null;
}

module.exports = { FASES, config, configurar, sortear, buscar, paraTelao, atual, resolver, historico, paraAdmin, tic, elegiveis };
