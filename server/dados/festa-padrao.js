// Informações iniciais da festa. Tudo isto é editável no painel admin; estes são
// só os valores com que o banco nasce. Horários sempre com o fuso de Manaus (-04:00).

const FESTA_PADRAO = {
  nome: 'Project V — Edição Halloween',
  // Horário de início ASSUMIDO (21h) até o organizador confirmar no admin.
  inicio: '2026-10-31T21:00:00-04:00',
  local: 'Churrasqueira gourmet do Condomínio Singolare',
  dressCode: 'Fantasia obrigatória. Quanto mais assustadora (ou mais criativa), melhor.',
  oQueLevar: 'Sua bebida preferida e disposição para ser amaldiçoado.',
  regras: 'Respeite todo mundo. Quem não bebe álcool cumpre os castigos com a própria bebida.',
  telaoModo: 'contagem',
};

module.exports = { FESTA_PADRAO };
