// Lista de bebidas: quem leva o quê, o que já está garantido e o que ainda falta.
//
// - Itens da lista (bebidas_itens) são definidos pelo admin, com uma meta.
// - Cada convidado diz quanto leva de cada item (um compromisso por item) ou
//   cadastra uma "outra bebida" livre. Quantidade 0 = desistiu.
// - Aparece o nome cadastrado pelo organizador e o monstro de quem leva.

const banco = require('./banco');
const festa = require('./festa');
const { ErroValidacao, limparTexto } = require('./convidados');

const MAX_POR_CONVIDADO = 15;
const MAX_ITENS = 50;

function validarQuantidade(q) {
  // Só número de verdade (ou texto só com dígitos): true, [], "1e2" etc. são recusados.
  if (!(typeof q === 'number' || (typeof q === 'string' && /^\d{1,2}$/.test(q)))) {
    throw new ErroValidacao('A quantidade precisa ser de 0 a 99.');
  }
  const n = Number(q);
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new ErroValidacao('A quantidade precisa ser de 0 a 99.');
  return n;
}

function validarNomeBebida(nome) {
  const n = limparTexto(nome, 40);
  if (n.length < 2) throw new ErroValidacao('Escreva o nome da bebida (2 a 40 caracteres).');
  return n;
}

function validarUnidade(u, padrao = 'un.') {
  const v = limparTexto(u, 20);
  return v || padrao;
}

async function aberta() {
  const v = await festa.ler('bebidasAberta');
  return v !== false;
}

async function garantirAberta() {
  if (!(await aberta())) throw new ErroValidacao('A lista de bebidas foi fechada pelo organizador.', 403);
}

// ------------------------------------------------------------------ leitura
async function linhas() {
  const [itens, compromissos] = await Promise.all([
    banco.tudo('SELECT * FROM bebidas_itens ORDER BY ordem, id'),
    banco.tudo(
      `SELECT b.*, c.nome AS convidado_nome, c.avatar, c.ativo
         FROM bebidas_compromissos b JOIN convidados c ON c.id = b.convidado_id
        ORDER BY b.criado_em, b.id`,
    ),
  ]);
  // Convidado desativado não conta: o link dele foi cortado.
  return { itens, compromissos: compromissos.filter((x) => x.ativo) };
}

function pessoa(x, euId) {
  const souEu = x.convidado_id === euId;
  return { nome: x.convidado_nome, avatar: x.avatar, quantidade: Number(x.quantidade), souEu };
}

function montar({ itens, compromissos }, mapearPessoa) {
  const porItem = new Map(itens.map((i) => [Number(i.id), []]));
  const livres = new Map();
  for (const x of compromissos) {
    if (x.item_id != null) {
      const l = porItem.get(Number(x.item_id));
      if (l) l.push(x);
    } else {
      const chave = x.nome_livre.toLocaleLowerCase('pt-BR');
      if (!livres.has(chave)) livres.set(chave, { nome: x.nome_livre, lista: [] });
      livres.get(chave).lista.push(x);
    }
  }
  const lista = itens.map((i) => {
    const quem = porItem.get(Number(i.id));
    const total = quem.reduce((s, x) => s + Number(x.quantidade), 0);
    const meta = Number(i.meta);
    return {
      id: Number(i.id), nome: i.nome, unidade: i.unidade, meta, total,
      falta: meta > 0 ? Math.max(0, meta - total) : 0,
      quem: quem.map(mapearPessoa),
    };
  });
  const outras = [...livres.values()].map(({ nome, lista: l }) => ({
    nome,
    total: l.reduce((s, x) => s + Number(x.quantidade), 0),
    unidade: l[0].unidade_livre || 'un.',
    quem: l.map(mapearPessoa),
  }));
  return { itens: lista, outras };
}

async function paraConvidado(euId) {
  const dados = await linhas();
  const { itens, outras } = montar(dados, (x) => pessoa(x, euId));
  const nomes = new Map(dados.itens.map((i) => [Number(i.id), i]));
  const minhas = dados.compromissos.filter((x) => x.convidado_id === euId).map((x) => {
    const item = x.item_id != null ? nomes.get(Number(x.item_id)) : null;
    return {
      id: Number(x.id),
      itemId: item ? Number(item.id) : null,
      nome: item ? item.nome : x.nome_livre,
      unidade: item ? item.unidade : (x.unidade_livre || 'un.'),
      quantidade: Number(x.quantidade),
    };
  });
  return { aberta: await aberta(), itens, outras, minhas };
}

async function paraAdmin() {
  const dados = await linhas();
  const mapear = (x) => ({
    compromissoId: Number(x.id), convidadoId: x.convidado_id, nome: x.convidado_nome,
    avatar: x.avatar, quantidade: Number(x.quantidade),
  });
  return { aberta: await aberta(), ...montar(dados, mapear) };
}

// ---------------------------------------------------------- ações do convidado
async function contarDoConvidado(convidadoId) {
  const r = await banco.um('SELECT COUNT(*) AS n FROM bebidas_compromissos WHERE convidado_id = ?', [convidadoId]);
  return Number(r.n);
}

// Define quanto o convidado leva de um item da lista (0 remove).
async function definirItem(convidadoId, itemId, quantidade) {
  await garantirAberta();
  const q = validarQuantidade(quantidade);
  const item = await banco.um('SELECT id FROM bebidas_itens WHERE id = ?', [Number(itemId)]);
  if (!item) throw new ErroValidacao('Essa bebida não está mais na lista.', 404);
  const atual = await banco.um(
    'SELECT id FROM bebidas_compromissos WHERE convidado_id = ? AND item_id = ?', [convidadoId, Number(itemId)]);
  const agora = Date.now();
  if (q === 0) {
    if (atual) await banco.rodar('DELETE FROM bebidas_compromissos WHERE id = ?', [atual.id]);
    return;
  }
  if (atual) {
    await banco.rodar('UPDATE bebidas_compromissos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [q, agora, atual.id]);
    return;
  }
  if ((await contarDoConvidado(convidadoId)) >= MAX_POR_CONVIDADO) {
    throw new ErroValidacao(`Você já marcou ${MAX_POR_CONVIDADO} bebidas. Tire alguma antes de adicionar outra.`);
  }
  await banco.rodar(
    `INSERT INTO bebidas_compromissos (convidado_id, item_id, quantidade, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?)`, [convidadoId, Number(itemId), q, agora, agora]);
  await require('../notificacoes').evento('contribuicao', convidadoId);
}

// Bebida fora da lista. Se o nome bater com um item da lista, entra nele.
async function adicionarOutra(convidadoId, { nome, quantidade, unidade }) {
  await garantirAberta();
  const n = validarNomeBebida(nome);
  const q = validarQuantidade(quantidade);
  if (q === 0) throw new ErroValidacao('Informe quantas você vai levar.');
  const item = await banco.um('SELECT id FROM bebidas_itens WHERE nome = ? COLLATE NOCASE', [n]);
  if (item) {
    const atual = await banco.um(
      'SELECT quantidade FROM bebidas_compromissos WHERE convidado_id = ? AND item_id = ?', [convidadoId, item.id]);
    return definirItem(convidadoId, item.id, Math.min(99, q + (atual ? Number(atual.quantidade) : 0)));
  }
  const atual = await banco.um(
    'SELECT id FROM bebidas_compromissos WHERE convidado_id = ? AND nome_livre = ? COLLATE NOCASE', [convidadoId, n]);
  const agora = Date.now();
  if (atual) {
    await banco.rodar('UPDATE bebidas_compromissos SET quantidade = ?, unidade_livre = ?, atualizado_em = ? WHERE id = ?',
      [q, validarUnidade(unidade), agora, atual.id]);
    return undefined;
  }
  if ((await contarDoConvidado(convidadoId)) >= MAX_POR_CONVIDADO) {
    throw new ErroValidacao(`Você já marcou ${MAX_POR_CONVIDADO} bebidas. Tire alguma antes de adicionar outra.`);
  }
  await banco.rodar(
    `INSERT INTO bebidas_compromissos (convidado_id, nome_livre, unidade_livre, quantidade, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?)`, [convidadoId, n, validarUnidade(unidade), q, agora, agora]);
  await require('../notificacoes').evento('contribuicao', convidadoId);
  return undefined;
}

// O convidado só remove o que é dele.
async function removerMinha(convidadoId, compromissoId) {
  await garantirAberta();
  const r = await banco.rodar('DELETE FROM bebidas_compromissos WHERE id = ? AND convidado_id = ?',
    [Number(compromissoId), convidadoId]);
  if (!r.rowsAffected) throw new ErroValidacao('Item não encontrado.', 404);
}

// ---------------------------------------------------------------- admin
async function criarItem({ nome, unidade, meta }) {
  const total = await banco.um('SELECT COUNT(*) AS n, COALESCE(MAX(ordem), -1) AS m FROM bebidas_itens');
  if (Number(total.n) >= MAX_ITENS) throw new ErroValidacao(`A lista aceita até ${MAX_ITENS} bebidas.`);
  try {
    await banco.rodar('INSERT INTO bebidas_itens (nome, unidade, meta, ordem, criado_em) VALUES (?, ?, ?, ?, ?)',
      [validarNomeBebida(nome), validarUnidade(unidade), validarMeta(meta), Number(total.m) + 1, Date.now()]);
  } catch (erro) {
    if (/UNIQUE/i.test(erro.message)) throw new ErroValidacao('Essa bebida já está na lista.', 409);
    throw erro;
  }
}

function validarMeta(meta) {
  const n = Number(meta ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new ErroValidacao('A meta precisa ser de 0 a 999 (0 = sem meta).');
  return n;
}

async function editarItem(id, campos) {
  const sets = [];
  const args = [];
  if (campos.nome !== undefined) { sets.push('nome = ?'); args.push(validarNomeBebida(campos.nome)); }
  if (campos.unidade !== undefined) { sets.push('unidade = ?'); args.push(validarUnidade(campos.unidade)); }
  if (campos.meta !== undefined) { sets.push('meta = ?'); args.push(validarMeta(campos.meta)); }
  if (!sets.length) return;
  try {
    const r = await banco.rodar(`UPDATE bebidas_itens SET ${sets.join(', ')} WHERE id = ?`, [...args, Number(id)]);
    if (!r.rowsAffected) throw new ErroValidacao('Bebida não encontrada.', 404);
  } catch (erro) {
    if (/UNIQUE/i.test(erro.message)) throw new ErroValidacao('Já existe uma bebida com esse nome.', 409);
    throw erro;
  }
}

// Tirar um item da lista não apaga o que as pessoas prometeram: vira "outra bebida".
async function excluirItem(id) {
  const item = await banco.um('SELECT * FROM bebidas_itens WHERE id = ?', [Number(id)]);
  if (!item) throw new ErroValidacao('Bebida não encontrada.', 404);
  await banco.lote([
    { sql: 'UPDATE bebidas_compromissos SET nome_livre = ?, unidade_livre = ?, item_id = NULL WHERE item_id = ?',
      args: [item.nome, item.unidade, item.id] },
    { sql: 'DELETE FROM bebidas_itens WHERE id = ?', args: [item.id] },
  ]);
}

async function removerCompromisso(id) {
  const r = await banco.rodar('DELETE FROM bebidas_compromissos WHERE id = ?', [Number(id)]);
  if (!r.rowsAffected) throw new ErroValidacao('Item não encontrado.', 404);
}

async function definirAberta(valor) {
  await festa.gravar('bebidasAberta', Boolean(valor));
}

module.exports = {
  paraConvidado, paraAdmin, aberta,
  definirItem, adicionarOutra, removerMinha,
  criarItem, editarItem, excluirItem, removerCompromisso, definirAberta,
  MAX_POR_CONVIDADO,
};
