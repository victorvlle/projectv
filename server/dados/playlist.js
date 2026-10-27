// Playlist da Noite: cada convidado sugere até 5 músicas e vota nas que quiser.
// Música repetida (mesmo título e artista, ignorando acentos e maiúsculas) não
// duplica: a sugestão vira um voto na que já existe.

const banco = require('./banco');
const { ErroValidacao, limparTexto } = require('./convidados');

const MAX_SUGESTOES = 5;

function chaveDe(titulo, artista) {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${norm(titulo)}|${norm(artista)}`;
}

function validar(texto, campo) {
  const v = limparTexto(texto, 60);
  if (v.length < 1) throw new ErroValidacao(`Informe ${campo}.`);
  return v;
}

async function listar(euId) {
  const linhas = await banco.tudo(
    `SELECT m.id, m.titulo, m.artista, m.convidado_id, m.criado_em, c.nome AS autor, c.avatar AS autor_avatar,
            (SELECT COUNT(*) FROM playlist_votos v JOIN convidados cv ON cv.id = v.convidado_id AND cv.ativo = 1
              WHERE v.musica_id = m.id AND v.convidado_id <> m.convidado_id) AS votos,
            EXISTS (SELECT 1 FROM playlist_votos v WHERE v.musica_id = m.id AND v.convidado_id = ?) AS votei
       FROM playlist_musicas m JOIN convidados c ON c.id = m.convidado_id
      WHERE c.ativo = 1
      ORDER BY votos DESC, m.criado_em ASC`,
    [euId || ''],
  );
  const musicas = linhas.map((l) => ({
    id: Number(l.id), titulo: l.titulo, artista: l.artista,
    autor: l.autor, autorAvatar: l.autor_avatar, minha: l.convidado_id === euId,
    votos: Number(l.votos), votei: Boolean(l.votei),
  }));
  return { musicas, minhas: musicas.filter((m) => m.minha).length, max: MAX_SUGESTOES };
}

async function sugerir(convidadoId, { titulo, artista }) {
  const t = validar(titulo, 'o nome da música');
  const a = validar(artista, 'o artista');
  const chave = chaveDe(t, a);
  if (chave.length < 3) throw new ErroValidacao('Escreva o nome da música e do artista.');
  const existente = await banco.um('SELECT id, convidado_id FROM playlist_musicas WHERE chave = ?', [chave]);
  if (existente) {
    // Quem sugeriu não vota na própria música.
    if (existente.convidado_id === convidadoId) throw new ErroValidacao('Você já sugeriu essa música.');
    await banco.rodar('INSERT OR IGNORE INTO playlist_votos (musica_id, convidado_id, criado_em) VALUES (?, ?, ?)',
      [existente.id, convidadoId, Date.now()]);
    return { jaExistia: true };
  }
  const r = await banco.um('SELECT COUNT(*) AS n FROM playlist_musicas WHERE convidado_id = ?', [convidadoId]);
  if (Number(r.n) >= MAX_SUGESTOES) throw new ErroValidacao(`Você já sugeriu ${MAX_SUGESTOES} músicas. Tire uma para sugerir outra.`);
  let novo;
  try {
    novo = await banco.rodar('INSERT INTO playlist_musicas (convidado_id, titulo, artista, chave, criado_em) VALUES (?, ?, ?, ?, ?)',
      [convidadoId, t, a, chave, Date.now()]);
  } catch (erro) {
    if (/UNIQUE/i.test(erro.message)) return sugerir(convidadoId, { titulo, artista }); // corrida: vira voto
    throw erro;
  }
  await require('./colaboracao').musicaAdicionada(convidadoId, Number(novo.lastInsertRowid), t);
  await require('../notificacoes').evento('musica', convidadoId);
  return { jaExistia: false };
}

async function votar(convidadoId, musicaId, quer) {
  const m = await banco.um('SELECT id, convidado_id FROM playlist_musicas WHERE id = ?', [Number(musicaId)]);
  if (!m) throw new ErroValidacao('Essa música não está mais na lista.', 404);
  if (quer && m.convidado_id === convidadoId) throw new ErroValidacao('Você não pode votar na música que você sugeriu.', 403);
  if (quer) {
    await banco.rodar('INSERT OR IGNORE INTO playlist_votos (musica_id, convidado_id, criado_em) VALUES (?, ?, ?)', [m.id, convidadoId, Date.now()]);
  } else {
    await banco.rodar('DELETE FROM playlist_votos WHERE musica_id = ? AND convidado_id = ?', [m.id, convidadoId]);
  }
}

// O autor tira a própria sugestão; o admin tira qualquer uma.
async function remover(musicaId, convidadoId = null) {
  const args = [Number(musicaId)];
  let sql = 'SELECT id FROM playlist_musicas WHERE id = ?';
  if (convidadoId) { sql += ' AND convidado_id = ?'; args.push(convidadoId); }
  const m = await banco.um(sql, args);
  if (!m) throw new ErroValidacao('Música não encontrada.', 404);
  await banco.lote([
    { sql: 'DELETE FROM playlist_votos WHERE musica_id = ?', args: [m.id] },
    { sql: 'DELETE FROM playlist_musicas WHERE id = ?', args: [m.id] },
  ]);
  await require('./colaboracao').musicaRetirada(m.id);
}

module.exports = { listar, sugerir, votar, remover, chaveDe, MAX_SUGESTOES };
