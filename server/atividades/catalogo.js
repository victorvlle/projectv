// As atividades da festa. Fonte única de verdade para nomes, ordem e estado inicial.
// Enquanto bloqueada, o convidado só vê o nome enigmático; o nome real aparece ao liberar.

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
    nome: 'Correio das Trevas',
    enigma: 'Cartas do Além',
    icone: '✉️',
    descricao: 'Mande mensagens anônimas que aparecem no telão.',
    padrao: { estado: 'bloqueada' },
  },
  {
    id: 'concurso',
    nome: 'Concurso de Fantasia',
    enigma: 'O Desfile Macabro',
    icone: '👑',
    descricao: 'Vote nas melhores fantasias da noite.',
    padrao: { estado: 'bloqueada' },
  },
  {
    id: 'mural',
    nome: 'Mural de Fotos',
    enigma: 'O Espelho',
    icone: '📸',
    descricao: 'Suas fotos aparecem no telão em segundos.',
    padrao: { estado: 'bloqueada' },
  },
  {
    id: 'quiz',
    nome: 'Quiz de Terror Relâmpago',
    enigma: 'O Teste do Medo',
    icone: '⚡',
    descricao: 'Perguntas rápidas: quem responde certo mais rápido ganha mais.',
    padrao: { estado: 'bloqueada' },
  },
  {
    id: 'monstro',
    nome: 'O Monstro está entre nós',
    enigma: 'Há um monstro entre vocês',
    icone: '🐺',
    descricao: 'Papéis secretos. Descubra os monstros antes que eles peguem todo mundo.',
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
];

const IDS = new Set(ATIVIDADES.map((a) => a.id));
const porId = (id) => ATIVIDADES.find((a) => a.id === id) || null;

module.exports = { ATIVIDADES, IDS, porId };
