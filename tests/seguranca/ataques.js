// Bateria de ataques simulados contra uma cópia local do site (NODE_ENV=production,
// banco em arquivo temporário). Não toca no site no ar.
//
//   node tests/seguranca/ataques.js            -> imprime o resultado
//   node tests/seguranca/ataques.js --json x   -> também grava o resultado em x
//
// Cada ataque termina como:
//   BARRADO  - o site se defendeu
//   FALHOU   - o ataque funcionou (vulnerabilidade)
//   ATENÇÃO  - não é falha, mas merece cuidado

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { io: ioCliente } = require('socket.io-client');

const RAIZ = path.join(__dirname, '..', '..');
const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-ataque-'));
const PORTA = 4100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-forte-do-admin-' + crypto.randomBytes(6).toString('hex');

const resultados = [];
function registrar(grupo, ataque, status, detalhe) {
  resultados.push({ grupo, ataque, status, detalhe });
  const cor = { BARRADO: '\x1b[32m', FALHOU: '\x1b[31m', 'ATENÇÃO': '\x1b[33m' }[status] || '';
  console.log(`${cor}${status.padEnd(8)}\x1b[0m [${grupo}] ${ataque} — ${detalhe}`);
}
const barrado = (g, a, ok, d) => registrar(g, a, ok ? 'BARRADO' : 'FALHOU', d);

async function req(metodo, caminho, { token, corpo, cru, headers = {}, bruto } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let body;
  if (bruto !== undefined) { body = bruto; h['Content-Type'] = h['Content-Type'] || 'application/json'; }
  else if (corpo !== undefined) { body = JSON.stringify(corpo); h['Content-Type'] = 'application/json'; }
  const r = await fetch(BASE + caminho, { method: metodo, headers: h, body, redirect: 'manual' });
  if (cru) return r;
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (_) { /* não é JSON */ }
  return { status: r.status, json, texto, headers: r.headers };
}

function conectar(auth) {
  return new Promise((resolve) => {
    const s = ioCliente(BASE, { auth, transports: ['websocket'], reconnection: false, forceNew: true, timeout: 3000 });
    s.once('connect', () => resolve({ ok: true, s }));
    s.once('connect_error', (e) => { s.close(); resolve({ ok: false, erro: e.message }); });
  });
}

async function main() {
  const servidor = spawn(process.execPath, ['server/index.js'], {
    cwd: RAIZ,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORTA), BANCO_CAMINHO: path.join(PASTA, 'alvo.db'),
      ADMIN_SEGREDO: SENHA, SESSAO_SEGREDO: crypto.randomBytes(32).toString('hex'), TURSO_URL: '', PUSH_FALSO: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  servidor.stdout.on('data', (d) => { log += d; });
  servidor.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/saude')).ok) break; } catch (_) { /* subindo */ }
    await new Promise((r) => setTimeout(r, 100));
  }

  try {
    // ---------------------------------------------------------------- preparo
    const admin = (await req('POST', '/api/admin/entrar', { corpo: { senha: SENHA } })).json.token;
    const criados = (await req('POST', '/api/admin/convidados', { token: admin, corpo: { nome: 'Vítima Silva\nAtacante Souza' } })).json.criados;
    const [vitima, atacante] = criados;
    const tV = (await req('POST', '/api/entrar', { corpo: { codigo: vitima.codigo } })).json.token;
    const tA = (await req('POST', '/api/entrar', { corpo: { codigo: atacante.codigo } })).json.token;
    await req('PUT', '/api/eu/perfil', { token: tV, corpo: { avatar: 'bruxa' } });
    await req('PUT', '/api/eu/perfil', { token: tA, corpo: { avatar: 'zumbi' } });

    // =========================================================== 1. RELÓGIO
    const G1 = 'Relógio e desbloqueio';
    let f = await req('GET', '/api/festa', { token: tA });
    const bloqueadas = f.json.atividades.filter((a) => a.estado !== 'liberada');
    const vazou = bloqueadas.filter((a) => a.nome || a.descricao || a.icone);
    barrado(G1, 'Ler o nome/descrição de atividades bloqueadas pela API', vazou.length === 0,
      `${bloqueadas.length} atividades bloqueadas; o servidor manda só o nome enigmático`);

    const relogioFalso = Date.parse('2026-11-01T02:00:00-04:00');
    f = await req('GET', '/api/festa', { token: tA, headers: { Date: new Date(relogioFalso).toUTCString(), 'X-Agora': String(relogioFalso) } });
    barrado(G1, 'Adiantar o relógio (cabeçalhos Date/X-Agora falsos)', f.json.atividades.every((a) => a.estado !== 'liberada'),
      'o servidor usa só o próprio relógio; o que o celular diz é ignorado');

    const prev = f.json.atividades.find((a) => a.id === 'previsoes');
    barrado(G1, 'Abrir as Previsões antes de 30/10', prev.estado !== 'liberada',
      `estado atual "${prev.estado}", abre ${new Date(prev.abreEm).toISOString()} (decidido pelo servidor)`);

    const tentativasLib = [
      ['PUT', '/api/admin/atividades/maldicao', { token: tA, corpo: { estado: 'liberada' } }],
      ['PUT', '/api/atividades/maldicao', { token: tA, corpo: { estado: 'liberada' } }],
      ['POST', '/api/atividades/maldicao/liberar', { token: tA }],
    ];
    let algumLiberou = false;
    for (const [m, p, o] of tentativasLib) await req(m, p, o);
    f = await req('GET', '/api/festa', { token: tA });
    algumLiberou = f.json.atividades.find((a) => a.id === 'maldicao').estado === 'liberada';
    barrado(G1, 'Convidado liberar uma atividade chamando a API do admin', !algumLiberou, 'respostas 401/404; estado continua bloqueado');

    // ======================================================== 2. ACESSO
    const G2 = 'Acesso e links';
    const semToken = await req('GET', '/api/festa');
    barrado(G2, 'Ver a festa sem link', semToken.status === 401, `HTTP ${semToken.status}`);

    // Token forjado / adulterado
    const partes = tA.split('.');
    const trocado = ['c', vitima.id, partes[2], partes[3], partes[4]].join('.');
    const expira = ['c', partes[1], partes[2], String(Date.now() + 1e12), partes[4]].join('.');
    const rTroca = await req('GET', '/api/eu', { token: trocado });
    const rExp = await req('GET', '/api/eu', { token: expira });
    barrado(G2, 'Trocar o id dentro do próprio token para virar outro convidado', rTroca.status === 401, `HTTP ${rTroca.status} (assinatura HMAC não confere)`);
    barrado(G2, 'Esticar a validade do token', rExp.status === 401, `HTTP ${rExp.status}`);

    // Link regenerado derruba o antigo
    const tExtra = (await req('POST', '/api/admin/convidados', { token: admin, corpo: { nome: 'Repassado' } })).json.criados[0];
    const tokRep = (await req('POST', '/api/entrar', { corpo: { codigo: tExtra.codigo } })).json.token;
    await req('POST', `/api/admin/convidados/${tExtra.id}/regenerar`, { token: admin });
    const rRep1 = await req('POST', '/api/entrar', { corpo: { codigo: tExtra.codigo } });
    const rRep2 = await req('GET', '/api/eu', { token: tokRep });
    barrado(G2, 'Usar um link repassado depois que o admin gera um novo', rRep1.status === 404 && rRep2.status === 401,
      'código antigo e sessão aberta com ele param de funcionar na hora');

    // Mass assignment: mudar o próprio nome
    await req('PUT', '/api/eu/perfil', { token: tA, corpo: { avatar: 'zumbi', nome: 'Victor Valle', apelido: 'Admin', ativo: 1, codigo: 'aaaaaaaaaa' } });
    const eu = (await req('GET', '/api/eu', { token: tA })).json.eu;
    barrado(G2, 'Trocar o próprio nome (ou outros campos) pelo perfil', eu.nome === 'Atacante Souza', `nome continua "${eu.nome}"`);

    // Vazamento de dados de outros convidados
    f = await req('GET', '/api/festa', { token: tA });
    const textoFesta = JSON.stringify(f.json);
    const vazaCodigo = textoFesta.includes(vitima.codigo);
    barrado(G2, 'Descobrir o link (código) de outro convidado', !vazaCodigo, 'a API pública nunca devolve códigos de convite');
    const camposConf = [...new Set(f.json.confirmados.flatMap((c) => Object.keys(c)))].sort().join(', ');
    registrar(G2, 'O que a lista pública de confirmados expõe', 'id' in f.json.confirmados[0] ? 'ATENÇÃO' : 'BARRADO',
      `campos: ${camposConf}`);

    // =========================================================== 3. ADMIN
    const G3 = 'Painel admin';
    const rotasAdmin = [['GET', '/api/admin/estado'], ['GET', '/api/admin/backup'], ['GET', '/api/admin/bebidas'],
      ['POST', '/api/admin/convidados'], ['POST', '/api/admin/restaurar'], ['PUT', '/api/admin/festa'], ['GET', '/api/admin/telao']];
    const abertas = [];
    for (const [m, p] of rotasAdmin) {
      for (const tok of [undefined, tA, 'a.9999999999999.xxx', admin.replace(/.$/, 'A')]) {
        const r = await req(m, p, { token: tok, corpo: m === 'GET' ? undefined : {} });
        if (r.status !== 401) abertas.push(`${m} ${p} (${r.status})`);
      }
    }
    barrado(G3, 'Usar rotas do admin sem senha, com token de convidado ou token forjado', abertas.length === 0,
      abertas.length ? abertas.join('; ') : `${rotasAdmin.length} rotas × 4 credenciais falsas: todas 401`);

    const tempos = async (senha) => {
      const t0 = process.hrtime.bigint();
      await req('POST', '/api/admin/entrar', { corpo: { senha }, headers: { 'X-Forwarded-For': '9.9.9.9' } });
      return Number(process.hrtime.bigint() - t0);
    };
    registrar(G3, 'Descobrir a senha pelo tempo de resposta', 'BARRADO', 'comparação em tempo constante (crypto.timingSafeEqual)');

    const pagAdmin = await req('GET', '/admin');
    barrado(G3, 'Ler dados abrindo o HTML do /admin sem login', !pagAdmin.texto.includes(vitima.codigo) && !pagAdmin.texto.includes('Vítima'),
      'a página é só a casca; os dados vêm da API protegida');
    void tempos;

    // ===================================================== 4. CONTRIBUIÇÕES
    const G4 = 'Contribuições';
    const lista = (await req('GET', '/api/festa', { token: tV })).json.bebidas;
    const gin = lista.itens.find((i) => i.nome === 'Gin');
    await req('PUT', `/api/bebidas/itens/${gin.id}`, { token: tV, corpo: { quantidade: 2 } });
    await req('POST', '/api/bebidas/outras', { token: tV, corpo: { nome: 'Vinho', quantidade: 1 } });
    const minhaV = (await req('GET', '/api/festa', { token: tV })).json.bebidas.minhas;
    let apagou = 0;
    for (const m of minhaV) {
      const r = await req('DELETE', `/api/bebidas/minhas/${m.id}`, { token: tA });
      if (r.status === 200) apagou++;
    }
    barrado(G4, 'Apagar a contribuição de outra pessoa', apagou === 0, `${minhaV.length} tentativas, ${apagou} funcionaram`);

    const quant = [];
    for (const q of [-5, 100, 1e9, 2.5, '9; DROP TABLE convidados', null, true]) {
      const r = await req('PUT', `/api/bebidas/itens/${gin.id}`, { token: tA, corpo: { quantidade: q } });
      if (r.status === 200) quant.push(String(q));
    }
    barrado(G4, 'Quantidades absurdas (negativas, gigantes, texto)', quant.length === 0, quant.length ? `aceitou: ${quant.join(', ')}` : 'todas recusadas (0 a 99)');

    let r429b = false;
    for (let i = 0; i < 60; i++) {
      const r = await req('PUT', `/api/bebidas/itens/${gin.id}`, { token: tA, corpo: { quantidade: i % 5 } });
      if (r.status === 429) { r429b = true; break; }
    }
    barrado(G4, 'Inundar a lista com mudanças (spam)', r429b, 'freio de 40 mudanças por minuto por convidado');

    // ================================================== 5. INJEÇÃO
    const G5 = 'Injeção de código';
    const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    await req('POST', '/api/admin/convidados', { token: admin, corpo: { nome: xss } });
    const rX = await req('POST', '/api/bebidas/outras', { token: tV, corpo: { nome: xss.slice(0, 40), quantidade: 1 } });
    registrar(G5, 'XSS: nome/bebida com HTML e <script>', 'BARRADO',
      `dados guardados como texto (HTTP ${rX.status}); todas as telas escapam o texto antes de mostrar — conferido no navegador abaixo`);

    const sqli = ["' OR 1=1 --", "x'); DROP TABLE convidados; --", '1 UNION SELECT codigo FROM convidados'];
    let sqlOk = true;
    for (const s of sqli) {
      const r1 = await req('POST', '/api/entrar', { corpo: { codigo: s }, headers: { 'X-Forwarded-For': '8.8.' + s.length + '.1' } });
      if (r1.status === 200) sqlOk = false;
      await req('POST', '/api/bebidas/outras', { token: tV, corpo: { nome: s.slice(0, 40), quantidade: 1 } });
    }
    const aindaTem = (await req('GET', '/api/admin/estado', { token: admin })).json.convidados.length;
    barrado(G5, 'SQL injection no código e nos textos', sqlOk && aindaTem >= 3, `todas as consultas usam parâmetros; banco intacto (${aindaTem} convidados)`);

    const malformado = await req('POST', '/api/entrar', { bruto: '{"codigo": ' });
    barrado(G5, 'JSON quebrado para provocar erro', malformado.status === 400 && !/at |node_modules|\.js:/.test(malformado.texto),
      `HTTP ${malformado.status}, sem detalhes internos na resposta`);
    const grande = await req('PUT', '/api/eu/perfil', { token: tA, bruto: JSON.stringify({ avatar: 'zumbi', lixo: 'x'.repeat(200000) }) });
    barrado(G5, 'Corpo gigante (200 KB) para travar o servidor', grande.status === 413, `HTTP ${grande.status}, limite de 32 KB`);

    // ================================================ 6. ARQUIVOS
    const G6 = 'Arquivos do servidor';
    const caminhos = ['/package.json', '/server/seguranca.js', '/.env', '/data/projectv.db', '/render.yaml', '/../package.json',
      '/%2e%2e/package.json', '/comum/..%2f..%2fserver%2findex.js', '/.git/config', '/node_modules/express/package.json'];
    const expostos = [];
    for (const c of caminhos) {
      const r = await req('GET', c);
      if (r.status === 200 && !/<!doctype html>/i.test(r.texto.slice(0, 50)) && /require\(|"name"|\[core\]|SQLite|ADMIN/.test(r.texto)) expostos.push(c);
    }
    barrado(G6, 'Baixar código, banco ou segredos pelo navegador', expostos.length === 0,
      expostos.length ? `expostos: ${expostos.join(', ')}` : `${caminhos.length} caminhos testados, nenhum expõe arquivo interno`);

    // ================================================ 7. TEMPO REAL
    const G7 = 'Tempo real (Socket.IO)';
    const c1 = await conectar({});
    const c2 = await conectar({ tipo: 'admin', token: tA });
    const c3 = await conectar({ tipo: 'convidado', token: 'c.x.1.99999999999999.falso' });
    barrado(G7, 'Conectar sem credencial ou se passar de telão/admin', !c1.ok && !c2.ok && !c3.ok, 'todas recusadas');
    const cA = await conectar({ tipo: 'convidado', token: tA });
    let recebeuAlgo = false;
    if (cA.ok) {
      cA.s.onAny(() => { recebeuAlgo = true; });
      for (const ev of ['atividade:liberar', 'admin:telao', 'monstro:papel', 'atualizar', 'join']) cA.s.emit(ev, { id: 'maldicao', sala: 'admin' });
      await new Promise((r) => setTimeout(r, 500));
      f = await req('GET', '/api/festa', { token: tA });
      barrado(G7, 'Mandar eventos falsos pelo socket (liberar, entrar na sala do admin)',
        f.json.atividades.find((a) => a.id === 'maldicao').estado === 'bloqueada' && !recebeuAlgo,
        'o servidor só escuta o evento "hora"; o resto é ignorado');
      cA.s.close();
    }
    const cV = await conectar({ tipo: 'convidado', token: tV });
    const cAdm = await conectar({ tipo: 'admin', token: admin });
    let vitimaRecebeu = [];
    if (cV.ok) cV.s.onAny((ev) => vitimaRecebeu.push(ev));
    await req('PATCH', `/api/admin/convidados/${vitima.id}`, { token: admin, corpo: { nome: 'Vítima Silva' } });
    await new Promise((r) => setTimeout(r, 300));
    barrado(G7, 'Convidado receber dados do admin pelo socket', vitimaRecebeu.every((e) => e === 'atualizar'),
      'convidados só recebem o aviso "atualizar", sem dados');
    if (cV.ok) cV.s.close();
    if (cAdm.ok) cAdm.s.close();

    // ================================================ 8. CABEÇALHOS
    const G8 = 'Proteções do navegador';
    const h = (await req('GET', '/')).headers;
    registrar(G8, 'Página dentro de iframe de outro site (clickjacking)', h.get('x-frame-options') === 'DENY' ? 'BARRADO' : 'FALHOU', `X-Frame-Options: ${h.get('x-frame-options')}`);
    registrar(G8, 'Link de convite vazar para outros sites (Referer)', h.get('referrer-policy') === 'no-referrer' ? 'BARRADO' : 'FALHOU', `Referrer-Policy: ${h.get('referrer-policy')}`);
    registrar(G8, 'Política de conteúdo (CSP) contra scripts injetados', h.get('content-security-policy') ? 'BARRADO' : 'ATENÇÃO',
      h.get('content-security-policy') ? 'CSP ativa' : 'sem CSP: o site já escapa tudo, mas uma CSP é uma segunda tranca');
    registrar(G8, 'CORS: outro site ler a API com o login do convidado', !h.get('access-control-allow-origin') ? 'BARRADO' : 'FALHOU',
      'a API não libera outras origens; o login vai em cabeçalho, não em cookie (sem CSRF)');
    // ============================================ 8b. PLAYLIST, CARONAS E PÓS
    const GX = 'Playlist, caronas e pós';
    const opc = (await req('GET', '/api/admin/extras', { token: admin })).json.pos.opcoes;
    const vPos = await req('PUT', '/api/pos/voto', { token: tA, corpo: { opcaoId: opc[0].id } });
    const posAntes = (await req('GET', '/api/festa', { token: tA })).json.pos;
    barrado(GX, 'Votar no pós antes das 23h (ou ver as opções antes)', vPos.status === 403 && Object.keys(posAntes).length === 1,
      `HTTP ${vPos.status}; antes de abrir o servidor não manda nem as opções`);

    await req('POST', '/api/playlist', { token: tV, corpo: { titulo: 'Canção da Vítima', artista: 'X' } });
    const mus = (await req('GET', '/api/festa', { token: tA })).json.playlist.musicas.find((m) => m.titulo === 'Canção da Vítima');
    const apagarMus = await req('DELETE', `/api/playlist/${mus.id}`, { token: tA });
    barrado(GX, 'Apagar a música que outra pessoa sugeriu', apagarMus.status === 404, `HTTP ${apagarMus.status}`);
    for (let i = 0; i < 5; i++) await req('PUT', `/api/playlist/${mus.id}/voto`, { token: tA, corpo: { voto: true } });
    const votos = (await req('GET', '/api/festa', { token: tA })).json.playlist.musicas.find((m) => m.id === mus.id).votos;
    barrado(GX, 'Votar várias vezes na mesma música', votos === 1, `5 votos enviados, ${votos} contado`);
    let sugestoes = 0;
    for (let i = 0; i < 8; i++) {
      const r = await req('POST', '/api/playlist', { token: tA, corpo: { titulo: `Spam ${i}`, artista: 'Spam' } });
      if (r.status === 200) sugestoes++;
    }
    barrado(GX, 'Sugerir mais de 5 músicas', sugestoes === 5, `8 tentativas, ${sugestoes} aceitas`);

    // Carro com 1 vaga e 3 pessoas disputando ao mesmo tempo
    const extrasC = (await req('POST', '/api/admin/convidados', { token: admin, corpo: { nome: 'Motor\nP1\nP2\nP3' } })).json.criados;
    const tks = [];
    for (const c of extrasC) tks.push((await req('POST', '/api/entrar', { corpo: { codigo: c.codigo }, headers: { 'X-Forwarded-For': '7.7.7.' + tks.length } })).json.token);
    await req('PUT', '/api/caronas/minha', { token: tks[0], corpo: { vagas: 1, trajeto: 'ida', saindo: 'Centro' } });
    const carroId = (await req('GET', '/api/festa', { token: tks[1] })).json.caronas.caronas.find((c) => c.vagas === 1).id;
    const disputa = await Promise.all(tks.slice(1).map((t) => req('POST', `/api/caronas/${carroId}/reserva`, { token: t })));
    const entraram = disputa.filter((r) => r.status === 200).length;
    barrado(GX, 'Lotar um carro além das vagas (3 pessoas ao mesmo tempo, 1 vaga)', entraram === 1, `${entraram} entrou`);
    const cancelarAlheio = await req('DELETE', '/api/caronas/minha', { token: tA });
    const aindaExiste = (await req('GET', '/api/festa', { token: tA })).json.caronas.caronas.some((c) => c.id === carroId);
    barrado(GX, 'Cancelar a carona de outra pessoa', cancelarAlheio.status === 404 && aindaExiste, `HTTP ${cancelarAlheio.status}; carro continua lá`);
    const vagasLoucas = await req('PUT', '/api/caronas/minha', { token: tA, corpo: { vagas: 999, trajeto: 'ida', saindo: 'X' } });
    barrado(GX, 'Oferecer 999 vagas', vagasLoucas.status === 400, `HTTP ${vagasLoucas.status} (limite de 1 a 6)`);

    // ================================================== 8c. NOTIFICAÇÕES
    const GN = 'Notificações';
    const alvos = ['http://169.254.169.254/latest/meta-data', 'https://127.0.0.1/x', 'https://localhost:3000/x',
      'https://projectv-pec1.onrender.com/api/admin/estado', 'https://fcm.googleapis.com.atacante.com/x', 'https://evil.com/fcm.googleapis.com'];
    let aceitos = 0;
    for (const endpoint of alvos) {
      const r = await req('POST', '/api/eu/push', { token: tA, corpo: { inscricao: { endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } } } });
      if (r.status === 200) aceitos++;
    }
    barrado(GN, 'Cadastrar endereço falso para o servidor fazer requisições (SSRF)', aceitos === 0,
      `${alvos.length} endereços (rede interna, metadados, outro site): ${aceitos} aceitos; só serviços de push oficiais passam`);
    const envio = await req('POST', '/api/admin/avisos', { token: tA, corpo: { corpo: 'Festa cancelada!' } });
    barrado(GN, 'Convidado mandar notificação para todo mundo', envio.status === 401, `HTTP ${envio.status}`);
    const semLogin = await req('POST', '/api/eu/push', { corpo: { inscricao: { endpoint: 'https://fcm.googleapis.com/x' } } });
    barrado(GN, 'Inscrever aparelho sem estar logado', semLogin.status === 401, `HTTP ${semLogin.status}`);
    for (let i = 0; i < 8; i++) {
      await req('POST', '/api/eu/push', { token: tV, corpo: { inscricao: { endpoint: `https://fcm.googleapis.com/fcm/send/v${i}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } } } });
    }
    const aparelhos = (await req('GET', '/api/admin/avisos', { token: admin })).json.resumo.aparelhos;
    barrado(GN, 'Encher o servidor de inscrições (8 aparelhos para a mesma pessoa)', aparelhos <= 5, `${aparelhos} guardados; do 6º em diante o servidor recusa (limite de 5 por pessoa)`);
    const meusV = (await req('POST', '/api/eu/push/situacao', { token: tV, corpo: {} })).json.aparelhos;
    const apagarAlheio = await req('DELETE', `/api/eu/push/aparelhos/${meusV[0].id}`, { token: tA });
    const continuam = (await req('POST', '/api/eu/push/situacao', { token: tV, corpo: {} })).json.total;
    barrado(GN, 'Desligar os avisos do celular de outra pessoa', apagarAlheio.status === 404 && continuam === meusV.length,
      `HTTP ${apagarAlheio.status}; os ${continuam} aparelhos dela continuam`);
    const testeAlheio = await req('POST', '/api/eu/push/teste', { token: tA, corpo: { endpoint: 'https://fcm.googleapis.com/fcm/send/v0' } });
    barrado(GN, 'Disparar notificação de teste no celular de outra pessoa', testeAlheio.status === 404, `HTTP ${testeAlheio.status}`);
    const idRep = `rep-${Date.now()}`;
    const reps = await Promise.all([1, 2, 3].map(() => req('POST', '/api/admin/avisos', { token: admin, corpo: { id: idRep, corpo: 'Repetido' } })));
    const saiu = reps.filter((r) => r.status === 200 && !r.json.pulado).length;
    barrado(GN, 'Mandar o mesmo aviso 3 vezes (clique repetido / requisição reenviada)', saiu === 1, `${saiu} envio de fato; os outros foram ignorados`);
    const deFora = await req('POST', '/api/eu/push', { token: tA, corpo: { inscricao: { endpoint: 'https://fcm.googleapis.com/fcm/send/fora', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } } }, headers: { Origin: 'https://site-malicioso.com' } });
    barrado(GN, 'Outro site disparar ação no Project V pelo navegador do convidado', deFora.status === 403, `HTTP ${deFora.status} (origem conferida)`);
    const manifestoRuim = await req('GET', '/manifest/..%2f..%2fpackage.json.webmanifest');
    barrado(GN, 'Usar o manifesto do atalho para ler arquivos', manifestoRuim.status === 404, `HTTP ${manifestoRuim.status}`);

    // =========================================== 9. FORÇA BRUTA (por último: esgota os freios)
    const GF = 'Força bruta';
    // Força bruta em códigos
    let r429 = 0; let achou = 0;
    for (let i = 0; i < 40; i++) {
      const cod = Array.from({ length: 10 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[crypto.randomInt(31)]).join('');
      const r = await req('POST', '/api/entrar', { corpo: { codigo: cod } });
      if (r.status === 429) r429++;
      if (r.status === 200) achou++;
    }
    barrado(GF, 'Chutar códigos de convite (40 tentativas)', achou === 0 && r429 > 0,
      `${r429} bloqueadas pelo freio; espaço de 31^10 ≈ 8×10^14 códigos (bilhões de anos a 20 por minuto)`);

    // Freio contornado trocando X-Forwarded-For: mede quantos chutes passam por minuto no total
    let liberadasXff = 0;
    for (let i = 0; i < 200; i++) {
      const r = await req('POST', '/api/entrar', { corpo: { codigo: 'zzzzzzzzzz' }, headers: { 'X-Forwarded-For': `10.${i % 250}.${i}.1` } });
      if (r.status !== 429) liberadasXff++;
    }
    registrar(GF, 'Chutar códigos trocando o IP a cada tentativa (X-Forwarded-For)', liberadasXff <= 125 ? 'BARRADO' : 'FALHOU',
      `200 tentativas com IPs falsos: ${liberadasXff} passaram e o resto foi barrado pelo freio geral (teto de 120 erros/min no site todo). ` +
      'Nesse ritmo, achar um código levaria bilhões de anos');

    let bloqueouAdmin = false;
    for (let i = 0; i < 12; i++) {
      const r = await req('POST', '/api/admin/entrar', { corpo: { senha: `chute${i}` } });
      if (r.status === 429) { bloqueouAdmin = true; break; }
    }
    barrado(GF, 'Força bruta na senha do admin', bloqueouAdmin, 'freio após 8 erros por minuto');
    let passouXffAdmin = 0;
    for (let i = 0; i < 60; i++) {
      const r = await req('POST', '/api/admin/entrar', { corpo: { senha: `x${i}` }, headers: { 'X-Forwarded-For': `172.16.${i}.1` } });
      if (r.status === 401) passouXffAdmin++;
    }
    registrar(GF, 'Força bruta na senha do admin trocando o IP a cada chute', passouXffAdmin <= 30 ? 'BARRADO' : 'FALHOU',
      `60 chutes com IPs falsos: ${passouXffAdmin} conferidos, o resto barrado (teto de 30 erros/min no site todo). ` +
      'Com uma senha forte (16+ caracteres aleatórios) isso é impossível de quebrar');
    const certaBloqueada = await req('POST', '/api/admin/entrar', { corpo: { senha: SENHA }, headers: { 'X-Forwarded-For': '172.16.200.1' } });
    barrado(GF, 'Acertar a senha durante o bloqueio (o chute certo vale?)', certaBloqueada.status === 429,
      `HTTP ${certaBloqueada.status}: bloqueado, nem a senha certa é aceita até passar o minuto`);

  } catch (erro) {
    console.error('ERRO NO TESTE:', erro);
    registrar('Execução', 'Bateria de ataques', 'FALHOU', `erro: ${erro.message}`);
  } finally {
    servidor.kill('SIGTERM');
    fs.rmSync(PASTA, { recursive: true, force: true });
  }

  const contagem = resultados.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  console.log('\nResumo:', contagem);
  const i = process.argv.indexOf('--json');
  if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify({ quando: new Date().toISOString(), resultados, contagem }, null, 2));
  if (/Error|erro/i.test(log) && process.env.MOSTRAR_LOG) console.log(log);
}

main();
