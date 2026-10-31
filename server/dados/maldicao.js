// A Maldição: de tempos em tempos o servidor sorteia um convidado que cumpre um castigo de bebida.
//
// QUEM SORTEIA: só o servidor. O agendador chama `tic()` a cada 5 s; o próximo horário fica
// no banco (config 'maldicao'). Cada sorteio automático tem a chave "auto:<horário previsto>",
// única na tabela: dois processos ou dois tics no mesmo instante geram UM sorteio só.
// O sorteio manual do admin usa "manual:<id do clique>": clique duplo também não duplica.
//
// FASES NO TELÃO (relativas a `sorteadaEm`, pelo relógio do servidor):
//   0–4 s alerta · 4–9 s suspense (roleta) · 9 s revelação · 9–69 s contagem para cumprir.
//   Desafio de foto: 120 s para cumprir; depois de alguns segundos da revelação o telão abre o Mural
//   esperando a foto da pessoa (a foto que ela mandar fica ligada à maldição em foto_id).
// Um telão que reconecta no meio pega a fase certa sem tocar o som de novo.
//
// PONTOS: sorteado (e parceiro) perde 300 na hora. Cumpriu: +1300 (saldo +1000). Não cumpriu: −300 a mais (saldo −600).
// Não está presente / anular: devolve tudo.
// COLETIVA: todos participam; o organizador marca o último (−400, 2 shots) e o penúltimo (−200, 1 shot).
//
// MODO TESTE: com a atividade "Em teste", só os testadores são sorteados e tudo fica marcado
// (some no "Apagar dados de teste").

const crypto = require('crypto');
const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const pontos = require('./pontos');
const { ErroValidacao } = require('./convidados');
const { CASTIGOS, INTENSIDADES, PONTOS_MALDICAO, PONTOS_MALDICAO_FALHOU, PONTOS_MALDICAO_CUMPRIU, PONTOS_GRUPO, MIN_GRUPO, AUSENTE_MIN } = require('../jogos/conteudo');
const numero = (n) => Math.abs(n).toLocaleString('pt-BR');

const FASES = { alerta: 4000, suspense: 7000, cumprir: 60000 }; // suspense: a roleta de nomes no telão
// Desafio de foto: 2 minutos para tirar, mandar no Mural e beber.
const FASES_FOTO = { ...FASES, cumprir: 120000 };
const fasesDe = (m) => (m && m.foto ? FASES_FOTO : FASES);
const DURACAO_TOTAL = FASES_FOTO.alerta + FASES_FOTO.suspense + FASES_FOTO.cumprir; // a mais longa
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

// Quem pode ser sorteado: ativo, não está "fora", tem monstro, e não foi marcado "não está presente" há pouco.
async function elegiveis(soTestadores = false, agora = Date.now()) {
  return banco.tudo(`SELECT id, nome, avatar, testador FROM convidados WHERE ativo = 1 AND fora = 0 AND avatar IS NOT NULL${soTestadores ? ' AND testador = 1' : ''}
    AND id NOT IN (SELECT convidado_id FROM maldicoes WHERE ausente = 1 AND resolvida_em > ?)`, [agora - AUSENTE_MIN * MINUTO]);
}

function escolherCastigo(temParceiro, podeFoto, podeGrupo, preferido = null) {
  const fixo = preferido && CASTIGOS.find((c) => c.id === preferido);
  if (fixo && (!fixo.duplo || temParceiro) && (!fixo.foto || podeFoto) && !fixo.grupo) return fixo;
  const opcoes = CASTIGOS.filter((c) => (!c.duplo || temParceiro) && (!c.foto || podeFoto) && (!c.grupo || podeGrupo));
  return opcoes[crypto.randomInt(0, opcoes.length)];
}

// Sorteia agora. Retorna o registro (ou o já existente com a mesma chave).
async function sortear({ origem, chave, agora = Date.now(), castigoId = null }) {
  const existente = await banco.um('SELECT id FROM maldicoes WHERE chave = ?', [chave]);
  if (existente) return { repetido: true, maldicao: await buscar(Number(existente.id)) };
  const teste = await atividades.emTeste('maldicao');
  const pessoas = await elegiveis(teste, agora);
  if (!pessoas.length) throw new ErroValidacao(teste ? 'Em teste só os testadores são sorteados, e nenhum está disponível (marque no admin quem testa).' : 'Ninguém disponível para sortear (todos fora ou sem monstro).', 409);
  // Quem foi amaldiçoado por último não é sorteado de novo em seguida (se houver outra opção).
  const ultimo = await banco.um("SELECT convidado_id FROM maldicoes WHERE estado != 'cancelada' ORDER BY id DESC LIMIT 1");
  const candidatos = pessoas.length > 1 && ultimo ? pessoas.filter((p) => p.id !== ultimo.convidado_id) : pessoas;
  const alvo = candidatos[crypto.randomInt(0, candidatos.length)];
  const outros = pessoas.filter((p) => p.id !== alvo.id);
  // Desafio de foto só se o Mural estiver aberto para essa pessoa.
  const podeFoto = (await atividades.acesso('correio', alvo, agora)).liberada;
  const castigo = escolherCastigo(outros.length > 0, podeFoto, pessoas.length >= MIN_GRUPO, castigoId);
  const parceiro = castigo.duplo ? outros[crypto.randomInt(0, outros.length)] : null;
  const texto = castigo.texto.replace('{a}', alvo.nome).replace('{b}', parceiro ? parceiro.nome : '')
    .replace('{u}', numero(PONTOS_GRUPO.ultimo)).replace('{p}', numero(PONTOS_GRUPO.penultimo));
  const r = await banco.rodar(
    `INSERT OR IGNORE INTO maldicoes (convidado_id, parceiro_id, castigo, estado, origem, chave, sorteada_em, teste, foto, grupo, castigo_id)
     VALUES (?, ?, ?, 'sorteada', ?, ?, ?, ?, ?, ?, ?)`,
    [alvo.id, parceiro ? parceiro.id : null, texto, origem, chave, agora, teste ? 1 : 0, castigo.foto ? 1 : 0, castigo.grupo ? 1 : 0, castigo.id]);
  const linha = await banco.um('SELECT id FROM maldicoes WHERE chave = ?', [chave]);
  const m = await buscar(Number(linha.id));
  // Perde na hora (quem foi sorteado e o parceiro). Na coletiva, perde quem for o último/penúltimo.
  if (r.rowsAffected && !m.grupo) {
    for (const pessoa of [m.convidadoId, m.parceiro && m.parceiro.id].filter(Boolean)) {
      await pontos.conceder({ convidadoId: pessoa, atividade: 'maldicao', pontos: PONTOS_MALDICAO,
        motivo: 'Amaldiçoado', chave: `maldicao:${m.id}:${pessoa}`, teste: m.teste });
    }
  }
  return { repetido: !r.rowsAffected, maldicao: m };
}

async function buscar(id) {
  const l = await banco.um(
    `SELECT m.*, c.nome, c.avatar, p.nome AS parceiro_nome, p.avatar AS parceiro_avatar,
            u.nome AS ultimo_nome, u.avatar AS ultimo_avatar, pu.nome AS penultimo_nome, pu.avatar AS penultimo_avatar
       FROM maldicoes m JOIN convidados c ON c.id = m.convidado_id LEFT JOIN convidados p ON p.id = m.parceiro_id
       LEFT JOIN convidados u ON u.id = m.ultimo_id LEFT JOIN convidados pu ON pu.id = m.penultimo_id
      WHERE m.id = ?`, [id]);
  if (!l) return null;
  return {
    id: Number(l.id), convidadoId: l.convidado_id, nome: l.nome, avatar: l.avatar,
    parceiro: l.parceiro_id ? { id: l.parceiro_id, nome: l.parceiro_nome, avatar: l.parceiro_avatar } : null,
    castigo: l.castigo, estado: l.estado, origem: l.origem, sorteadaEm: Number(l.sorteada_em),
    resolvidaEm: l.resolvida_em != null ? Number(l.resolvida_em) : null, teste: Boolean(Number(l.teste)),
    foto: Boolean(Number(l.foto)), fotoId: l.foto_id != null ? Number(l.foto_id) : null,
    grupo: Boolean(Number(l.grupo)), falhou: Boolean(Number(l.falhou)), ausente: Boolean(Number(l.ausente)), castigoId: l.castigo_id || null,
    ultimo: l.ultimo_id ? { id: l.ultimo_id, nome: l.ultimo_nome, avatar: l.ultimo_avatar } : null,
    penultimo: l.penultimo_id ? { id: l.penultimo_id, nome: l.penultimo_nome, avatar: l.penultimo_avatar } : null,
  };
}

// O que o telão precisa para a animação (a roleta usa monstros de quem está na festa).
async function paraTelao(m) {
  // Roleta de nomes do telão: quem está na festa (sem o sorteado, que entra só no fim, onde ela para).
  const pessoas = (await elegiveis(m.teste)).filter((p) => p.id !== m.convidadoId);
  const roleta = pessoas.map((p) => ({ nome: p.nome, avatar: p.avatar }));
  for (let i = roleta.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [roleta[i], roleta[j]] = [roleta[j], roleta[i]]; }
  return {
    id: m.id, sorteadaEm: m.sorteadaEm, fases: fasesDe(m), foto: m.foto, fotoId: m.fotoId, nome: m.nome, avatar: m.avatar, castigo: m.castigo,
    parceiro: m.parceiro ? { nome: m.parceiro.nome, avatar: m.parceiro.avatar } : null,
    estado: m.estado, roleta: roleta.slice(0, 30), pontos: PONTOS_MALDICAO, falhouPontos: PONTOS_MALDICAO_FALHOU, cumpriuPontos: PONTOS_MALDICAO_CUMPRIU,
    grupo: m.grupo, pontosGrupo: PONTOS_GRUPO, falhou: m.falhou,
    ultimo: m.ultimo ? { nome: m.ultimo.nome, avatar: m.ultimo.avatar } : null,
    penultimo: m.penultimo ? { nome: m.penultimo.nome, avatar: m.penultimo.avatar } : null,
  };
}

// A maldição "em cena": a última sorteada ainda não resolvida, até 2 min depois do fim da contagem.
async function atual(agora = Date.now()) {
  const l = await banco.um("SELECT id FROM maldicoes WHERE estado = 'sorteada' AND sorteada_em > ? ORDER BY sorteada_em DESC, id DESC LIMIT 1",
    [agora - DURACAO_TOTAL - 2 * MINUTO]);
  return l ? paraTelao(await buscar(Number(l.id))) : null;
}

// Resolver:
//   'cumprida'  → cumpriu: +1300 (recupera os 300 do sorteio e ganha +1000)
//   'falhou'    → não cumpriu: perde mais 300
//   'cancelada' → sorteio anulado: devolve o que perdeu
//   coletiva    → 'cumprida' com { ultimo, penultimo }: eles perdem 400 e 200
async function resolver(id, estado, { ultimo = null, penultimo = null } = {}, agora = Date.now()) {
  if (!['cumprida', 'cancelada', 'falhou', 'ausente'].includes(estado)) throw new ErroValidacao('Estado inválido.');
  const m = await buscar(Number(id));
  if (!m) throw new ErroValidacao('Maldição não encontrada.', 404);
  if (m.estado !== 'sorteada') return { jaResolvida: true, maldicao: m };
  if (m.grupo && estado === 'cumprida') {
    if (!ultimo) throw new ErroValidacao('Marque quem foi o último.');
    if (penultimo && penultimo === ultimo) throw new ErroValidacao('Último e penúltimo precisam ser pessoas diferentes.');
    const ids = [ultimo, penultimo].filter(Boolean);
    const achados = await banco.tudo(`SELECT id FROM convidados WHERE ativo = 1 AND id IN (${ids.map(() => '?').join(',')})`, ids);
    if (achados.length !== ids.length) throw new ErroValidacao('Convidado não encontrado.', 404);
  }
  if (estado === 'ausente' && m.grupo) throw new ErroValidacao('Na maldição coletiva não tem uma pessoa só: use Anular.', 409);
  const final = estado === 'falhou' ? 'cumprida' : estado === 'ausente' ? 'cancelada' : estado;
  const r = await banco.rodar(
    "UPDATE maldicoes SET estado = ?, resolvida_em = ?, falhou = ?, ausente = ?, ultimo_id = ?, penultimo_id = ? WHERE id = ? AND estado = 'sorteada'",
    [final, agora, estado === 'falhou' ? 1 : 0, estado === 'ausente' ? 1 : 0, m.grupo ? ultimo : null, m.grupo ? penultimo : null, m.id]);
  if (r.rowsAffected) {
    if (final === 'cancelada') await banco.rodar("DELETE FROM pontos_log WHERE chave LIKE ?", [`maldicao:${m.id}:%`]);
    if (estado === 'cumprida' && !m.grupo) {
      for (const pessoa of [m.convidadoId, m.parceiro && m.parceiro.id].filter(Boolean)) {
        await pontos.conceder({ convidadoId: pessoa, atividade: 'maldicao', pontos: PONTOS_MALDICAO_CUMPRIU,
          motivo: 'Cumpriu a maldição', chave: `maldicao:${m.id}:${pessoa}:cumpriu`, teste: m.teste });
      }
    }
    if (estado === 'falhou') {
      for (const pessoa of [m.convidadoId, m.parceiro && m.parceiro.id].filter(Boolean)) {
        await pontos.conceder({ convidadoId: pessoa, atividade: 'maldicao', pontos: PONTOS_MALDICAO_FALHOU,
          motivo: 'Não cumpriu a maldição', chave: `maldicao:${m.id}:${pessoa}:falhou`, teste: m.teste });
      }
    }
    if (m.grupo && estado === 'cumprida') {
      for (const [pessoa, valor, motivo] of [[ultimo, PONTOS_GRUPO.ultimo, 'Último na maldição coletiva'], [penultimo, PONTOS_GRUPO.penultimo, 'Penúltimo na maldição coletiva']]) {
        if (!pessoa) continue;
        await pontos.conceder({ convidadoId: pessoa, atividade: 'maldicao', pontos: valor, motivo, chave: `maldicao:${m.id}:${pessoa}:grupo`, teste: m.teste });
      }
    }
  }
  // Não está presente: ninguém perde e, na mesma hora, outra pessoa é sorteada para o mesmo desafio.
  let nova = null;
  if (r.rowsAffected && estado === 'ausente') {
    try {
      nova = (await sortear({ origem: 'manual', chave: `ausente:${m.id}`, agora: agora + 1, castigoId: m.castigoId })).maldicao;
    } catch (e) { if (!(e instanceof ErroValidacao)) throw e; } // ninguém mais disponível: só cancela
  }
  return { jaResolvida: !r.rowsAffected, maldicao: await buscar(m.id), nova };
}

async function historico(limite = 30) {
  const ids = await banco.tudo('SELECT id FROM maldicoes ORDER BY sorteada_em DESC, id DESC LIMIT ?', [limite]);
  return Promise.all(ids.map((l) => buscar(Number(l.id))));
}

async function paraAdmin(agora = Date.now()) {
  const [cfg, uso, lista, contagem] = await Promise.all([
    config(), atividades.emUso('maldicao', agora), historico(),
    banco.tudo("SELECT c.nome, COUNT(*) AS n FROM maldicoes m JOIN convidados c ON c.id = m.convidado_id WHERE m.estado != 'cancelada' AND m.grupo = 0 GROUP BY c.id, c.nome ORDER BY n DESC LIMIT 5"),
  ]);
  return {
    config: cfg, liberada: uso.ativa, emTeste: uso.teste, intensidades: INTENSIDADES, pontos: PONTOS_MALDICAO, fases: FASES,
    falhouPontos: PONTOS_MALDICAO_FALHOU, cumpriuPontos: PONTOS_MALDICAO_CUMPRIU, pontosGrupo: PONTOS_GRUPO,
    historico: lista, maisAmaldicoados: contagem.map((l) => ({ nome: l.nome, n: Number(l.n) })),
    // Para marcar último/penúltimo da maldição coletiva.
    pessoas: lista.some((x) => x.grupo && x.estado === 'sorteada')
      ? (await elegiveis(uso.teste, agora)).map((p) => ({ id: p.id, nome: p.nome, avatar: p.avatar })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) : [],
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

module.exports = { FASES, FASES_FOTO, fasesDe, DURACAO_TOTAL, config, configurar, sortear, buscar, paraTelao, atual, resolver, historico, paraAdmin, tic, elegiveis };
