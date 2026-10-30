// Conteúdo dos jogos: perguntas das Previsões, castigos da Maldição e enigmas.
// Os textos iniciais entram no banco uma vez (migração); depois o admin edita pelo painel
// o que for editável (respostas oficiais, enigmas, intensidade da Maldição).

// Revisadas em 29/10: nada que dependa de saber quais jogos vão ter na festa.
const PERGUNTAS = [
  { id: 'ultimo-chegar', ordem: 1, tipo: 'convidado', texto: 'Quem vai chegar por último?' },
  { id: 'primeiro-sair', ordem: 2, tipo: 'convidado', texto: 'Quem vai ser o primeiro a ir embora?' },
  { id: 'da-pt', ordem: 3, tipo: 'convidado', texto: 'Quem vai dar PT?' },
  { id: 'tirar-fantasia', ordem: 4, tipo: 'convidado', texto: 'Quem vai ser o primeiro a tirar a fantasia?' },
  { id: 'primeiro-dancar', ordem: 5, tipo: 'convidado', texto: 'Quem vai ser o primeiro a dançar?' },
  { id: 'ultimo-sair', ordem: 6, tipo: 'convidado', texto: 'Quem vai ser o último a ir embora?' },
  { id: 'fantasia-repetida', ordem: 7, tipo: 'opcoes', texto: 'Qual vai ser a fantasia mais repetida?',
    opcoes: [{ id: 'bruxa', nome: 'Bruxa ou bruxo' }, { id: 'vampiro', nome: 'Vampiro' }, { id: 'zumbi', nome: 'Zumbi' },
      { id: 'caveira', nome: 'Caveira ou esqueleto' }, { id: 'outra', nome: 'Outra' }] },
  { id: 'sobra-bebida', ordem: 8, tipo: 'opcoes', texto: 'O que vai sobrar de bebida?',
    opcoes: [{ id: 'nada', nome: 'Nada, vai acabar tudo' }, { id: 'cerveja', nome: 'Cerveja' },
      { id: 'destilado', nome: 'Destilado (vodka, gin, tequila…)' }, { id: 'sem-alcool', nome: 'Refri, suco ou energético' }] },
  { id: 'fantasia-dupla', ordem: 9, tipo: 'opcoes', texto: 'Quantas duplas ou casais vão chegar com fantasias combinando?',
    opcoes: [{ id: 'nenhuma', nome: 'Nenhuma' }, { id: 'uma', nome: '1' }, { id: 'duas', nome: '2' }, { id: 'tres-mais', nome: '3 ou mais' }] },
  { id: 'sem-fantasia', ordem: 10, tipo: 'opcoes', texto: 'Alguém vai chegar sem fantasia?',
    opcoes: [{ id: 'sim', nome: 'Sim' }, { id: 'nao', nome: 'Não' }] },
];
const PERGUNTAS_REMOVIDAS = ['ganha-concurso', 'mais-amaldicoado', 'mais-fotos', 'rei-trevas', 'longnecks', 'destino-pos', 'chuva'];
const PONTOS_PREVISAO = 1000;

// Castigos da Maldição: todos de bebida (cada um bebe o que estiver bebendo).
// Todos os castigos valem em qualquer ritmo (a intensidade só muda o intervalo entre maldições).
// {a} = sorteado; {b} = parceiro (castigo duplo).
const CASTIGOS = [
  { id: 'monstro', texto: 'Todo mundo com o mesmo monstro que você toma um shot junto.' },
  { id: 'shot', texto: 'Tome um shot.' },
  { id: 'duplo', duplo: true, texto: 'Maldição dupla: {a} e {b} brindam e bebem juntos.' },
  { id: 'vire', texto: 'Vire o que estiver no seu copo.' },
  { id: 'shot-duplo', texto: 'Tome um shot e escolha alguém para tomar outro com você.' },
  { id: 'dois-shots', texto: 'Tome 2 shots.' },
  // foto: true = desafio de foto. O telão abre o Mural e espera a foto da pessoa (mais tempo para cumprir).
  { id: 'foto', foto: true, texto: 'Tire uma selfie assustadora, mande no Mural das Trevas e tome um shot.' },
  { id: 'foto-juri', foto: true, texto: 'Tire uma foto imitando o seu monstro e mande no Mural: quando aparecer no telão, se a galera não aprovar, tome um shot.' },
  { id: 'medo', texto: 'Conte para a roda o seu maior medo ou tome 2 shots.' },
  { id: 'fantasia', texto: 'Escolha a fantasia mais assustadora da festa: você e essa pessoa viram o copo juntos.' },
  { id: 'direita', texto: 'A pessoa à sua direita decide: você vira o copo ou toma um shot.' },
  { id: 'zumbi', texto: 'Ande como zumbi até o bar, tome um shot e volte do mesmo jeito.' },
];
const INTENSIDADES = {
  leve: { nome: 'Leve', minMin: 30, maxMin: 40 },
  moderado: { nome: 'Moderado', minMin: 20, maxMin: 30 },
  caos: { nome: 'Caos', minMin: 10, maxMin: 15 },
};
const PONTOS_MALDICAO = 500;

// Enigmas: 3 por dia (manhã 8h, tarde 13h, noite 19h) de terça a quinta. Cada um fecha quando o
// próximo abre; o último fecha quinta às 23:59. Respostas aceitas comparadas sem acento, maiúsculas, artigos e pontuação.
const FECHA_ENIGMAS = '2026-10-29T23:59:00-04:00';
const PERIODOS = [['manha', 'manhã', '08:00'], ['tarde', 'tarde', '13:00'], ['noite', 'noite', '19:00']];
const DIAS = [['terca', 'Terça', '2026-10-27'], ['quarta', 'Quarta', '2026-10-28'], ['quinta', 'Quinta', '2026-10-29']];
// Enigmas de filmes de terror: recentes e clássicos misturados. Resposta = nome do filme
// (título brasileiro ou original). Nada de spoiler do final.
const TEXTOS_ENIGMAS = {
  'terca-manha': {
    pergunta: 'Três estudantes, uma câmera e uma floresta em Maryland. O mapa foi parar no riacho, montinhos de pedras aparecem na porta da barraca de manhã e a última cena é num porão, com alguém virado para a parede. Qual é o filme?',
    respostas: ['a bruxa de blair', 'bruxa de blair', 'the blair witch project', 'blair witch', 'blair witch project', 'projeto bruxa de blair'],
    dica: '',
  },
  'terca-tarde': {
    pergunta: 'Um fim de semana na casa dos pais da namorada, um jardineiro que corre à noite e uma colher batendo numa xícara de chá que te faz afundar num lugar escuro sem saída. Qual é o filme de 2017?',
    respostas: ['corra', 'get out', 'corra!'],
    dica: '',
  },
  'terca-noite': {
    pergunta: 'Uma mãe que constrói casas em miniatura, uma filha que estala a língua de um jeito que ninguém esquece e um rei do inferno chamado Paimon esperando por um corpo. Qual é o filme de 2018?',
    respostas: ['hereditario', 'hereditary'],
    dica: '',
  },
  'quarta-manha': {
    pergunta: 'Vinte e sete anos de sono separam cada despertar. Tudo começa com um barquinho de papel descendo a enxurrada e termina com sete amigos fazendo um pacto de sangue. Qual é o filme?',
    respostas: ['it', 'it a coisa', 'a coisa', 'it capitulo 1', 'it capitulo um', 'it capitulo 2', 'it capitulo dois', 'it chapter one'],
    dica: '',
  },
  'quarta-tarde': {
    pergunta: 'Uma noite só de inauguração, música capaz de rasgar a fronteira entre passado e futuro, e visitantes que cantam canções irlandesas do lado de fora esperando um convite para entrar. Qual é o filme de 2025?',
    respostas: ['pecadores', 'sinners'],
    dica: '',
  },
  'quarta-noite': {
    pergunta: 'Muito trabalho e nenhuma diversão. Um triciclo ecoando por corredores acarpetados, um barman que não deveria estar ali e uma neve que deixa uma família inteira sem saída. Qual é o filme?',
    respostas: ['o iluminado', 'iluminado', 'the shining'],
    dica: '',
  },
  'quinta-manha': {
    pergunta: 'Uma ilha onde os cavalos enlouquecem, uma escada que aparece e some numa gravação e um anel de luz visto de baixo para cima. A contagem começa quando o telefone toca. Qual é o filme de 2002?',
    respostas: ['o chamado', 'chamado', 'the ring', 'ringu', 'ring'],
    dica: '',
  },
  'quinta-tarde': {
    pergunta: 'Uma professora sob suspeita, um único aluno sentado numa sala vazia e uma parente que chegou para ficar. A pergunta que a cidade inteira faz começa às duas e dezessete da manhã. Qual é o filme de 2025?',
    respostas: ['a hora do mal', 'hora do mal', 'weapons'],
    dica: '',
  },
  'quinta-noite': {
    pergunta: 'Começa numa escavação no Iraque, passa por um tabuleiro onde um amigo imaginário chamado Capitão Howdy responde, e tem uma escadaria em Georgetown que virou ponto turístico. Qual é o clássico de 1973?',
    respostas: ['o exorcista', 'exorcista', 'the exorcist'],
    dica: '',
  },
};
// Os três primeiros enigmas mantêm os ids antigos ("terca", "quarta", "quinta" = turno da manhã).
const idEnigma = (dia, periodo) => (periodo === 'manha' ? dia : `${dia}-${periodo}`);
const ENIGMAS = DIAS.flatMap(([dia, nomeDia, data], d) => PERIODOS.map(([periodo, nomePeriodo, hora], p) => ({
  id: idEnigma(dia, periodo), ordem: d * 3 + p + 1, titulo: `${nomeDia} · ${nomePeriodo}`,
  ...TEXTOS_ENIGMAS[`${dia}-${periodo}`], abre: `${data}T${hora}:00-04:00`, fecha: FECHA_ENIGMAS,
})));
const PONTOS_ENIGMA = 10;
const BONUS_ENIGMA_PADRAO = [10, 5, 3];

// Quiz de Terror Relâmpago: 10 perguntas de múltipla escolha lançadas pelo admin na festa.
// Uma resposta só por pergunta, com tempo. Acertou: +500. `correta` é o índice da opção.
// Bem diferente do pré-festa (que foi só "adivinhe o filme"): origem do Halloween, clássicos da
// literatura de terror e lendas, inclusive do folclore brasileiro.
const QUIZ = [
  { id: 'q1', ordem: 1, texto: 'De que país vem o Samhain, a festa antiga que deu origem ao Halloween?',
    opcoes: ['Estados Unidos', 'México', 'Irlanda', 'Inglaterra'], correta: 2 },
  { id: 'q2', ordem: 2, texto: 'Quem escreveu "Frankenstein"?',
    opcoes: ['Mary Shelley', 'Bram Stoker', 'Edgar Allan Poe', 'Stephen King'], correta: 0 },
  { id: 'q3', ordem: 3, texto: 'Em que país fica a Transilvânia, a terra do Conde Drácula?',
    opcoes: ['Hungria', 'Bulgária', 'Sérvia', 'Romênia'], correta: 3 },
  { id: 'q4', ordem: 4, texto: 'Na lenda brasileira, por onde a Mula sem Cabeça solta fogo?',
    opcoes: ['Pelos olhos', 'Pelo pescoço', 'Pelas patas', 'Pelo rabo'], correta: 1 },
  { id: 'q5', ordem: 5, texto: 'Antes da abóbora, o que os irlandeses esculpiam para fazer as lanternas de Halloween?',
    opcoes: ['Melão', 'Coco', 'Nabo', 'Pepino'], correta: 2 },
  // Clássicos do cinema que todo mundo conhece.
  { id: 'q6', ordem: 6, texto: 'Em "Jogos Mortais", como se chama o boneco de bochechas vermelhas que aparece no triciclo?',
    opcoes: ['Chucky', 'Billy', 'Jigsaw', 'Annabelle'], correta: 1 },
  { id: 'q7', ordem: 7, texto: 'Em "Sexta-Feira 13", que máscara virou a marca registrada do Jason?',
    opcoes: ['Máscara de hóquei', 'Saco de pano', 'Máscara de palhaço', 'Máscara de gás'], correta: 0 },
  { id: 'q8', ordem: 8, texto: 'Quais são as cores do suéter listrado do Freddy Krueger?',
    opcoes: ['Preto e branco', 'Laranja e roxo', 'Vermelho e verde', 'Vermelho e preto'], correta: 2 },
  { id: 'q9', ordem: 9, texto: 'Qual é o nome do palhaço de "It: A Coisa"?',
    opcoes: ['Krusty', 'Bozo', 'Coringa', 'Pennywise'], correta: 3 },
  { id: 'q10', ordem: 10, texto: 'Em "Pânico", que pergunta o assassino faz ao telefone?',
    opcoes: ['Quer brincar comigo?', 'Qual é o seu filme de terror favorito?', 'Você está sozinha em casa?', 'Sabe o que fez no verão passado?'], correta: 1 },
];
const PONTOS_QUIZ = 500;
const QUIZ_TEMPO_PADRAO_S = 20;

// Concurso de Fantasia: votação; os três mais votados ganham estes pontos (empate divide a colocação).
const PONTOS_CONCURSO = [1000, 800, 500];

// Colaborar conta ponto.
const PONTOS_COLABORACAO = { carona: 5, musica: 5, bebida: 5 };

module.exports = {
  PERGUNTAS, PERGUNTAS_REMOVIDAS, PONTOS_PREVISAO, CASTIGOS, INTENSIDADES, PONTOS_MALDICAO, ENIGMAS, PONTOS_ENIGMA, BONUS_ENIGMA_PADRAO,
  PONTOS_COLABORACAO, QUIZ, PONTOS_QUIZ, QUIZ_TEMPO_PADRAO_S, PONTOS_CONCURSO,
};
