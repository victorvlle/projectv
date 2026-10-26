// Caronas: quem vai de carro oferece vagas; quem precisa reserva uma.
// Regras: uma oferta por motorista; uma reserva por pessoa; motorista não reserva
// no carro dos outros; nunca passa do número de vagas (checado no próprio INSERT).

const banco = require('./banco');
const { ErroValidacao, limparTexto } = require('./convidados');

const TRAJETOS = { ida: 'Só ida', volta: 'Só volta', ida_volta: 'Ida e volta' };

function validarOferta({ vagas, trajeto, saindo, obs }) {
  const v = Number(vagas);
  if (!Number.isInteger(v) || typeof vagas === 'boolean' || v < 1 || v > 6) throw new ErroValidacao('As vagas precisam ser de 1 a 6.');
  if (!TRAJETOS[trajeto]) throw new ErroValidacao('Escolha se é ida, volta ou ida e volta.');
  const s = limparTexto(saindo, 40);
  if (s.length < 2) throw new ErroValidacao('Diga de onde você sai (bairro ou ponto de encontro).');
  return { vagas: v, trajeto, saindo: s, obs: limparTexto(obs, 100) || null };
}

async function listar(euId) {
  const [ofertas, reservas] = await Promise.all([
    banco.tudo(
      `SELECT k.*, c.nome AS motorista, c.avatar FROM caronas k JOIN convidados c ON c.id = k.motorista_id
        WHERE c.ativo = 1 ORDER BY k.criado_em`),
    banco.tudo(
      `SELECT r.carona_id, r.convidado_id, c.nome, c.avatar FROM caronas_reservas r JOIN convidados c ON c.id = r.convidado_id
        WHERE c.ativo = 1 ORDER BY r.criado_em`),
  ]);
  const lista = ofertas.map((k) => {
    const passageiros = reservas.filter((r) => Number(r.carona_id) === Number(k.id));
    return {
      id: Number(k.id), motorista: k.motorista, avatar: k.avatar, minha: k.motorista_id === euId,
      vagas: Number(k.vagas), livres: Math.max(0, Number(k.vagas) - passageiros.length),
      trajeto: k.trajeto, trajetoTexto: TRAJETOS[k.trajeto], saindo: k.saindo, obs: k.obs,
      passageiros: passageiros.map((p) => ({ nome: p.nome, avatar: p.avatar, souEu: p.convidado_id === euId })),
    };
  });
  const minhaReserva = reservas.find((r) => r.convidado_id === euId);
  return {
    caronas: lista,
    souMotorista: lista.some((k) => k.minha),
    reservaEm: minhaReserva ? Number(minhaReserva.carona_id) : null,
    trajetos: TRAJETOS,
  };
}

async function oferecer(convidadoId, dados) {
  const o = validarOferta(dados);
  if (await banco.um('SELECT 1 FROM caronas_reservas WHERE convidado_id = ?', [convidadoId])) {
    throw new ErroValidacao('Você já reservou uma carona. Cancele a reserva antes de oferecer.');
  }
  const atual = await banco.um('SELECT id FROM caronas WHERE motorista_id = ?', [convidadoId]);
  if (atual) {
    const ocupadas = await banco.um('SELECT COUNT(*) AS n FROM caronas_reservas WHERE carona_id = ?', [atual.id]);
    if (o.vagas < Number(ocupadas.n)) {
      throw new ErroValidacao(`Já tem ${ocupadas.n} pessoa(s) no seu carro. Não dá para ter menos vagas que isso.`);
    }
    await banco.rodar('UPDATE caronas SET vagas = ?, trajeto = ?, saindo = ?, obs = ? WHERE id = ?',
      [o.vagas, o.trajeto, o.saindo, o.obs, atual.id]);
    return;
  }
  await banco.rodar('INSERT INTO caronas (motorista_id, vagas, trajeto, saindo, obs, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
    [convidadoId, o.vagas, o.trajeto, o.saindo, o.obs, Date.now()]);
  require('../notificacoes').evento('carona', convidadoId);
}

async function cancelarOferta(convidadoId) {
  const atual = await banco.um('SELECT id FROM caronas WHERE motorista_id = ?', [convidadoId]);
  if (!atual) throw new ErroValidacao('Você não está oferecendo carona.', 404);
  await removerOferta(atual.id);
}

async function removerOferta(id) {
  const r = await banco.lote([
    { sql: 'DELETE FROM caronas_reservas WHERE carona_id = ?', args: [Number(id)] },
    { sql: 'DELETE FROM caronas WHERE id = ?', args: [Number(id)] },
  ]);
  if (!r[1].rowsAffected) throw new ErroValidacao('Carona não encontrada.', 404);
}

async function reservar(convidadoId, caronaId) {
  const k = await banco.um('SELECT * FROM caronas WHERE id = ?', [Number(caronaId)]);
  if (!k) throw new ErroValidacao('Essa carona não existe mais.', 404);
  if (k.motorista_id === convidadoId) throw new ErroValidacao('Esse carro é seu.');
  if (await banco.um('SELECT 1 FROM caronas WHERE motorista_id = ?', [convidadoId])) {
    throw new ErroValidacao('Você está oferecendo carona. Cancele a oferta antes de reservar.');
  }
  if (await banco.um('SELECT 1 FROM caronas_reservas WHERE convidado_id = ?', [convidadoId])) {
    throw new ErroValidacao('Você já tem uma carona reservada. Cancele antes de trocar.');
  }
  // Insere só se ainda houver vaga: a conferência e a gravação são um comando só,
  // então duas pessoas apertando ao mesmo tempo não lotam o carro além do limite.
  let r;
  try {
    r = await banco.rodar(
      `INSERT INTO caronas_reservas (carona_id, convidado_id, criado_em)
       SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM caronas_reservas WHERE carona_id = ?) < (SELECT vagas FROM caronas WHERE id = ?)`,
      [k.id, convidadoId, Date.now(), k.id, k.id]);
  } catch (erro) {
    if (/UNIQUE/i.test(erro.message)) throw new ErroValidacao('Você já tem uma carona reservada.');
    throw erro;
  }
  if (!r.rowsAffected) throw new ErroValidacao('Esse carro já está cheio.', 409);
}

async function cancelarReserva(convidadoId) {
  const r = await banco.rodar('DELETE FROM caronas_reservas WHERE convidado_id = ?', [convidadoId]);
  if (!r.rowsAffected) throw new ErroValidacao('Você não tem reserva.', 404);
}

module.exports = { listar, oferecer, cancelarOferta, removerOferta, reservar, cancelarReserva, TRAJETOS };
