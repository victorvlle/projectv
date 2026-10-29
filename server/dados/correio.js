// Mural das Trevas (id interno "correio"): cada pessoa manda um RECADO ou uma FOTO (com legenda
// opcional) e escolhe, se quiser, para quem é. Anônimo para todos; só o organizador vê quem mandou.
// Sem pontos.
//
// ENTRADA AUTOMÁTICA (padrão): o que chega vai direto ao telão. O organizador pode TRAVAR
// (config 'correio'.auto = false): aí cada envio espera aprovação. Ele também apaga qualquer envio.
//
// FOTOS DA FESTA: depois da festa (atividade "fotos", abre domingo) todos veem e baixam as fotos
// aprovadas, uma a uma ou todas num .zip.
//
// FOTOS: o celular já reduz a foto (lado maior até 1600 px) e manda JPEG; o servidor confere que é
// JPEG de verdade e o tamanho. A foto fica em correio_fotos (fora das listas, que ficam leves) e
// NÃO entra no backup. O organizador pode apagar todas as fotos depois da festa.
//
// Travas: legenda/recado até 140 caracteres; 1 envio a cada 30 s e no máximo 20 por pessoa.
// MODO TESTE: o que for mandado com a atividade "Em teste" fica marcado e some no "Apagar dados de teste".

const crypto = require('crypto');
const banco = require('./banco');
const festa = require('./festa');
const atividades = require('./atividades');
const convidados = require('./convidados');
const { ErroValidacao, limparTexto } = convidados;

const MAX_CARACTERES = 140;
const MAX_POR_PESSOA = 20;
const INTERVALO_MS = 30 * 1000;
const MAX_FOTO_BYTES = 900 * 1024;

async function config() {
  return { auto: true, ...((await festa.ler('correio')) || {}) };
}
async function definirAuto(auto) {
  await festa.gravar('correio', { ...(await config()), auto: Boolean(auto) });
}

const apelido = (id) => `k${crypto.createHash('sha256').update(`pv-correio:${id}`).digest('hex').slice(0, 12)}`;

// Base64 de um JPEG (com ou sem o prefixo data:). Devolve o Buffer ou lança erro.
function lerFoto(foto) {
  if (typeof foto !== 'string') throw new ErroValidacao('Foto inválida.');
  const b64 = foto.replace(/^data:image\/jpeg;base64,/, '');
  if (b64.length > Math.ceil(MAX_FOTO_BYTES / 3) * 4 + 8) throw new ErroValidacao('A foto ficou grande demais. Tente outra.', 413);
  if (!b64.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new ErroValidacao('Foto inválida.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw new ErroValidacao('Envie uma foto (JPEG).');
  if (buf.length > MAX_FOTO_BYTES) throw new ErroValidacao('A foto ficou grande demais. Tente outra.', 413);
  return buf;
}

async function paraConvidado(euId) {
  const [minhas, pessoas] = await Promise.all([
    banco.tudo(
      `SELECT m.id, m.texto, m.estado, m.criado_em, p.nome AS para, (f.carta_id IS NOT NULL) AS foto
         FROM correio m LEFT JOIN convidados p ON p.id = m.para_id LEFT JOIN correio_fotos f ON f.carta_id = m.id
        WHERE m.autor_id = ? ORDER BY m.criado_em DESC LIMIT 30`, [euId]),
    convidados.confirmados(),
  ]);
  return {
    max: MAX_CARACTERES, limite: MAX_POR_PESSOA, auto: (await config()).auto,
    minhas: minhas.map((m) => ({ id: Number(m.id), texto: m.texto, estado: m.estado, em: Number(m.criado_em), para: m.para || null, foto: Boolean(Number(m.foto)) })),
    enviadas: minhas.length,
    pessoas: pessoas.filter((c) => c.id !== euId).map((c) => ({ id: apelido(c.id), nome: c.nome, avatar: c.avatar })),
  };
}

async function enviar(eu, { texto, para, foto }, agora = Date.now()) {
  const { liberada, teste } = await atividades.acesso('correio', eu, agora);
  if (!liberada) throw new ErroValidacao('O Mural das Trevas ainda não está aberto.', 403);
  const t = limparTexto(texto || '', MAX_CARACTERES);
  const imagem = foto ? lerFoto(foto) : null;
  if (!imagem && t.length < 3) throw new ErroValidacao('Escreva um recado ou escolha uma foto.');
  let paraId = null;
  if (para) {
    const alvo = (await convidados.confirmados()).find((c) => apelido(c.id) === String(para));
    if (!alvo) throw new ErroValidacao('Escolha uma pessoa da lista.');
    paraId = alvo.id;
  }
  const r = await banco.um('SELECT COUNT(*) AS n, MAX(criado_em) AS ultima FROM correio WHERE autor_id = ?', [eu.id]);
  if (Number(r.n) >= MAX_POR_PESSOA) throw new ErroValidacao(`Você já mandou ${MAX_POR_PESSOA} vezes. Chega por hoje. 💀`, 429);
  if (r.ultima != null && agora - Number(r.ultima) < INTERVALO_MS) {
    throw new ErroValidacao('Espere uns segundos antes de mandar de novo.', 429);
  }
  const { auto } = await config();
  await banco.transacao(async (tx) => {
    const ins = await tx.execute({ sql: 'INSERT INTO correio (autor_id, para_id, texto, criado_em, teste, estado, moderado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [eu.id, paraId, t, agora, teste ? 1 : 0, auto ? 'aprovada' : 'pendente', auto ? agora : null] });
    if (imagem) {
      await tx.execute({ sql: 'INSERT INTO correio_fotos (carta_id, dados, bytes) VALUES (?, ?, ?)',
        args: [Number(ins.lastInsertRowid), imagem.toString('base64'), imagem.length] });
    }
  });
  return { noTelao: auto };
}

// A foto em si (Buffer). Convidado: as próprias e, com as Fotos da festa abertas, as aprovadas.
// Organizador/telão: qualquer uma.
async function foto(id, { autorId, galeria = false } = {}) {
  const filtro = autorId ? `AND (m.autor_id = ? ${galeria ? "OR m.estado = 'aprovada'" : ''})` : '';
  const linha = await banco.um(
    `SELECT f.dados FROM correio_fotos f JOIN correio m ON m.id = f.carta_id WHERE f.carta_id = ? ${filtro}`,
    autorId ? [Number(id), autorId] : [Number(id)]);
  return linha ? Buffer.from(linha.dados, 'base64') : null;
}

// ------------------------------------------------------- fotos da festa
async function galeria() {
  const linhas = await banco.tudo(
    `SELECT m.id, m.texto, m.criado_em, p.nome AS para FROM correio m JOIN correio_fotos f ON f.carta_id = m.id
       LEFT JOIN convidados p ON p.id = m.para_id
      WHERE m.estado = 'aprovada' ORDER BY m.criado_em`);
  return { fotos: linhas.map((l) => ({ id: Number(l.id), texto: l.texto, para: l.para || null, em: Number(l.criado_em) })) };
}

// .zip sem compressão (JPEG já é comprimido), escrito foto a foto para não segurar tudo na memória.
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function escreverZip(escrever) {
  const ids = (await galeria()).fotos.map((f) => f.id);
  const central = [];
  let pos = 0;
  for (const [i, id] of ids.entries()) {
    const dados = await foto(id);
    if (!dados) continue;
    const nome = Buffer.from(`project-v-halloween-${String(i + 1).padStart(3, '0')}.jpg`);
    const crc = crc32(dados);
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0); cab.writeUInt16LE(20, 4); cab.writeUInt16LE(0, 6); cab.writeUInt16LE(0, 8);
    cab.writeUInt16LE(0, 10); cab.writeUInt16LE(0x5b61, 12); // 01/11/2025 (data fixa, só enfeite)
    cab.writeUInt32LE(crc, 14); cab.writeUInt32LE(dados.length, 18); cab.writeUInt32LE(dados.length, 22);
    cab.writeUInt16LE(nome.length, 26); cab.writeUInt16LE(0, 28);
    await escrever(Buffer.concat([cab, nome, dados]));
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x5b61, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(dados.length, 20); c.writeUInt32LE(dados.length, 24);
    c.writeUInt16LE(nome.length, 28); c.writeUInt32LE(pos, 42);
    central.push(Buffer.concat([c, nome]));
    pos += 30 + nome.length + dados.length;
  }
  const dir = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(central.length, 8); fim.writeUInt16LE(central.length, 10);
  fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(pos, 16);
  await escrever(Buffer.concat([dir, fim]));
  return central.length;
}

// ------------------------------------------------------------------ admin
async function paraAdmin(agora = Date.now()) {
  const [linhas, uso, fotos] = await Promise.all([
    banco.tudo(
      `SELECT m.id, m.texto, m.estado, m.criado_em, m.teste, a.nome AS autor, p.nome AS para, (f.carta_id IS NOT NULL) AS foto
         FROM correio m JOIN convidados a ON a.id = m.autor_id LEFT JOIN convidados p ON p.id = m.para_id
         LEFT JOIN correio_fotos f ON f.carta_id = m.id
        ORDER BY CASE m.estado WHEN 'pendente' THEN 0 ELSE 1 END, m.criado_em DESC LIMIT 150`),
    atividades.emUso('correio', agora),
    banco.um('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM correio_fotos'),
  ]);
  const cartas = linhas.map((l) => ({ id: Number(l.id), texto: l.texto, estado: l.estado, em: Number(l.criado_em), autor: l.autor,
    para: l.para || null, teste: Boolean(Number(l.teste)), foto: Boolean(Number(l.foto)) }));
  return { auto: (await config()).auto, liberada: uso.ativa, emTeste: uso.teste, pendentes: cartas.filter((c) => c.estado === 'pendente').length, cartas,
    fotos: Number(fotos.n), fotosMb: Math.round(Number(fotos.bytes) / 1024 / 102.4) / 10 };
}

async function moderar(id, estado, agora = Date.now()) {
  if (!['aprovada', 'recusada'].includes(estado)) throw new ErroValidacao('Estado inválido.');
  const r = await banco.rodar('UPDATE correio SET estado = ?, moderado_em = ? WHERE id = ?', [estado, agora, Number(id)]);
  if (!r.rowsAffected) throw new ErroValidacao('Recado não encontrado.', 404);
}

// Apaga um envio (recado ou foto) de vez.
async function apagar(id) {
  const r = await banco.lote([
    { sql: 'DELETE FROM correio_fotos WHERE carta_id = ?', args: [Number(id)] },
    { sql: 'DELETE FROM correio WHERE id = ?', args: [Number(id)] },
  ]);
  if (!r[1].rowsAffected) throw new ErroValidacao('Envio não encontrado.', 404);
}

// Some com todas as fotos (e os envios que eram foto). Recados de texto ficam.
async function apagarFotos() {
  const n = Number((await banco.um('SELECT COUNT(*) AS n FROM correio_fotos')).n);
  await banco.lote([
    { sql: 'DELETE FROM correio WHERE id IN (SELECT carta_id FROM correio_fotos)', args: [] },
    { sql: 'DELETE FROM correio_fotos', args: [] },
  ]);
  return { fotos: n };
}

// ------------------------------------------------------------------ telão
async function paraTelao() {
  const linhas = await banco.tudo(
    `SELECT m.id, m.texto, m.moderado_em, p.nome AS para, p.avatar AS para_avatar, (f.carta_id IS NOT NULL) AS foto
       FROM correio m LEFT JOIN convidados p ON p.id = m.para_id LEFT JOIN correio_fotos f ON f.carta_id = m.id
      WHERE m.estado = 'aprovada' ORDER BY m.moderado_em DESC LIMIT 200`);
  return { cartas: linhas.map((l) => ({ id: Number(l.id), texto: l.texto, para: l.para || null, paraAvatar: l.para_avatar || null,
    em: Number(l.moderado_em), foto: Boolean(Number(l.foto)) })) };
}

module.exports = { config, definirAuto, paraConvidado, enviar, foto, galeria, escreverZip, crc32, paraAdmin, moderar, apagar, apagarFotos, paraTelao, apelido, MAX_CARACTERES, MAX_FOTO_BYTES };
