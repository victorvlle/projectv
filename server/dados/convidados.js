// Convidados: cadastro (admin), perfil (o próprio convidado) e consultas públicas.

const crypto = require('crypto');
const banco = require('./banco');
const { gerarCodigo, codigoValido } = require('../seguranca');
const { avatarValido } = require('../avatares');

class ErroValidacao extends Error {
  constructor(mensagem, status = 400) { super(mensagem); this.status = status; this.publico = true; }
}

function limparTexto(t, max) {
  return String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validarNome(nome) {
  const n = limparTexto(nome, 60);
  if (n.length < 2) throw new ErroValidacao('O nome precisa ter pelo menos 2 letras.');
  return n;
}

// O nome que aparece para todo mundo é o que o organizador cadastrou: o convidado
// não digita nome nem apelido, só escolhe o monstro. (A coluna `apelido` ficou
// no banco por compatibilidade e não é mais usada.)

// Linha do banco -> objeto para o próprio convidado ou para o admin.
function paraAdmin(l) {
  return {
    id: l.id,
    nome: l.nome,
    avatar: l.avatar,
    codigo: l.codigo,
    ativo: Boolean(l.ativo),
    fora: Boolean(l.fora),
    perfilCompleto: Boolean(l.avatar),
    primeiroAcessoEm: l.primeiro_acesso_em,
    criadoEm: l.criado_em,
    pontos: Number(l.pontos ?? 0),
  };
}

function paraProprio(l) {
  return {
    id: l.id,
    nome: l.nome,
    avatar: l.avatar,
    perfilCompleto: Boolean(l.avatar),
  };
}

async function criar(nome) {
  const agora = Date.now();
  const id = crypto.randomUUID();
  // Colisão de código é astronomicamente improvável, mas o UNIQUE garante; tenta de novo.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = gerarCodigo();
    try {
      await banco.rodar(
        'INSERT INTO convidados (id, nome, codigo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)',
        [id, validarNome(nome), codigo, agora, agora],
      );
      return buscarPorId(id);
    } catch (erro) {
      if (erro.publico) throw erro;
      if (!/UNIQUE/i.test(erro.message) || tentativa === 4) throw erro;
    }
  }
  return null;
}

async function buscarPorId(id) {
  return banco.um(
    `SELECT c.*, COALESCE((SELECT SUM(pontos) FROM pontos_log p WHERE p.convidado_id = c.id), 0) AS pontos
       FROM convidados c WHERE c.id = ?`,
    [id],
  );
}

async function buscarPorCodigo(codigo) {
  if (!codigoValido(codigo)) return null;
  return banco.um('SELECT * FROM convidados WHERE codigo = ?', [codigo]);
}

async function listarParaAdmin() {
  const linhas = await banco.tudo(
    `SELECT c.*, COALESCE((SELECT SUM(pontos) FROM pontos_log p WHERE p.convidado_id = c.id), 0) AS pontos
       FROM convidados c ORDER BY c.criado_em`,
  );
  return linhas.map(paraAdmin);
}

// O que qualquer convidado pode ver de outro: nome (o cadastrado pelo organizador)
// e monstro, de todo convidado ativo que já escolheu o monstro.
async function confirmados() {
  const linhas = await banco.tudo(
    `SELECT id, nome, avatar FROM convidados
      WHERE ativo = 1 AND avatar IS NOT NULL
      ORDER BY primeiro_acesso_em, criado_em`,
  );
  return linhas.map((l) => ({ id: l.id, nome: l.nome, avatar: l.avatar }));
}

async function totais() {
  const r = await banco.um(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN avatar IS NOT NULL THEN 1 ELSE 0 END) AS com_perfil
       FROM convidados WHERE ativo = 1`,
  );
  return { total: Number(r.total || 0), comPerfil: Number(r.com_perfil || 0) };
}

// O convidado só escolhe o monstro e se quer aparecer na lista. Nome não muda por aqui.
// Todo mundo que escolheu o monstro aparece nos confirmados (não há opção de esconder).
async function atualizarPerfil(id, { avatar }) {
  if (!avatarValido(avatar)) throw new ErroValidacao('Escolha um dos monstros da lista.');
  await banco.rodar(
    `UPDATE convidados SET avatar = ?, exibir = 1, atualizado_em = ?,
            primeiro_acesso_em = COALESCE(primeiro_acesso_em, ?)
      WHERE id = ? AND ativo = 1`,
    [avatar, Date.now(), Date.now(), id],
  );
  return buscarPorId(id);
}

async function marcarAcesso(id) {
  await banco.rodar(
    'UPDATE convidados SET primeiro_acesso_em = COALESCE(primeiro_acesso_em, ?) WHERE id = ?',
    [Date.now(), id],
  );
}

// ------------------------------------------------------------- ações do admin
async function editar(id, campos) {
  const atual = await buscarPorId(id);
  if (!atual) throw new ErroValidacao('Convidado não encontrado.', 404);
  const sets = [];
  const args = [];
  if (campos.nome !== undefined) { sets.push('nome = ?'); args.push(validarNome(campos.nome)); }
  if (campos.avatar !== undefined) {
    if (campos.avatar !== null && !avatarValido(campos.avatar)) throw new ErroValidacao('Avatar inválido.');
    sets.push('avatar = ?'); args.push(campos.avatar);
  }
  for (const flag of ['ativo', 'fora']) {
    if (campos[flag] !== undefined) { sets.push(`${flag} = ?`); args.push(campos[flag] ? 1 : 0); }
  }
  if (!sets.length) return atual;
  // Desativar também derruba as sessões abertas.
  if (campos.ativo === false) sets.push('sessao_versao = sessao_versao + 1');
  sets.push('atualizado_em = ?'); args.push(Date.now());
  await banco.rodar(`UPDATE convidados SET ${sets.join(', ')} WHERE id = ?`, [...args, id]);
  return buscarPorId(id);
}

// Link novo: código novo e sessões antigas invalidadas (o link repassado para de funcionar).
async function regenerarLink(id) {
  const atual = await buscarPorId(id);
  if (!atual) throw new ErroValidacao('Convidado não encontrado.', 404);
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      await banco.rodar(
        'UPDATE convidados SET codigo = ?, sessao_versao = sessao_versao + 1, atualizado_em = ? WHERE id = ?',
        [gerarCodigo(), Date.now(), id],
      );
      return buscarPorId(id);
    } catch (erro) {
      if (!/UNIQUE/i.test(erro.message) || tentativa === 4) throw erro;
    }
  }
  return null;
}

async function excluir(id) {
  const r = await banco.lote([
    { sql: 'DELETE FROM bebidas_compromissos WHERE convidado_id = ?', args: [id] },
    { sql: 'DELETE FROM pontos_log WHERE convidado_id = ?', args: [id] },
    { sql: 'DELETE FROM playlist_votos WHERE convidado_id = ? OR musica_id IN (SELECT id FROM playlist_musicas WHERE convidado_id = ?)', args: [id, id] },
    { sql: 'DELETE FROM playlist_musicas WHERE convidado_id = ?', args: [id] },
    { sql: 'DELETE FROM caronas_reservas WHERE convidado_id = ? OR carona_id IN (SELECT id FROM caronas WHERE motorista_id = ?)', args: [id, id] },
    { sql: 'DELETE FROM caronas WHERE motorista_id = ?', args: [id] },
    { sql: 'DELETE FROM pos_votos WHERE convidado_id = ?', args: [id] },
    { sql: 'DELETE FROM convidados WHERE id = ?', args: [id] },
  ]);
  if (!r[r.length - 1].rowsAffected) throw new ErroValidacao('Convidado não encontrado.', 404);
}

module.exports = {
  ErroValidacao, limparTexto,
  criar, buscarPorId, buscarPorCodigo, listarParaAdmin, confirmados, totais,
  atualizarPerfil, marcarAcesso, editar, regenerarLink, excluir,
  paraAdmin, paraProprio,
};
