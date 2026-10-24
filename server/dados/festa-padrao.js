// Informações iniciais da festa. Tudo isto é editável no painel admin; estes são
// só os valores com que o banco nasce. Horários sempre com o fuso de Manaus (-04:00).

const FESTA_PADRAO = {
  nome: 'Project V — Edição Halloween',
  // Sábado, 31/10, das 17h à meia-noite.
  inicio: '2026-10-31T17:00:00-04:00',
  fim: '2026-11-01T00:00:00-04:00',
  local: 'Churrasqueira gourmet do Condomínio Singolare',
  dressCode: 'Fantasia obrigatória. Quanto mais assustadora (ou mais criativa), melhor.',
  oQueLevar: 'Sua bebida preferida e disposição para ser amaldiçoado.',
  regras: 'Respeite todo mundo. Quem não bebe álcool cumpre os castigos com a própria bebida.',
  telaoModo: 'contagem',
};

module.exports = { FESTA_PADRAO };
