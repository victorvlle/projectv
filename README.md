# Project V — Edição Halloween

Site da festa: convidados pelo celular (link individual), telão em tempo real e painel do organizador.
Especificação: `Project_V_Halloween_Documentacao.pdf` (v1.1).

## Rodar na sua máquina

```powershell
npm install
$env:ADMIN_SEGREDO="uma-senha-local"; npm run dev
```

- Convidado: http://localhost:3002 (entra pelo link `/c/<codigo>` gerado no admin)
- Admin: http://localhost:3002/admin
- Telão: http://localhost:3002/telao (mesma senha do admin)

Sem `TURSO_URL`, o banco é o arquivo `data/projectv.db`.

## Testes

```powershell
npm test
```

96 testes: acesso por link, perfil, admin, atividades e agendamento, tempo real, bebidas, extras, notificações (aparelhos, limite, fila, agendados), segurança, backup/restauração e reinício real do servidor.

`npm run seguranca` roda 71 ataques simulados contra uma cópia local.

## Variáveis de ambiente

| Variável | Para que serve | Padrão |
|---|---|---|
| `PORT` | Porta | `3002` |
| `TURSO_URL` / `TURSO_TOKEN` | Banco no Turso (produção) | vazio = arquivo local |
| `BANCO_CAMINHO` | Arquivo local do banco (ex.: disco do Render Starter) | `data/projectv.db` |
| `SESSAO_SEGREDO` | Assina as sessões. **Precisa ser fixo em produção** | sorteado a cada boot |
| `ADMIN_SEGREDO` | Senha do `/admin` e do `/telao` | vazio = login sempre recusado |
| `URL_PUBLICA` | Domínio usado nos links de convite | `RENDER_EXTERNAL_URL` |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` | Chaves das notificações (opcional; não troque depois que as pessoas ativaram) | geradas uma vez e guardadas no banco |
| `VAPID_ASSUNTO` | Contato das chaves VAPID (URL ou `mailto:`) | `URL_PUBLICA` |
| `PUSH_LOTE_MS` / `PUSH_INTERVALO_MS` | Agrupamento do movimento dos amigos | 2 min / 20 min |
| `PUSH_MAX_POR_HORA` | Teto de avisos por pessoa por hora (testes à parte) | 4 |

## Publicar no Render

1. **Turso**: crie um banco novo `projectv` (pode ser na mesma conta do Bar Bestial) e copie a URL `libsql://…` e um token.
2. **GitHub**: crie o repositório `projectv` (pode ser privado) e suba este projeto.
3. **Render**: New → Blueprint → escolha o repositório. Ele lê o `render.yaml`.
4. Em **Environment**, preencha `TURSO_URL`, `TURSO_TOKEN` e `ADMIN_SEGREDO` (senha longa).
5. Abra `https://<seu-app>.onrender.com/saude` → deve responder `{"ok":true,"banco":"turso"}`.
   Se aparecer `"banco":"arquivo"`, o Turso não está configurado e os dados **vão sumir** no próximo reinício.

**Plano:** no free, o servidor hiberna após 15 min sem acesso e o primeiro acesso leva ~1 min. Na festa o tráfego o mantém acordado.
Os avisos agendados conferem o horário a cada acesso; um monitor no UptimeRobot (a cada 5 min em `/saude`) garante que saiam na hora.
Para a semana dos links, o Starter (US$ 7/mês) elimina a espera; dá para voltar ao free depois.

## Onde ficam os dados

Tudo no banco (Turso em produção): convidados, configuração, atividades e pontos. Fotos (fase do Mural) também
irão para o banco, processadas e reduzidas, para sobreviverem a reinícios do Render free.

**Backup:** painel admin → Backup → "Baixar backup agora". Restaurar substitui tudo pelo arquivo, numa transação só.
Baixe um backup antes de mandar os links e antes de abrir os portões.

## Estrutura

```
server/
  index.js            sobe banco, agendador e servidor
  app.js              Express + Socket.IO (usado também pelos testes)
  seguranca.js        códigos de convite, sessões HMAC, freios de abuso
  agendador.js        abre atividades agendadas no horário
  tempo-real.js       salas do Socket.IO e avisos às telas
  avatares.js         monstros-avatar
  atividades/catalogo.js  as 7 atividades (nomes, enigmas, estado inicial)
  dados/              banco, migrações, convidados, festa, atividades, backup
  rotas/              convidado, admin, utilitários
  socket/             autenticação do tempo real
public/
  comum/              tema e utilitários compartilhados
  convidado/          celular do convidado
  telao/              TV
  admin/              painel
tests/
```
