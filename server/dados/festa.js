// Informações da festa (tabela config, chave -> JSON). Editáveis pelo admin.

const banco = require('./banco');
const { ErroValidacao, limparTexto } = require('./convidados');

const CAMPOS_TEXTO = { nome: 80, local: 160, dressCode: 400, oQueLevar: 400, regras: 600 };
const MODOS_TELAO = new Set(['contagem', 'confirmados', 'atividades', 'mensagem']);

async function ler(chave) {
  const l = await banco.um('SELECT valor FROM config WHERE chave = ?', [chave]);
  return l ? JSON.parse(l.valor) : undefined;
}

async function gravar(chave, valor) {
  await banco.rodar(
    'INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor',
    [chave, JSON.stringify(valor)],
  );
}

async function info() {
  const linhas = await banco.tudo('SELECT chave, valor FROM config');
  const tudo = Object.fromEntries(linhas.map((l) => [l.chave, JSON.parse(l.valor)]));
  return {
    nome: tudo.nome,
    inicio: tudo.inicio,
    inicioMs: Date.parse(tudo.inicio),
    local: tudo.local,
    dressCode: tudo.dressCode,
    oQueLevar: tudo.oQueLevar,
    regras: tudo.regras,
  };
}

// Aceita só os campos conhecidos; `inicio` precisa ser uma data ISO válida.
async function editar(campos) {
  for (const [chave, max] of Object.entries(CAMPOS_TEXTO)) {
    if (campos[chave] !== undefined) await gravar(chave, limparTexto(campos[chave], max));
  }
  if (campos.inicio !== undefined) {
    const ms = Date.parse(campos.inicio);
    if (!Number.isFinite(ms)) throw new ErroValidacao('Data de início inválida.');
    // Guarda no fuso de Manaus para a leitura humana continuar fazendo sentido.
    await gravar('inicio', paraManaus(ms));
  }
  return info();
}

function paraManaus(ms) {
  const d = new Date(ms - 4 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19) + '-04:00';
}

async function telao() {
  return { modo: (await ler('telaoModo')) || 'contagem', mensagem: (await ler('telaoMensagem')) || '' };
}

async function definirTelao({ modo, mensagem }) {
  if (modo !== undefined) {
    if (!MODOS_TELAO.has(modo)) throw new ErroValidacao('Modo de telão desconhecido.');
    await gravar('telaoModo', modo);
  }
  if (mensagem !== undefined) await gravar('telaoMensagem', limparTexto(mensagem, 140));
  return telao();
}

module.exports = { ler, gravar, info, editar, telao, definirTelao, paraManaus, MODOS_TELAO };
