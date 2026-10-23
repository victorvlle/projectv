// Monstros-avatar que o convidado pode escolher. Lista fechada: o servidor só
// aceita ids daqui, e o navegador só desenha o que vem de /api/avatares.

const AVATARES = [
  { id: 'vampiro', nome: 'Vampiro', emoji: '🧛' },
  { id: 'bruxa', nome: 'Bruxa', emoji: '🧙' },
  { id: 'zumbi', nome: 'Zumbi', emoji: '🧟' },
  { id: 'lobisomem', nome: 'Lobisomem', emoji: '🐺' },
  { id: 'fantasma', nome: 'Fantasma', emoji: '👻' },
  { id: 'abobora', nome: 'Abóbora', emoji: '🎃' },
  { id: 'caveira', nome: 'Caveira', emoji: '💀' },
  { id: 'morcego', nome: 'Morcego', emoji: '🦇' },
  { id: 'aranha', nome: 'Aranha', emoji: '🕷️' },
  { id: 'palhaco', nome: 'Palhaço', emoji: '🤡' },
  { id: 'demonio', nome: 'Demônio', emoji: '👹' },
  { id: 'alien', nome: 'Alienígena', emoji: '👽' },
];

const IDS = new Set(AVATARES.map((a) => a.id));

module.exports = { AVATARES, avatarValido: (id) => IDS.has(id) };
