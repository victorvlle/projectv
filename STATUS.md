# Status do desenvolvimento

Atualizado em 23/10/2026.

## Concluído e verificado (Etapa B — fundação)

- [x] Servidor Express + Socket.IO, banco libSQL (arquivo local / Turso) com migrações por degrau
- [x] Links individuais com código aleatório de 10 caracteres (`crypto.randomInt`), únicos
- [x] Desativar, reativar, regenerar e excluir convidado; link antigo e sessões abertas caem na hora
- [x] Tela de bloqueio para quem não tem link válido
- [x] Perfil: apelido (único), monstro-avatar e opção de aparecer nos confirmados
- [x] Login do admin com senha em variável de ambiente, comparação em tempo constante e freio de tentativas
- [x] Painel admin (celular e PC): convidados em lote, copiar link, WhatsApp, marcar fora, festa, atividades, telão, backup
- [x] Contagem regressiva pelo relógio do servidor; informações da festa editáveis
- [x] Confirmados: nome cadastrado e monstro de todos que já entraram
- [x] Cards de atividades: bloqueada mostra só o enigma; liberada mostra nome e animação
- [x] Liberação controlada pelo servidor; agendamento automático (Previsões abrem sex 30/10 00:00)
- [x] Telão: login, cenas Contagem / Confirmados / Atividades / Mensagem, trocadas pelo admin em tempo real
- [x] Reconexão: toda reconexão rebusca o estado no banco
- [x] Backup (download JSON) e restauração atômica
- [x] Testes automatizados: 17 passando, incluindo reinício real do servidor
- [x] Teste de ponta a ponta no navegador (Chromium): admin, convidado, visitante e telão
- [x] Horário da festa: 17h à meia-noite (início e fim editáveis no admin)
- [x] Lista de bebidas aberta desde já: itens com meta, "eu levo" com − e +, o que mais falta, outras bebidas,
      quem leva o quê em tempo real, privacidade de quem não aparece; admin cria/edita/exclui, fecha e reabre
- [x] Testes automatizados: 31 passando (inclui lista de bebidas e migração do horário)
- [x] Nome exibido é sempre o cadastrado pelo organizador; convidado só escolhe o monstro e já aparece nos confirmados (sem opção de se esconder)
- [x] Contribuições (lista de bebidas) num card próprio já liberado, com tela separada
- [x] Lista e metas do organizador: Cerveja 20 longnecks, Vodka 3, Tequila 1, Cachaça 2, Gin 3,
      Energético Tropical 3 (2 L), Refrigerante 3 (2 L); Gelo, Água e Suco retirados
- [x] Testes automatizados: 32 passando
- [x] Deploy no Render + Turso: https://projectv-pec1.onrender.com (`/saude` responde `banco: turso`, verificado em 24/10)

## Pendente (Etapa C, em ordem)

- [ ] Previsões / Apostas (fecham no início da festa)
- [ ] A Maldição (só bebida, intensidade e pausa)
- [ ] Correio das Trevas (fila de aprovação, autor protegido)
- [ ] Ranking geral e coroação
- [ ] Concurso de Fantasia
- [ ] Mural de Fotos ao Vivo (sharp, fotos no banco)
- [ ] Quiz de Terror Relâmpago
- [ ] O Monstro está entre nós
- [ ] Sons e animações extras

## Decisões tomadas

- **Banco no Turso, não no disco do Render**: o disco do plano free é apagado a cada deploy/reinício/hibernação
  (mesma conclusão do Bar Bestial). O código também aceita `BANCO_CAMINHO` num disco persistente do Starter.
- **Horário da festa: sábado 31/10, das 17h à meia-noite** (confirmado; editável no admin).
  Previsões fecham às 17h, quando a festa começa.
- **Previsões abrem 30/10 às 00:00** (editável no admin).
- **Telão usa a senha do admin**: roda no notebook do organizador.

## Bloqueado / depende do Victor

- Confirmar número de convidados, TV/projetor e internet no local
