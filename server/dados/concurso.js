// Concurso de Fantasia: cada convidado vota em UMA pessoa (não em si mesmo) e pode trocar o voto
// enquanto a votação estiver aberta. O admin encerra e publica: os três mais votados ganham
// 1000 / 800 / 500 pontos. Empate divide a colocação (dois em 1º ganham 1000 cada; o próximo é 3º).
//
// ESTADOS (config 'concurso'): fechado · desfile (telão chama o Desfile Macabro) · aberto · encerrado · publicado.
// PRIVACIDADE: ninguém vê a contagem antes de publicar (só o admin). Os outros aparecem por um
// apelido opaco, nunca pelo id interno.
//
// MODO TESTE: com a atividade "Em teste", só testadores votam; votos e pontos ficam marcados e o
// "Apagar dados de teste" fecha a votação de novo.

const crypto = require('crypto');
const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const pontos = require('./pontos');
const convidados = require('./convidados');
const { ErroValidacao } = convidados;
const { PONTOS_CONCURSO } = require('../jogos/conteudo');

const apelido = (id) => `f${crypto.createHash('sha256').update(`pv-concurso:${id}`).digest('hex').slice(0, 12)}`;

async function config() {
  return { estado: 'fechado', teste: false, ...((await festa.ler('concurso')) || {}) };
}

async function contagem() {
  const linhas = await banco.tudo(
    `SELECT v.candidato_id AS id, c.nome, c.avatar, COUNT(*) AS votos FROM concurso_votos v
       JOIN convidados c ON c.id = v.candidato_id AND c.ativo = 1
      GROUP BY v.candidato_id, c.nome, c.avatar ORDER BY votos DESC, c.nome COLLATE NOCASE`);
  let anterior = null;
  let posicao = 0;
  return linhas.map((l, i) => {
    const v = Number(l.votos);
    if (v !== anterior) { posicao = i + 1; anterior = v; }
    return { id: l.id, nome: l.nome, avatar: l.avatar, votos: v, posicao, pontos: PONTOS_CONCURSO[posicao - 1] || 0 };
  });
}

const podio = (lista) => lista.filter((x) => x.pontos > 0).map((x) => ({ nome: x.nome, avatar: x.avatar, votos: x.votos, posicao: x.posicao, pontos: x.pontos }));

async function paraConvidado(euId) {
  const [cfg, pessoas, meu] = await Promise.all([
    config(), convidados.confirmados(), banco.um('SELECT candidato_id FROM concurso_votos WHERE eleitor_id = ?', [euId]),
  ]);
  const saida = {
    estado: cfg.estado, premios: PONTOS_CONCURSO,
    meuVoto: meu ? apelido(meu.candidato_id) : null,
    candidatos: pessoas.map((c) => ({ id: apelido(c.id), nome: c.nome, avatar: c.avatar, souEu: c.id === euId })),
  };
  if (cfg.estado === 'publicado') saida.podio = podio(await contagem());
  return saida;
}

async function votar(eu, candidatoApelido, agora = Date.now()) {
  const { liberada, teste } = await atividades.acesso('concurso', eu, agora);
  if (!liberada) throw new ErroValidacao('O Concurso de Fantasia ainda não está aberto.', 403);
  const cfg = await config();
  if (cfg.estado !== 'aberto') throw new ErroValidacao(['fechado', 'desfile'].includes(cfg.estado) ? 'A votação ainda não começou.' : 'A votação já fechou.', 409);
  const alvo = (await convidados.confirmados()).find((c) => apelido(c.id) === String(candidatoApelido));
  if (!alvo) throw new ErroValidacao('Escolha uma pessoa da lista.');
  if (alvo.id === eu.id) throw new ErroValidacao('Não vale votar em você mesmo. 😉');
  await banco.rodar(
    `INSERT INTO concurso_votos (eleitor_id, candidato_id, votado_em, teste) VALUES (?, ?, ?, ?)
     ON CONFLICT(eleitor_id) DO UPDATE SET candidato_id = excluded.candidato_id, votado_em = excluded.votado_em, teste = excluded.teste`,
    [eu.id, alvo.id, agora, teste ? 1 : 0]);
}

// ------------------------------------------------------------------ admin
async function paraAdmin(agora = Date.now()) {
  const [cfg, lista, eleitores, uso] = await Promise.all([
    config(), contagem(), banco.um('SELECT COUNT(*) AS n FROM concurso_votos'), atividades.emUso('concurso', agora),
  ]);
  return { ...cfg, premios: PONTOS_CONCURSO, liberada: uso.ativa, emTeste: uso.teste, eleitores: Number(eleitores.n), contagem: lista };
}

async function mudar(estado, agora = Date.now()) {
  const uso = await atividades.emUso('concurso', agora);
  const cfg = await config();
  if (estado === 'desfile') {
    if (!uso.ativa) throw new ErroValidacao('Libere o Concurso (ou coloque "Em teste") na aba Atividades antes do desfile.', 409);
    if (cfg.estado !== 'fechado' && cfg.estado !== 'desfile') throw new ErroValidacao('A votação já começou.', 409);
  }
  if (estado === 'aberto') {
    if (!uso.ativa) throw new ErroValidacao('Libere o Concurso (ou coloque "Em teste") na aba Atividades antes de abrir a votação.', 409);
    if (cfg.estado === 'publicado') throw new ErroValidacao('O resultado já foi publicado. Despublique antes de reabrir.', 409);
  }
  if (estado === 'encerrado' && cfg.estado !== 'aberto') throw new ErroValidacao('A votação não está aberta.', 409);
  await festa.gravar('concurso', { ...cfg, estado, teste: cfg.teste || uso.teste });
  // Desfile e votação aparecem no telão sozinhos.
  if (estado === 'desfile' || estado === 'aberto') await festa.definirTelao({ modo: 'concurso' });
}

async function publicar() {
  const cfg = await config();
  if (cfg.estado !== 'encerrado') throw new ErroValidacao('Encerre a votação antes de publicar.', 409);
  const lista = await contagem();
  const teste = cfg.teste || (await atividades.emTeste('concurso'));
  await banco.transacao(async (tx) => {
    await tx.execute({ sql: "DELETE FROM pontos_log WHERE atividade = 'concurso'", args: [] });
    for (const x of lista.filter((y) => y.pontos > 0)) {
      await pontos.conceder({ convidadoId: x.id, atividade: 'concurso', pontos: x.pontos,
        motivo: `Concurso de Fantasia: ${x.posicao}º lugar (${x.votos} ${x.votos === 1 ? 'voto' : 'votos'})`, chave: `concurso:${x.id}`, teste }, tx);
    }
  });
  await festa.gravar('concurso', { ...cfg, estado: 'publicado', teste });
  await festa.definirTelao({ modo: 'concurso' });
  return { premiados: lista.filter((y) => y.pontos > 0).length };
}

async function despublicar() {
  const cfg = await config();
  await banco.rodar("DELETE FROM pontos_log WHERE atividade = 'concurso'");
  await festa.gravar('concurso', { ...cfg, estado: 'encerrado' });
}

// ------------------------------------------------------------------ telão
async function paraTelao() {
  const cfg = await config();
  const votos = await banco.um('SELECT COUNT(*) AS n FROM concurso_votos');
  const saida = { estado: cfg.estado, votos: Number(votos.n), premios: PONTOS_CONCURSO };
  if (cfg.estado === 'publicado') saida.podio = podio(await contagem());
  if (cfg.estado === 'desfile') {
    const pessoas = await convidados.confirmados();
    saida.desfile = pessoas.map((c) => ({ avatar: c.avatar, iniciais: c.nome.trim().split(/\s+/).slice(0, 2).map((x) => x[0].toUpperCase()).join('') }));
  }
  return saida;
}

module.exports = { config, paraConvidado, votar, paraAdmin, mudar, publicar, despublicar, paraTelao, apelido };
