// Informações da festa (tabela config, chave -> JSON). Editáveis pelo admin.

const banco = require('./banco');
const { ErroValidacao, limparTexto } = require('./convidados');

const CAMPOS_TEXTO = {
  nome: 80, local: 160, dressCode: 400, oQueLevar: 400, regras: 600,
  // Como chegar
  chegadaEndereco: 160, chegadaPortaria: 300, chegadaEstacionamento: 300, chegadaObs: 400,
};
const MODOS_TELAO = new Set(['contagem', 'confirmados', 'atividades', 'mensagem', 'pos', 'previsoes', 'ranking', 'quiz', 'concurso', 'correio']);

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
    fim: tudo.fim,
    fimMs: Date.parse(tudo.fim),
    local: tudo.local,
    dressCode: tudo.dressCode,
    oQueLevar: tudo.oQueLevar,
    regras: tudo.regras,
    chegada: {
      endereco: tudo.chegadaEndereco || '',
      portaria: tudo.chegadaPortaria || '',
      estacionamento: tudo.chegadaEstacionamento || '',
      obs: tudo.chegadaObs || '',
    },
  };
}

// Aceita só os campos conhecidos; `inicio` e `fim` precisam ser datas ISO válidas,
// com o fim depois do início. Tudo é validado antes de gravar qualquer coisa.
async function editar(campos) {
  const atual = await info();
  const inicioMs = campos.inicio !== undefined ? Date.parse(campos.inicio) : atual.inicioMs;
  const fimMs = campos.fim !== undefined ? Date.parse(campos.fim) : atual.fimMs;
  if (!Number.isFinite(inicioMs)) throw new ErroValidacao('Data de início inválida.');
  if (!Number.isFinite(fimMs)) throw new ErroValidacao('Data de fim inválida.');
  if (fimMs <= inicioMs) throw new ErroValidacao('O fim da festa precisa ser depois do início.');

  for (const [chave, max] of Object.entries(CAMPOS_TEXTO)) {
    if (campos[chave] !== undefined) await gravar(chave, limparTexto(campos[chave], max));
  }
  // Guarda no fuso de Manaus para a leitura humana continuar fazendo sentido.
  if (campos.inicio !== undefined) await gravar('inicio', paraManaus(inicioMs));
  if (campos.fim !== undefined) await gravar('fim', paraManaus(fimMs));
  return info();
}

function paraManaus(ms) {
  const d = new Date(ms - 4 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19) + '-04:00';
}

async function telao() {
  return { modo: (await ler('telaoModo')) || 'contagem', mensagem: (await ler('telaoMensagem')) || '', previsao: Number((await ler('telaoPrevisao')) || 0) };
}

async function definirTelao({ modo, mensagem, previsao }) {
  if (previsao !== undefined) {
    const n = Number(previsao);
    if (!Number.isInteger(n) || n < 0 || n > 50) throw new ErroValidacao('Pergunta inválida.');
    await gravar('telaoPrevisao', n);
  }
  if (modo !== undefined) {
    if (!MODOS_TELAO.has(modo)) throw new ErroValidacao('Modo de telão desconhecido.');
    await gravar('telaoModo', modo);
  }
  if (mensagem !== undefined) await gravar('telaoMensagem', limparTexto(mensagem, 140));
  return telao();
}

module.exports = { ler, gravar, info, editar, telao, definirTelao, paraManaus, MODOS_TELAO };
