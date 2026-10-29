// Conteúdo dos jogos: perguntas das Previsões, castigos da Maldição e enigmas.
// Os textos iniciais entram no banco uma vez (migração); depois o admin edita pelo painel
// o que for editável (respostas oficiais, enigmas, intensidade da Maldição).

const PERGUNTAS = [
  { id: 'ultimo-chegar', ordem: 1, tipo: 'convidado', texto: 'Quem vai chegar por último?' },
  { id: 'primeiro-sair', ordem: 2, tipo: 'convidado', texto: 'Quem vai ser o primeiro a ir embora?' },
  { id: 'ganha-concurso', ordem: 3, tipo: 'convidado', texto: 'Quem vai ganhar o Concurso de Fantasia?' },
  { id: 'mais-amaldicoado', ordem: 4, tipo: 'convidado', texto: 'Quem vai ser mais amaldiçoado pela Maldição?' },
  { id: 'primeiro-dancar', ordem: 5, tipo: 'convidado', texto: 'Quem vai ser o primeiro a dançar?' },
  { id: 'mais-fotos', ordem: 6, tipo: 'convidado', texto: 'Quem vai mandar mais fotos no Mural?' },
  { id: 'rei-trevas', ordem: 7, tipo: 'convidado', texto: 'Quem vai ser coroado Rei ou Rainha das Trevas?' },
  { id: 'longnecks', ordem: 8, tipo: 'opcoes', texto: 'Quantas longnecks vão sobrar?',
    opcoes: [{ id: 'nenhuma', nome: 'Nenhuma' }, { id: '1-5', nome: '1 a 5' }, { id: '6-10', nome: '6 a 10' }, { id: 'mais-10', nome: 'Mais de 10' }] },
  { id: 'destino-pos', ordem: 9, tipo: 'opcoes', texto: 'Para onde vai o pós?',
    opcoes: [{ id: 'bellos', nome: "Bello's Club" }, { id: 'condado', nome: 'Condado Bar' }, { id: 'augusta', nome: 'Augusta Haus' }] },
  { id: 'sem-fantasia', ordem: 10, tipo: 'opcoes', texto: 'Alguém vai chegar sem fantasia?',
    opcoes: [{ id: 'sim', nome: 'Sim' }, { id: 'nao', nome: 'Não' }] },
];
const PONTOS_PREVISAO = 10;

// Castigos da Maldição: todos de bebida (cada um bebe o que estiver bebendo).
// nivel: 1 = leve, 2 = moderado, 3 = caos. Cada intensidade usa os castigos até o seu nível.
// {a} = sorteado; {b} = parceiro (castigo duplo).
const CASTIGOS = [
  { id: 'gole', nivel: 1, texto: 'Dê um gole caprichado na sua bebida.' },
  { id: 'companhia', nivel: 1, texto: 'Escolha alguém para beber um gole com você.' },
  { id: 'brinde', nivel: 1, texto: 'Brinde com a próxima pessoa que chegar perto de você e bebam juntos.' },
  { id: 'mao', nivel: 1, texto: 'Beba com a mão não dominante até a próxima maldição.' },
  { id: 'olhos', nivel: 1, texto: 'Beba de olhos fechados enquanto todo mundo conta até 5.' },
  { id: 'monstro', nivel: 1, texto: 'Todo mundo com o mesmo monstro que você bebe um gole junto.' },
  { id: 'shot', nivel: 2, texto: 'Tome um shot.' },
  { id: 'duplo', nivel: 2, duplo: true, texto: 'Maldição dupla: {a} e {b} brindam e bebem juntos.' },
  { id: 'vire', nivel: 3, texto: 'Vire o que estiver no seu copo.' },
  { id: 'shot-duplo', nivel: 3, texto: 'Tome um shot e escolha alguém para tomar outro com você.' },
];
const INTENSIDADES = {
  leve: { nome: 'Leve', nivel: 1, minMin: 30, maxMin: 40 },
  moderado: { nome: 'Moderado', nivel: 2, minMin: 20, maxMin: 30 },
  caos: { nome: 'Caos', nivel: 3, minMin: 10, maxMin: 15 },
};
const PONTOS_MALDICAO = 5;

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

// Colaborar conta ponto.
const PONTOS_COLABORACAO = { carona: 5, musica: 5, bebida: 5 };

module.exports = {
  PERGUNTAS, PONTOS_PREVISAO, CASTIGOS, INTENSIDADES, PONTOS_MALDICAO, ENIGMAS, PONTOS_ENIGMA, BONUS_ENIGMA_PADRAO,
  PONTOS_COLABORACAO,
};
