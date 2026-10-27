# Status do desenvolvimento

Atualizado em 27/10/2026.

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
- [x] Playlist da Noite (5 músicas por pessoa, votos, repetida vira voto), Caronas (vagas sem lotar, uma reserva por pessoa),
      Como chegar (editável no admin, botões Maps/Waze) — liberados desde já
- [x] O Pós: abre 31/10 23h, votação até a meia-noite, resultado ao vivo e no telão; opções editáveis
- [x] Segurança: 41 ataques simulados barrados (`npm run seguranca`), relatório em PDF
- [x] Testes automatizados: 39 passando
- [x] Notificações (Web Push): ativar/desativar, passo a passo do iPhone com atalho já logado, movimento dos amigos agrupado,
      programados (véspera, contribuições, 2h, portões, campeão do pós), atividade liberada, avisos livres no admin
- [x] Segurança: 46 ataques barrados (inclui SSRF nas inscrições de push); testes automatizados: 47 passando
- [x] Notificações v2: folha de benefícios + teste real só no aparelho que ativou (Android/computador); passo a passo ilustrado
      de 4 etapas no iPhone (Safari, ícone, iOS antigo, app embutido, sem suporte); tela Notificações (sino) com permissão,
      aparelhos (até 5, escolher qual remover), testar e desativar; fila do movimento dos amigos no banco; não avisa quem está
      com a tela aberta; agendados também a cada acesso; admin com público estimado, confirmação na tela, envio único, teste por pessoa e falhas
- [x] Segurança: 50 ataques barrados; testes automatizados: 55 passando; 40 verificações no navegador (simuladas, não em celular real)
- [x] Boas-vindas das notificações: modal na primeira visita de cada aparelho ("Quero receber avisos" / "Continuar sem ativar"),
      Android direto ao pedido, tutorial de 3 passos no iPhone, sem banner fixo na home (só "Reconectar" quando preciso);
      inscrições existentes preservadas; 13 cenários testados em navegador simulado
- [x] Alerta "Possível spam" do Chrome (Android): fim da notificação automática ao ativar; textos específicos começando com "Project V";
      checagem de qualidade em todo envio; teto de 4 avisos/pessoa/hora; teste sob pedido (1 a cada 10 min); registro por aparelho (push_log);
      testes automatizados: 62 passando. Causa provável, não confirmada: falta conferir o texto marcado e retestar num Android real
- [x] Ranking (celular, telão com pódio, admin), pontos com chave única (sem duplicar)
- [x] Previsões: 10 perguntas, palpite privado e alterável, encerrar/resultados/publicar no admin, revelação no telão (+10 por acerto)
- [x] A Maldição: sorteio no servidor (intervalos Leve/Moderado/Caos ou próprio), telão com alerta, bruxa, risada, roleta,
      revelação e 60 s; aviso no celular e push ao sorteado; confirmação no admin (+5)
- [x] Enigmas de filmes de terror (clássicos e recentes): 3 por dia (8h, 13h, 19h) de qua a sex, 9 no total (+10 e bônus 10/5/3, um aviso por dia ao meio-dia) e Colaborar conta ponto (carona +5, música +5, bebida levada +5 com confirmação)
- [x] Enigmas em modo prova: revelar inicia relógio do servidor (2 min, 5 tentativas), sair da página encerra; perguntas mais difíceis sem dica
- [x] Pontos retroativos: quem já tinha sugerido música ou oferecido carona ganha os +5 (uma vez)
- [x] Enigmas de terça (8h, 13h, 19h): 12 no total; cada enigma fecha quando o próximo abre
- [x] Voto na playlist instantâneo (a tela muda na hora; desfaz se o servidor recusar)
- [x] Testes automatizados: 85 passando; 57 ataques barrados
- [x] Deploy no Render + Turso: https://projectv-pec1.onrender.com (`/saude` responde `banco: turso`, verificado em 24/10)

## Pendente (Etapa C, em ordem)

- [ ] Adivinhe a fantasia (deixado para depois)

- [ ] Correio das Trevas (fila de aprovação, autor protegido)
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
- Monitor no UptimeRobot (a cada 5 min em /saude) para os avisos agendados saírem com o Render free; pausar depois da festa
- Ver o texto da notificação marcada como spam e retestar no Android depois de publicar (PDF de diagnóstico, seção 7)
- Testar as notificações num Android e num iPhone de verdade
- Testar o som da Maldição na TV da festa (clicar em "Ativar som" no telão) (roteiro no PDF de entrega das notificações)
