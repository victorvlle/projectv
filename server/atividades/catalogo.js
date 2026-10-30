// As atividades da festa. Fonte única de verdade para nomes, ordem e estado inicial.
// Enquanto bloqueada, o convidado só vê o nome enigmático; o nome real aparece ao liberar.
// "Em teste": aberta só para os testadores marcados no admin; os outros veem o cadeado.

const ATIVIDADES = [
  {
    id: 'previsoes',
    nome: 'Previsões',
    enigma: 'O Oráculo',
    icone: '🔮',
    descricao: 'Aposte no que vai acontecer na festa. As respostas só são reveladas no fim da noite.',
    // Abre na véspera (sexta, 30/10) para quem já se cadastrou; fecha quando a festa começa.
    padrao: { estado: 'agendada', abreEm: '2026-10-30T00:00:00-04:00' },
  },
  {
    id: 'maldicao',
    nome: 'A Maldição',
    enigma: 'O Caldeirão',
    icone: '🍷',
    descricao: 'De tempos em tempos alguém é amaldiçoado e precisa beber.',
    padrao: { estado: 'bloqueada' },
  },
  {
    id: 'correio',
    nome: 'Mural das Trevas',
    enigma: 'Cartas do Além',
    icone: '📸',
    descricao: 'Mande um recado ou uma foto. Aparece no telão na hora.',
    padrao: { estado: 'bloqueada' },
  },
  {
    id: 'concurso',
    nome: 'Concurso de Fantasia',
    enigma: 'O Desfile Macabro',
    icone: '👑',
    descricao: 'Vote na melhor fantasia da noite. Os três mais votados ganham 1000, 800 e 500 pontos.',
    padrao: { estado: 'bloqueada' },
  },
  {
    id: 'quiz',
    nome: 'Quiz de Terror Relâmpago',
    enigma: 'O Teste do Medo',
    icone: '⚡',
    descricao: 'Perguntas no telão, resposta pelo celular. Uma chance só; quanto mais rápido, mais pontos (até +500).',
    padrao: { estado: 'bloqueada' },
  },
  {
    id: 'corrida',
    nome: 'Corrida de Cavalos',
    enigma: 'O Páreo Maldito',
    icone: '🏇',
    descricao: 'Aposte num naipe e torça no telão. 1º lugar +500, 2º +200; quem apostou no último toma um shot.',
    padrao: { estado: 'bloqueada' },
  },
  {
    id: 'beerpong',
    nome: 'Beer Pong',
    enigma: 'O Ritual dos Copos',
    icone: '🍺',
    descricao: 'Inscreva-se, os trios são sorteados no telão e o mata-mata decide. Campeões +1000 cada, vice +500.',
    padrao: { estado: 'bloqueada' },
  },
  {
    id: 'pos',
    nome: 'O Pós',
    enigma: 'Depois da meia-noite',
    icone: '🌙',
    descricao: 'Vote para onde a noite continua depois da festa.',
    // Abre às 23h do dia da festa; a votação fecha quando a festa termina.
    padrao: { estado: 'agendada', abreEm: '2026-10-31T23:00:00-04:00' },
  },
  {
    id: 'fotos',
    nome: 'Fotos da festa',
    enigma: 'Lembranças do Além',
    icone: '🖼️',
    descricao: 'Todas as fotos do Mural das Trevas. Veja e baixe as suas favoritas.',
    // Só depois da festa: domingo de manhã.
    padrao: { estado: 'agendada', abreEm: '2026-11-01T09:00:00-04:00' },
  },
];

const IDS = new Set(ATIVIDADES.map((a) => a.id));
const porId = (id) => ATIVIDADES.find((a) => a.id === id) || null;

module.exports = { ATIVIDADES, IDS, porId };
