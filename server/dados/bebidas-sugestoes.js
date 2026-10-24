// Lista inicial de bebidas com metas (quantidade ideal para a festa).
// É só um ponto de partida: nomes, unidades e metas são editáveis no admin.
// Inclui opções sem álcool, porque quem não bebe também cumpre os castigos.

const SUGESTOES = [
  { nome: 'Cerveja', unidade: 'latas', meta: 72 },
  { nome: 'Vodka', unidade: 'garrafas', meta: 3 },
  { nome: 'Tequila (para os shots)', unidade: 'garrafas', meta: 2 },
  { nome: 'Cachaça', unidade: 'garrafas', meta: 2 },
  { nome: 'Gin', unidade: 'garrafas', meta: 2 },
  { nome: 'Energético', unidade: 'latas', meta: 18 },
  { nome: 'Refrigerante', unidade: 'garrafas de 2 L', meta: 6 },
  { nome: 'Suco', unidade: 'litros', meta: 4 },
  { nome: 'Água', unidade: 'garrafas de 1,5 L', meta: 6 },
  { nome: 'Gelo', unidade: 'sacos', meta: 10 },
];

module.exports = { SUGESTOES };
