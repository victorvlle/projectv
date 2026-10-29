// Backup e restauração do banco inteiro em um arquivo JSON.
//
// O backup é baixado pelo painel admin (e pode ser guardado no celular/PC).
// A restauração substitui TODOS os dados pelos do arquivo, numa transação só:
// ou entra tudo, ou nada muda.
//
// Ordem importa por causa das chaves estrangeiras: insere pais antes de filhos e
// apaga na ordem inversa. Tabelas novas entram em ORDEM conforme as migrações crescem.

const banco = require('./banco');
const { ErroValidacao } = require('./convidados');

const ORDEM = ['config', 'convidados', 'atividades', 'bebidas_itens', 'bebidas_compromissos', 'pontos_log',
  'playlist_musicas', 'playlist_votos', 'caronas', 'caronas_reservas', 'pos_opcoes', 'pos_votos',
  'push_inscricoes', 'push_enviados', 'push_fila', 'push_log', 'previsoes_perguntas', 'previsoes_palpites', 'maldicoes', 'enigmas', 'enigma_tentativas',
  'quiz_perguntas', 'quiz_respostas', 'concurso_votos', 'correio', 'previsoes_envios', 'quiz_sala'];

async function tabelas() {
  const rs = await banco.tudo(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name <> 'esquema'",
  );
  const nomes = rs.map((r) => r.name);
  return [...ORDEM.filter((t) => nomes.includes(t)), ...nomes.filter((t) => !ORDEM.includes(t)).sort()];
}

function serializar(valor) {
  if (valor instanceof ArrayBuffer) return { $b64: Buffer.from(valor).toString('base64') };
  if (ArrayBuffer.isView(valor)) return { $b64: Buffer.from(valor.buffer, valor.byteOffset, valor.byteLength).toString('base64') };
  if (typeof valor === 'bigint') return Number(valor);
  return valor;
}

function desserializar(valor) {
  if (valor && typeof valor === 'object' && typeof valor.$b64 === 'string') return Buffer.from(valor.$b64, 'base64');
  return valor;
}

async function exportar() {
  const saida = { app: 'projectv', versao: banco.versaoAtual(), geradoEm: new Date().toISOString(), tabelas: {} };
  for (const t of await tabelas()) {
    const linhas = await banco.tudo(`SELECT * FROM "${t}"`);
    saida.tabelas[t] = linhas.map((l) => {
      const o = {};
      for (const [k, v] of Object.entries(l)) o[k] = serializar(v);
      return o;
    });
  }
  return saida;
}

async function restaurar(dados) {
  if (!dados || dados.app !== 'projectv' || typeof dados.tabelas !== 'object') {
    throw new ErroValidacao('Arquivo de backup inválido.');
  }
  if (Number(dados.versao) > banco.versaoAtual()) {
    throw new ErroValidacao('Este backup veio de uma versão mais nova do site. Atualize o site antes de restaurar.');
  }
  const existentes = await tabelas();
  const colunasPorTabela = {};
  for (const t of existentes) {
    const cols = await banco.tudo(`SELECT name FROM pragma_table_info('${t}')`);
    colunasPorTabela[t] = new Set(cols.map((c) => c.name));
  }

  const comandos = [];
  for (const t of [...existentes].reverse()) comandos.push({ sql: `DELETE FROM "${t}"`, args: [] });
  let total = 0;
  for (const t of existentes) {
    const linhas = Array.isArray(dados.tabelas[t]) ? dados.tabelas[t] : [];
    for (const linha of linhas) {
      // Só colunas que existem hoje: backup antigo restaura num banco mais novo.
      const cols = Object.keys(linha).filter((c) => colunasPorTabela[t].has(c));
      if (!cols.length) continue;
      comandos.push({
        sql: `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        args: cols.map((c) => desserializar(linha[c])),
      });
      total += 1;
    }
  }
  await banco.lote(comandos);
  return { linhas: total, tabelas: existentes.length };
}

module.exports = { exportar, restaurar };
