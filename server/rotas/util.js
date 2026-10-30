// Utilitários das rotas: async sem try/catch repetido, autenticação e erros.

const convidados = require('../dados/convidados');
const seg = require('../seguranca');

const assincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function tokenDoCabecalho(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// Confere o crachá E o banco: convidado precisa existir, estar ativo e na mesma
// versão de sessão (link regenerado ou desativado derruba o crachá antigo).
async function convidadoDoToken(token) {
  const s = seg.lerSessaoConvidado(token);
  if (!s) return null;
  const c = await convidados.buscarPorId(s.id);
  if (!c || !c.ativo || Number(c.sessao_versao) !== s.versao) return null;
  return c;
}

const soConvidado = assincrono(async (req, res, next) => {
  const c = await convidadoDoToken(tokenDoCabecalho(req));
  if (!c) return res.status(401).json({ ok: false, erro: 'Acesso inválido. Abra o seu link de convite de novo.', codigo: 'sem-acesso' });
  req.convidado = c;
  next();
});

function soAdmin(req, res, next) {
  if (seg.sessaoAdminValida(tokenDoCabecalho(req))) return next();
  return res.status(401).json({ ok: false, erro: 'Sessão de admin inválida ou expirada.', codigo: 'sem-admin' });
}

function tratarErros(erro, req, res, _next) {
  if (erro.type === 'entity.too.large') return res.status(413).json({ ok: false, erro: 'Arquivo grande demais.' });
  if (erro.type === 'entity.parse.failed') return res.status(400).json({ ok: false, erro: 'Requisição malformada.' });
  if (erro.publico) return res.status(erro.status || 400).json({ ok: false, erro: erro.message });
  console.error(`[erro] ${req.method} ${req.originalUrl}:`, erro);
  return res.status(500).json({ ok: false, erro: 'Algo deu errado no servidor. Tente de novo.' });
}

// Versão no ar: muda a cada deploy (o Render informa o commit; sem ele, a hora em que o servidor subiu).
const VERSAO = (process.env.RENDER_GIT_COMMIT || `inicio-${Date.now()}`).slice(0, 40);

module.exports = { VERSAO, assincrono, tokenDoCabecalho, convidadoDoToken, soConvidado, soAdmin, tratarErros };
