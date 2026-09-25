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

6. **Campo `id` em `FoundGames` reatribuído arbitrariamente** — em `searchAllKeyShop`, `id: index` se refere ao índice no subarray `worthyGames`, não ao ID original do jogo, quebrando qualquer correlação downstream por ID.
7. **Sem timeout no nível do servidor Express** — operações longas de scraping (potencialmente minutos para listas grandes) mantêm a conexão HTTP aberta. Clientes com timeouts curtos desconectam, mas o servidor continua processando sem necessidade.
8. **`EDITION_TIERS` não cobre toda palavra que sinaliza uma Versão separada no catálogo** — `matchSearchResult` desempata entre candidatos com o mesmo nome-base usando `hasEdition`/`EDITION_TIERS` (`helpers/clear-string.ts`), que hoje conhece `definitive`, `goty`, `deluxe`, `premium`, `bundle`, `special`, `complete`, `day one`, `remastered`, `anniversary`, `ultimate`, `enhanced`, `collector's`. Um jogo-exceção cuja Versão usa uma palavra fora dessa lista cai no fallback "primeiro candidato" — arbitrário, pode devolver o preço da Versão errada. A lista é aberta por natureza (sempre pode aparecer uma palavra nova); expandir sob demanda quando um caso real aparecer. Ver `docs/adr/0003-edicao-resolvida-na-pagina-nao-na-busca.md` e o termo "Versão" em `CONTEXT.md`.

## Baixa Prioridade

9. **Escrever testes unitários** — especialmente para `clear-string.ts`, `bestOfferPrice`, `detectOfferTooLow` e `worthyByPopularity`, que são funções puras com lógica crítica.
10. **Padronizar tratamento de `checkGamivoOffer`** — verificar se ainda procede: `runListsService` hoje repassa `checkGamivoOffer` corretamente do request (não hardcoda `true`), e não existe mais endpoint `/upload` (foi substituído por `/api/games/research`, com schema Zod que já valida booleano). Este item pode estar resolvido — confirmar antes de fechar.
11. **Ativar `vcs.useIgnoreFile: true` no `biome.json`** — atualmente `false`; Biome ignora o `.gitignore` e pode lintar diretórios que não deveriam ser verificados.
12. **Alinhar `indentStyle` do Biome com o código real** — `biome.json` exige `"indentStyle": "tab"`, mas `src/` e `test/` são indentados com 4 espaços; `npm run lint` falha em praticamente todo arquivo do repositório, o que torna o linter inútil como portão de qualidade (ninguém consegue distinguir erro novo de ruído). Decidir qual é a verdade (provavelmente espaços, já que é o que está no código) e rodar `npm run lint:fix` uma vez.
13. **Suíte de testes instável por starvation de worker** — em rodadas de `npm test` na máquina de desenvolvimento (WSL2), testes aleatórios estouram `Test timed out in 5000ms`, incluindo casos puramente síncronos sem I/O (ex.: `formatResult` em `test/unit/domain/suppliers/profitability.test.ts`). Não é lógica: o alvo muda a cada execução e o problema reproduz no `main` limpo. É contenção entre os workers do Vitest. Investigar `poolOptions.threads.maxThreads` e/ou subir o `testTimeout` no `vitest.config.ts` — enquanto isso, uma falha isolada de timeout não deve ser lida como regressão.
14. **Precificar keys de outras plataformas (GOG e afins)** — Fornecedores misturam plataformas numa mesma Lista, separando com cabeçalho (`GOG:` seguido dos jogos daquela loja). Hoje o `HaveListing` (`src/domain/lists/have-listing.ts`) **descarta** essas seções nos dois fluxos que raspam `.have` (Reabastecimento e Descoberta), porque o AllKeyShop trata key de GOG como produto separado: pesquisar o jogo como se fosse Steam devolve o preço do produto errado, e a Trade nasceria com valor irreal. Implementar exige uma busca própria por plataforma no AllKeyShop e carregar a plataforma junto do nome do jogo por todo o pipeline (`GameAnalysisResult`, `GameTradeInput`, Sistema Estoque) — hoje nada disso tem o conceito de plataforma. Enquanto não existir, cada seção descartada é logada com a contagem de jogos perdidos, o que dá para medir se vale o esforço. Exemplo real: `https://www.steamtrades.com/trade/wGVYD/h-gog-keys-w-any-offer-tf2-too`. `UNPRICEABLE_PLATFORMS` já cobre GOG, Epic, Origin, Uplay/Ubisoft Connect e EA App; o match é por palavra inteira do rótulo, não por substring — trocar por `includes` cru descarta toda seção `Steam:` em silêncio, porque `"steam"` contém `"ea"`.
15. **`npm run build` não limpa o `dist/`** — `tsc && tsc-alias` escreve por cima do que já existe. Um `dist/` de um build anterior com layout diferente sobrevive e envenena o novo: os imports reescritos pelo `tsc-alias` apontam para caminhos que não existem mais, e o app morre com `ERR_MODULE_NOT_FOUND` em vez de erro de compilação. Aconteceu ao adicionar o segundo entrypoint (`src/main.ts`) no PR 2 da migração Nest. Em Docker não morde (a camada nasce limpa), só no build local. Prefixar com `rm -rf dist` resolve; o script é caminho de deploy, então a mudança merece PR próprio.
16. **Handler de `GET /` é código morto** — `src/app.ts` registra `app.use(express.static(publicDir))` na linha 11 e `app.get("/", ...)` na linha 16. O estático resolve `/` com `public/index.html` primeiro, então o handler que devolve o texto de autoria com o link do LinkedIn nunca executa. Descoberto ao escrever o caso de contrato de `GET /`, que assumia o texto e falhou. Decidir: apagar o handler, ou movê-lo para antes do estático se a intenção era mesmo responder texto — hoje a intenção não é observável de fora.
17. **Uniformizar o formato de erro das respostas HTTP** — hoje existem três formatos incompatíveis, um por grupo de rotas:

    | Rota | 400 | 500 |
    |---|---|---|
    | `/api/games/search`, `/api/games/search-id-steam` | `{ success, error: "Validation failed", details }` | `error: "Internal server error"` (sem ponto) + `message: "Failed to analyze games"` |
    | `/api/games/research`, `/api/lists/run` | mensagem em **`data`** — campo que em toda outra resposta significa sucesso | `error: "Internal server error."` (com ponto) + `details` |
    | `/api/suppliers/find-new` | — | `{ error }`, **sem o campo `success`** |

    Um cliente que trate erro de forma genérica precisa conhecer as três formas. O idioma da mensagem é problema separado e independente — ver item 20, que pode ser feito sem mexer na estrutura.

    **Não fazer durante a migração para Nest.** A bateria em `test/contract/contract-cases.ts` congela esses formatos de propósito: enquanto Express e Nest coexistem, ela é o único instrumento que distingue "o Nest quebrou algo" de "eu mudei de propósito". Uniformizar no meio torna toda diferença ambígua e destrói o portão. Fazer **depois do PR 10** (Express removido), num PR isolado — aí é um `AllExceptionsFilter` só, sem `@UseFilters` por controller, e a bateria de contrato é atualizada no mesmo commit, deliberadamente. Ver `docs/NEST.md` §4.

    Sugestão de formato único, a decidir: `{ success: false, error: <código estável>, message: <texto humano>, details?: <lista de problemas de validação> }`.
18. **Divergências de transporte entre Express e Nest, aceitas conscientemente** — nas rotas já migradas, requisição malformada em nível de transporte responde diferente nos dois apps:

    | Situação | Express | Nest |
    |---|---|---|
    | JSON malformado no body | `400 text/html`, corpo vazio | `400 application/json` `{message, error, statusCode}` |
    | Método errado numa rota existente | `404 text/html` "Cannot GET…" | `404 application/json` |

    Nenhum dos dois formatos aparece no contrato documentado (ambos vêm do default do framework, não de código nosso), e nenhum cliente depende de receber HTML. Decidiu-se **não** imitar o Express: reproduzir um acidente custaria código permanente. Registrado aqui para que a diferença apareça no cutover como decisão, não como surpresa. Se algum cliente quebrar, o conserto é um `ExceptionFilter` para `BadRequestException` de body-parser.
19. **Expor o Preço mínimo negociável no front** — hoje o piso é fixo em €0,50 (`MIN_PRICE_EURO`) e o usuário não consegue mudá-lo pela tela. O efeito colateral é de interpretação, não de lógica: quem testa um jogo barato vê a tabela vazia e conclui que o jogo **não foi encontrado**, quando na verdade ele foi encontrado, teve preço lido no AllKeyShop e foi descartado pelo piso. São dois desfechos diferentes com a mesma aparência.

    **O backend já suporta.** `researchGamesBodySchema` aceita `minPrice` opcional (`0` ou maior) e `partitionByPrice` recebe o valor como argumento — foi assim que o fluxo de bundle passou a aceitar jogos abaixo do piso. Falta só o campo em `public/index.html` e repassá-lo no corpo do POST; nenhuma mudança de domínio é necessária.

    Enquanto não existir, `public/index.html` explica na tela que o piso é fixo, que jogo descartado **foi encontrado**, e que a API já aceita `minPrice` por requisição.
20. **Traduzir para inglês a mensagem de erro em português** — `POST /api/lists/run` é a **única** rota que responde erro em português: `{ success: false, data: "Erro no corpo da requisição: <problemas>" }`. Todas as outras respondem em inglês. Um cliente que trate erro de forma genérica precisa lidar com dois idiomas na mesma API, e a mensagem não é traduzível do lado dele — o texto vem pronto do servidor.

    A string está hoje em cinco lugares, e todos mudam juntos:

    | Arquivo | Papel |
    |---|---|
    | `src/controllers/lists/run-lists.controller.ts` | app Express (produção) |
    | `src/nest/lists/lists-legacy-error.filter.ts` | app Nest |
    | `src/nest/common/legacy-data-error.filter.ts` | só um exemplo no docblock |
    | `test/contract/contract-cases.ts` | o portão de paridade |
    | `test/integration/nest/lists.module.test.ts` | teste de módulo |

    **Não fazer durante a migração para Nest.** É mudança de contrato, e a bateria de `test/contract/` congela o formato atual de propósito: enquanto Express e Nest coexistem, ela é o que distingue "o Nest quebrou" de "eu mudei". Traduzir no meio torna qualquer diferença ambígua. Fazer **depois do PR 10**, num PR isolado, atualizando a bateria no mesmo commit — deliberadamente, não por acidente.

    Independente do item 17: dá para traduzir sem mexer na estrutura (`data` continua sendo `data`), e vice-versa. Se os dois forem feitos juntos, melhor ainda — é um PR só de contrato.

    Sugestão: `"Invalid request body: <problemas>"`, alinhado com o `"Invalid file content: ..."` que `/api/games/research` já usa. Quando isso acontecer, a exceção de idioma documentada no `CLAUDE.md` ("Idioma no código") deixa de ter caso real e pode sair de lá.
