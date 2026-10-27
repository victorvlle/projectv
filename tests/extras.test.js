// Playlist da Noite, Caronas, Como chegar e O Pós.
const test = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const banco = require('../server/dados/banco');

let s;
let admin;
test.before(async () => { s = await subir(); admin = await s.tokenAdmin(); });
test.after(async () => { await s.fechar(); });

async function convidado(nome, avatar = 'bruxa') {
  const c = (await s.req('POST', '/api/admin/convidados', { token: admin, corpo: { nome } })).json.criados[0];
  const token = (await s.req('POST', '/api/entrar', { corpo: { codigo: c.codigo } })).json.token;
  await s.req('PUT', '/api/eu/perfil', { token, corpo: { avatar } });
  return { ...c, token };
}
const festa = async (t) => (await s.req('GET', '/api/festa', { token: t })).json;

// ------------------------------------------------------------------ playlist
test('playlist: até 5 sugestões por pessoa, repetida vira voto, ordem por votos', async () => {
  const a = await convidado('Dani');
  const b = await convidado('Edu');
  for (let i = 1; i <= 5; i++) {
    assert.equal((await s.req('POST', '/api/playlist', { token: a.token, corpo: { titulo: `Música ${i}`, artista: 'Banda' } })).status, 200);
  }
  const sexta = await s.req('POST', '/api/playlist', { token: a.token, corpo: { titulo: 'Música 6', artista: 'Banda' } });
  assert.equal(sexta.status, 400);

  // Mesma música com acento/maiúscula diferente: não duplica, vira voto
  const rep = await s.req('POST', '/api/playlist', { token: b.token, corpo: { titulo: 'MÚSICA 3', artista: 'banda' } });
  assert.equal(rep.json.jaExistia, true);
  let p = (await festa(b.token)).playlist;
  assert.equal(p.musicas.filter((m) => m.titulo === 'Música 3').length, 1);
  assert.equal(p.musicas[0].titulo, 'Música 3');
  assert.equal(p.musicas[0].votos, 1);
  assert.equal(p.musicas[0].votei, true);
  assert.equal(p.minhas, 0);

  // Votar e desvotar
  const m1 = p.musicas.find((m) => m.titulo === 'Música 1');
  await s.req('PUT', `/api/playlist/${m1.id}/voto`, { token: b.token, corpo: { voto: true } });
  await s.req('PUT', `/api/playlist/${m1.id}/voto`, { token: b.token, corpo: { voto: true } }); // não conta duas vezes
  p = (await festa(b.token)).playlist;
  assert.equal(p.musicas.find((m) => m.id === m1.id).votos, 1);
  await s.req('PUT', `/api/playlist/${m1.id}/voto`, { token: b.token, corpo: { voto: false } });
  p = (await festa(b.token)).playlist;
  assert.equal(p.musicas.find((m) => m.id === m1.id).votos, 0);

  // Quem sugeriu não vota na própria música (nem pelo voto, nem sugerindo de novo)
  const propria = await s.req('PUT', `/api/playlist/${m1.id}/voto`, { token: a.token, corpo: { voto: true } });
  assert.equal(propria.status, 403);
  const deNovo = await s.req('POST', '/api/playlist', { token: a.token, corpo: { titulo: 'música 1', artista: 'BANDA' } });
  assert.equal(deNovo.status, 400);
  // Voto antigo na própria música (de antes da regra) não conta
  await banco.rodar('INSERT INTO playlist_votos (musica_id, convidado_id, criado_em) VALUES (?, ?, ?)', [m1.id, a.id, Date.now()]);
  p = (await festa(a.token)).playlist;
  assert.equal(p.musicas.find((m) => m.id === m1.id).votos, 0);
  await banco.rodar('DELETE FROM playlist_votos WHERE musica_id = ? AND convidado_id = ?', [m1.id, a.id]);

  // Só o autor tira a própria sugestão
  assert.equal((await s.req('DELETE', `/api/playlist/${m1.id}`, { token: b.token })).status, 404);
  assert.equal((await s.req('DELETE', `/api/playlist/${m1.id}`, { token: a.token })).status, 200);
  assert.equal((await s.req('POST', '/api/playlist', { token: a.token, corpo: { titulo: 'Música 6', artista: 'Banda' } })).status, 200);

  // Admin tira qualquer uma
  const m2 = (await festa(a.token)).playlist.musicas.find((m) => m.titulo === 'Música 2');
  assert.equal((await s.req('DELETE', `/api/admin/playlist/${m2.id}`, { token: admin })).status, 200);
  assert.equal((await s.req('DELETE', `/api/admin/playlist/${m2.id}`, { token: a.token })).status, 401);

  assert.equal((await s.req('POST', '/api/playlist', { token: a.token, corpo: { titulo: '', artista: 'x' } })).status, 400);
});

// ------------------------------------------------------------------- caronas
test('caronas: oferecer, reservar, não lotar além das vagas, uma reserva por pessoa', async () => {
  const mot = await convidado('Motorista');
  const p1 = await convidado('Passageiro Um');
  const p2 = await convidado('Passageiro Dois');
  const p3 = await convidado('Passageiro Três');

  assert.equal((await s.req('PUT', '/api/caronas/minha', { token: mot.token, corpo: { vagas: 0, trajeto: 'ida', saindo: 'Centro' } })).status, 400);
  assert.equal((await s.req('PUT', '/api/caronas/minha', { token: mot.token, corpo: { vagas: 2, trajeto: 'avião', saindo: 'Centro' } })).status, 400);
  assert.equal((await s.req('PUT', '/api/caronas/minha', { token: mot.token, corpo: { vagas: 2, trajeto: 'ida_volta', saindo: 'Adrianópolis', obs: 'Saio 16h30' } })).status, 200);

  let c = (await festa(p1.token)).caronas;
  const carro = c.caronas[0];
  assert.equal(carro.livres, 2);
  assert.equal(carro.trajetoTexto, 'Ida e volta');

  assert.equal((await s.req('POST', `/api/caronas/${carro.id}/reserva`, { token: mot.token })).status, 400); // o próprio carro
  assert.equal((await s.req('POST', `/api/caronas/${carro.id}/reserva`, { token: p1.token })).status, 200);
  assert.equal((await s.req('POST', `/api/caronas/${carro.id}/reserva`, { token: p1.token })).status, 400); // já reservou
  // Duas pessoas ao mesmo tempo disputando a última vaga: só uma entra
  const [r2, r3] = await Promise.all([
    s.req('POST', `/api/caronas/${carro.id}/reserva`, { token: p2.token }),
    s.req('POST', `/api/caronas/${carro.id}/reserva`, { token: p3.token }),
  ]);
  assert.deepEqual([r2.status, r3.status].sort(), [200, 409]);
  c = (await festa(p1.token)).caronas;
  assert.equal(c.caronas[0].livres, 0);
  assert.equal(c.caronas[0].passageiros.length, 2);
  assert.equal(c.reservaEm, carro.id);

  // Motorista não pode reduzir vagas abaixo de quem já está no carro
  assert.equal((await s.req('PUT', '/api/caronas/minha', { token: mot.token, corpo: { vagas: 1, trajeto: 'ida', saindo: 'Centro' } })).status, 400);
  // Passageiro com reserva não pode oferecer
  assert.equal((await s.req('PUT', '/api/caronas/minha', { token: p1.token, corpo: { vagas: 3, trajeto: 'ida', saindo: 'X' } })).status, 400);

  assert.equal((await s.req('DELETE', '/api/caronas/reserva', { token: p1.token })).status, 200);
  assert.equal((await festa(p1.token)).caronas.caronas[0].livres, 1);

  // Cancelar a oferta libera todo mundo
  assert.equal((await s.req('DELETE', '/api/caronas/minha', { token: mot.token })).status, 200);
  c = (await festa(p2.token)).caronas;
  assert.equal(c.caronas.length, 0);
  assert.equal(c.reservaEm, null);
});

// -------------------------------------------------------------- como chegar
test('como chegar: informações editáveis no admin aparecem para o convidado', async () => {
  const c = await convidado('Chegante');
  let f = (await festa(c.token)).festa;
  assert.match(f.chegada.endereco, /Singolare/);
  await s.req('PUT', '/api/admin/festa', { token: admin, corpo: { chegadaEndereco: 'Rua X, 100', chegadaEstacionamento: 'Vagas de visitante na frente' } });
  f = (await festa(c.token)).festa;
  assert.equal(f.chegada.endereco, 'Rua X, 100');
  assert.equal(f.chegada.estacionamento, 'Vagas de visitante na frente');
});

// ---------------------------------------------------------------------- pós
test('pós: fechado até 23h (sem vazar opções), vota e troca o voto, fecha no fim da festa', async () => {
  const a = await convidado('Notívago');
  const b = await convidado('Coruja');
  let p = (await festa(a.token)).pos;
  assert.deepEqual(p, { liberada: false });
  const card = (await festa(a.token)).atividades.find((x) => x.id === 'pos');
  assert.equal(card.estado, 'agendada');
  assert.equal(card.abreEm, Date.parse('2026-10-31T23:00:00-04:00'));
  assert.equal(card.nome, undefined);

  const opcoes = (await s.req('GET', '/api/admin/extras', { token: admin })).json.pos.opcoes;
  assert.deepEqual(opcoes.map((o) => o.nome), ["Bello's Club", 'Condado Bar', 'Augusta Haus']);
  assert.equal((await s.req('PUT', '/api/pos/voto', { token: a.token, corpo: { opcaoId: opcoes[0].id } })).status, 403);

  // Simula 23h: libera; fim da festa ainda no futuro
  await s.req('PUT', '/api/admin/atividades/pos', { token: admin, corpo: { estado: 'liberada' } });
  await s.req('PUT', '/api/admin/festa', { token: admin, corpo: { inicio: new Date(Date.now() - 3600e3).toISOString(), fim: new Date(Date.now() + 3600e3).toISOString() } });
  assert.equal((await s.req('PUT', '/api/pos/voto', { token: a.token, corpo: { opcaoId: opcoes[1].id } })).status, 200);
  assert.equal((await s.req('PUT', '/api/pos/voto', { token: b.token, corpo: { opcaoId: opcoes[1].id } })).status, 200);
  assert.equal((await s.req('PUT', '/api/pos/voto', { token: a.token, corpo: { opcaoId: opcoes[2].id } })).status, 200); // troca
  assert.equal((await s.req('PUT', '/api/pos/voto', { token: a.token, corpo: { opcaoId: 99999 } })).status, 404);
  p = (await festa(a.token)).pos;
  assert.equal(p.aberta, true);
  assert.equal(p.total, 2);
  assert.equal(p.meuVoto, opcoes[2].id);
  assert.deepEqual(p.lideres.sort(), [opcoes[1].id, opcoes[2].id].sort());

  // Festa acabou: votação fecha e o resultado continua visível
  await s.req('PUT', '/api/admin/festa', { token: admin, corpo: { fim: new Date(Date.now() - 1000).toISOString() } });
  assert.equal((await s.req('PUT', '/api/pos/voto', { token: b.token, corpo: { opcaoId: opcoes[2].id } })).status, 403);
  p = (await festa(a.token)).pos;
  assert.equal(p.encerrada, true);
  assert.equal(p.total, 2);

  // Telão recebe o resultado
  const tel = (await s.req('GET', '/api/admin/telao', { token: admin })).json;
  assert.equal(tel.pos.total, 2);
  assert.equal((await s.req('PUT', '/api/admin/telao', { token: admin, corpo: { modo: 'pos' } })).status, 200);

  // Admin edita opções
  assert.equal((await s.req('POST', '/api/admin/pos/opcoes', { token: admin, corpo: { nome: 'Casa do Victor' } })).status, 200);
  assert.equal((await s.req('POST', '/api/admin/pos/opcoes', { token: admin, corpo: { nome: 'condado bar' } })).status, 409);

  // Restaura horários
  await s.req('PUT', '/api/admin/festa', { token: admin, corpo: { inicio: '2026-10-31T17:00:00-04:00', fim: '2026-11-01T00:00:00-04:00' } });
});

test('excluir convidado leva junto música, votos, carona e voto do pós', async () => {
  const c = await convidado('Some Daqui');
  await s.req('POST', '/api/playlist', { token: c.token, corpo: { titulo: 'Tchau', artista: 'Ninguém' } });
  await s.req('PUT', '/api/caronas/minha', { token: c.token, corpo: { vagas: 3, trajeto: 'ida', saindo: 'Centro' } });
  assert.equal((await s.req('DELETE', `/api/admin/convidados/${c.id}`, { token: admin })).status, 200);
  const sobrou = await banco.um(
    `SELECT (SELECT COUNT(*) FROM playlist_musicas WHERE convidado_id = ?) +
            (SELECT COUNT(*) FROM caronas WHERE motorista_id = ?) AS n`, [c.id, c.id]);
  assert.equal(Number(sobrou.n), 0);
});

test('backup inclui as tabelas novas e restaura', async () => {
  const copia = await (await s.req('GET', '/api/admin/backup', { token: admin, cru: true })).json();
  for (const t of ['playlist_musicas', 'playlist_votos', 'caronas', 'caronas_reservas', 'pos_opcoes', 'pos_votos']) {
    assert.ok(Array.isArray(copia.tabelas[t]), t);
  }
  assert.equal((await s.req('POST', '/api/admin/restaurar', { token: admin, corpo: copia })).status, 200);
});
