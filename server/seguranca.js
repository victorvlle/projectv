// Códigos de convite, sessões assinadas e freios de abuso.
//
// SESSÕES: um "crachá" assinado com HMAC, sem cookie (vai no cabeçalho
// Authorization e no handshake do Socket.IO), então não há CSRF.
//   convidado: c.<id>.<versao>.<expira>.<assinatura>
//   admin:     a.<expira>.<assinatura>
// Regenerar o link de um convidado sobe `sessao_versao` e derruba crachás antigos.

const crypto = require('crypto');

const SEGREDO_SESSAO = process.env.SESSAO_SEGREDO || (() => {
  const s = crypto.randomBytes(32).toString('hex');
  if (process.env.NODE_ENV === 'production') {
    console.warn('[seguranca] SESSAO_SEGREDO ausente: todos serão deslogados a cada reinício.');
  }
  return s;
})();

const ADMIN_SEGREDO = () => process.env.ADMIN_SEGREDO || '';

// Sem caracteres ambíguos (0/O, 1/I/l) para quem digitar o link à mão.
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';
const TAMANHO_CODIGO = 10; // 31^10 ≈ 8e14 combinações

function gerarCodigo() {
  let s = '';
  for (let i = 0; i < TAMANHO_CODIGO; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return s;
}

const codigoValido = (c) => typeof c === 'string' && new RegExp(`^[${ALFABETO}]{${TAMANHO_CODIGO}}$`).test(c);

function iguaisSeguro(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const assinar = (corpo) => crypto.createHmac('sha256', SEGREDO_SESSAO).update(corpo).digest('base64url');

const DIA = 24 * 60 * 60 * 1000;

function criarSessaoConvidado(id, versao, agora = Date.now()) {
  const corpo = `c.${id}.${versao}.${agora + 30 * DIA}`;
  return `${corpo}.${assinar(corpo)}`;
}

// Devolve { id, versao } se o crachá for autêntico e não expirado. Quem chama
// ainda confere no banco se o convidado está ativo e na mesma versão.
function lerSessaoConvidado(token, agora = Date.now()) {
  if (typeof token !== 'string' || token.length > 300) return null;
  const partes = token.split('.');
  if (partes.length !== 5 || partes[0] !== 'c') return null;
  const corpo = partes.slice(0, 4).join('.');
  if (!iguaisSeguro(partes[4], assinar(corpo))) return null;
  if (Number(partes[3]) < agora) return null;
  return { id: partes[1], versao: Number(partes[2]) };
}

function criarSessaoAdmin(agora = Date.now()) {
  const corpo = `a.${agora + 2 * DIA}`;
  return `${corpo}.${assinar(corpo + '|' + ADMIN_SEGREDO())}`;
}

// A assinatura inclui o ADMIN_SEGREDO: trocar a senha derruba sessões de admin antigas.
function sessaoAdminValida(token, agora = Date.now()) {
  if (!ADMIN_SEGREDO() || typeof token !== 'string' || token.length > 200) return false;
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== 'a') return false;
  const corpo = `${partes[0]}.${partes[1]}`;
  if (!iguaisSeguro(partes[2], assinar(corpo + '|' + ADMIN_SEGREDO()))) return false;
  return Number(partes[1]) >= agora;
}

const senhaAdminConfere = (senha) => Boolean(ADMIN_SEGREDO()) && iguaisSeguro(senha, ADMIN_SEGREDO());

// ------------------------------------------------------------- freio de abuso
// Janela fixa por chave (IP, convidado...). Em memória de propósito: perder a
// contagem num reinício só "perdoa" alguém por um minuto.
function criarFreio({ maximo, janelaMs }) {
  const mapa = new Map();
  const freio = {
    // true = pode seguir; false = estourou o limite
    tentar(chave, agora = Date.now()) {
      const r = mapa.get(chave);
      if (!r || r.ate <= agora) {
        mapa.set(chave, { n: 1, ate: agora + janelaMs });
        return true;
      }
      r.n += 1;
      return r.n <= maximo;
    },
    // Já estourou? (só consulta, não conta). Use ANTES de conferir senha/código, para
    // que um chute certo depois do bloqueio também seja recusado.
    estourou(chave, agora = Date.now()) {
      const r = mapa.get(chave);
      return Boolean(r) && r.ate > agora && r.n >= maximo;
    },
    zerar(chave) { mapa.delete(chave); },
    faltaMs(chave, agora = Date.now()) {
      const r = mapa.get(chave);
      return r ? Math.max(0, r.ate - agora) : 0;
    },
  };
  const limpeza = setInterval(() => {
    const agora = Date.now();
    for (const [k, r] of mapa) if (r.ate <= agora) mapa.delete(k);
  }, Math.max(janelaMs, 60000));
  limpeza.unref();
  return freio;
}

module.exports = {
  gerarCodigo, codigoValido, iguaisSeguro,
  criarSessaoConvidado, lerSessaoConvidado,
  criarSessaoAdmin, sessaoAdminValida, senhaAdminConfere,
  adminLigado: () => Boolean(ADMIN_SEGREDO()),
  criarFreio,
};
