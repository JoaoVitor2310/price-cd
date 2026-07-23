# Improvements

Backlog de dívida técnica e melhorias identificadas no price-cd. Prioridade indica urgência relativa, não ordem obrigatória de implementação.

## Alta Prioridade

1. **Padronizar nomenclatura para "Lista"** — `TradePaginator`, `SupplierTrade.tradeUrl` e `CommentPoster.post(tradeUrl, ...)` usam "trade" para o que hoje é canonicamente "Lista" (ver `CONTEXT.md`). O termo era usado historicamente antes de "Lista" ser fixado como correto; renomear o quanto antes para eliminar a confusão entre a listagem do SteamTrades e a Trade do Sistema Estoque.
2. **Renomear `GameTradeImporter.import()` para refletir "Criar Trade"** — o método atual usa o verbo "importar", mas essa ação cria uma Trade nova (estado de proposta) no Sistema Estoque. "Importar" é reservado para quando o Sistema Estoque finaliza uma Trade concretizada e coloca as keys no estoque de fato — uma ação interna do Sistema Estoque em que o price-cd não participa. Renomear `GameTradeImporter`/`.import()` (ex.: `GameTradeCreator`/`.create()`) evita colisão de vocabulário entre os dois sistemas.
3. **Remover o agendador automático da Descoberta de Fornecedores** — `startFindNewSuppliersScheduler` (`src/infrastructure/background/find-new-suppliers-scheduler.ts`) implementa um `setInterval` de 24h, mas a chamada já está comentada em `src/server.ts:11`. O fluxo deve rodar só sob comando manual (`POST /api/suppliers/find-new`), nunca sozinho — remover o arquivo do scheduler e o import comentado em vez de deixar código morto no repositório, evitando que alguém reative por engano.
4. **Porta `AlertNotifier` — acabar com as falhas silenciosas** — princípio do projeto: nenhuma falha pode ficar só no log. É pré-requisito do item 5. Estrutura sugerida:
    - Porta `AlertNotifier` em `src/application/shared/ports/alert-notifier.port.ts` (compartilhada — `suppliers`, `games` e `lists` precisam dela)
    - Implementação concreta `EmailAlertNotifier` usando `nodemailer` (já está nas dependências, mantido justamente para isso)
    - Primeiro consumidor: sessão expirada no `findNewSuppliers` — o `PuppeteerCommentPoster` já detecta quando está deslogado (check `a[href*="/login"]`) e lança erro com mensagem clara, mas ninguém reage. A sessão do SteamTrades expira em 14 dias (`Max-Age=1209600` no `set-cookie`)
    - Segundo consumidor: os `catch` dos fluxos em background (ver item 5)
5. **Falha silenciosa nos fluxos assíncronos** — desde que `POST /api/games/research` autenticado passou a responder `202 queued`, uma falha durante o processamento (scraping quebrado, Sistema Estoque fora do ar) só vai para o log: o usuário recebeu a confirmação e nunca é avisado de que a Trade não será criada. O fluxo `lists` tem a mesma limitação. Bloqueado pelo item 4 — alternativas complementares: o `callback_url` que o `lists` já aceita, ou um registro de execuções consultável.

## Média Prioridade

6. **Corrigir `moduleResolution`** — está como `"node"`, depreciado para ESM. Com `"type": "module"` e `"module": "ESNext"` no `tsconfig.json`, o correto seria `"Bundler"` ou `"NodeNext"`.
7. **Atualizar `public/index.html`** — referencia G2A/Kinguin na descrição do output, mas o backend atual só retorna preços via AllKeyShop/Gamivo. Documentação desatualizada.
8. **Campo `id` em `FoundGames` reatribuído arbitrariamente** — em `searchAllKeyShop`, `id: index` se refere ao índice no subarray `worthyGames`, não ao ID original do jogo, quebrando qualquer correlação downstream por ID.
9. **Sem timeout no nível do servidor Express** — operações longas de scraping (potencialmente minutos para listas grandes) mantêm a conexão HTTP aberta. Clientes com timeouts curtos desconectam, mas o servidor continua processando sem necessidade.

## Baixa Prioridade

10. **Escrever testes unitários** — especialmente para `clear-string.ts`, `bestOfferPrice`, `detectOfferTooLow` e `worthyByPopularity`, que são funções puras com lógica crítica.
11. **Corrigir o `router.ts`** — `search-id-steam.route.ts` define `POST /search-id-steam` mas nunca é montado via `router.use`; o controller é passado diretamente como middleware, uso incorreto.
12. **Padronizar tratamento de `checkGamivoOffer`** — verificar se ainda procede: `runListsService` hoje repassa `checkGamivoOffer` corretamente do request (não hardcoda `true`), e não existe mais endpoint `/upload` (foi substituído por `/api/games/research`, com schema Zod que já valida booleano). Este item pode estar resolvido — confirmar antes de fechar.
13. **Ativar `vcs.useIgnoreFile: true` no `biome.json`** — atualmente `false`; Biome ignora o `.gitignore` e pode lintar diretórios que não deveriam ser verificados.
