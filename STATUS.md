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
- [x] Confirmados (só apelido e avatar; nome real nunca sai do admin)
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

## Pendente (Etapa C, em ordem)

- [ ] Deploy no Render + Turso (depende do Victor: ver README)
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

- Repositório no GitHub e serviço no Render (não tenho acesso às contas)
- Banco no Turso e variáveis `TURSO_URL`, `TURSO_TOKEN`, `ADMIN_SEGREDO`
- Confirmar número de convidados, TV/projetor e internet no local
