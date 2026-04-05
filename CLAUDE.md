# Price CD — Análise da Base de Código

## O que o projeto faz

Serviço Node.js que automatiza a pesquisa de preço e popularidade de jogos para revendedores. Recebe um arquivo `.txt` onde a primeira linha é o **mínimo de popularidade** e as linhas seguintes são **nomes de jogos** (um por linha). O sistema:

1. Busca cada jogo no SteamCharts para obter o pico de jogadores em 24h (popularidade).
2. Filtra jogos abaixo do mínimo de popularidade.
3. Pesquisa o melhor preço no AllKeyShop para os jogos qualificados.
4. Retorna um `.txt` formatado para colar direto em planilha.

Há também um fluxo assíncrono ("lists") que aceita um Steam ID, rastreia as listas de trade do usuário no SteamTrades, extrai os jogos e roda o mesmo pipeline com popularidade mínima fixa de 30.

---

## Arquitetura

```
src/
├── server.ts              # Ponto de entrada (bind da porta)
├── app.ts                 # Express setup, rotas, static files
├── routes/                # Roteamento HTTP (thin wrappers)
├── controllers/           # Parse de request, validação, formatação de response
├── schemas/               # Schemas Zod + helpers de parse
├── services/              # Orquestração ("application services")
│   └── lists/             # Services específicos do fluxo lists
├── application/lists/     # Use cases + interfaces de porta (domain logic)
│   └── ports/             # Interfaces de dependência (inversão de dependência)
├── domain/lists/          # Entidades de domínio (ListTopic)
├── infrastructure/        # Implementações concretas das portas
│   ├── background/        # Schedulers
│   ├── http/              # Axios callback poster
│   └── lists/             # SteamTrades fetcher + formatador de resultado
├── lib/                   # Utilidades compartilhadas (puppeteer factory, dispose)
├── helpers/               # Funções puras de transformação de string + constantes
└── types/                 # Definições de tipos TypeScript
```

Segue uma arquitetura hexagonal leve: o subdomínio `lists` tem interfaces de porta explícitas (`ListTopicFetcher`, `BackgroundScheduler`, `RunListsCallbackPoster`, `ListResultFormatter`, `RunListsRunner`) que são injetadas no use case via factory functions, permitindo testabilidade isolada.

---

## Tecnologias e Padrões

| Tecnologia | Uso |
|---|---|
| Node.js 20 + TypeScript 5 | Runtime e linguagem |
| Express 5 | HTTP server |
| Multer | Upload de arquivos `.txt` (máx 1 MB) |
| Zod 4 | Validação de input (body e conteúdo do arquivo) |
| Axios | HTTP client (SteamCharts, AllKeyShop, callback posts) |
| Cheerio | Parse HTML via seletores jQuery-like |
| Puppeteer Real Browser | Automação Chromium com bypass de anti-bot |
| puppeteer-extra-plugin-stealth | Esconde fingerprint do Puppeteer |
| puppeteer-extra-plugin-adblocker | Bloqueia ads para reduzir ruído e acelerar scraping |
| Biome | Linter + formatter (substitui ESLint + Prettier) |
| tsx / tsc-alias | Execução em dev e resolução de aliases no build |
| Xvfb (Docker) | Display virtual para Chromium headed em containers Linux |

### Padrões de Concorrência

- **SteamCharts**: `Promise.all` em batches de 50 jogos (paralelo dentro do batch, sequencial entre batches).
- **AllKeyShop**: Estritamente sequencial por jogo (uma única página do navegador navegada por vez).
- **SteamTrades**: Serializado via promise chain global (`steamTradesGate`) para evitar rate limit.
- **Background jobs**: `LimitedConcurrencyScheduler` — fila in-process com concorrência configurável via `RUN_LISTS_CONCURRENCY` (default 1).

### Rate Limit e Retry

- `fetchWithRetry`: Respeita header `Retry-After` em 429; backoff exponencial com `baseDelay` de 5s; máx 3 tentativas.
- `gotoWithRetry`: Retry em `TimeoutError` ou HTTP 429 no Puppeteer; 3 tentativas.
- `STEAMTRADES_PAGE_DELAY_MS` env opcional para throttling entre page loads.

### Normalização de Nomes

O módulo `clear-string.ts` é a camada central de normalização usada em todo matching:
- Converte algarismos romanos (`IV` → `4`)
- Expande números-K (`10k` → `10000`)
- Remove palavras de edição (`Definitive Edition`, `GOTY`, `Deluxe`, `Bundle`, etc.)
- Remove tags de região (`ROW`, `EU`, `Global`)
- Remove keywords de DLC (`DLC`, `expansion`, `season pass`)
- Strip de pontuação especial (`™`, `:`, `®`, `!`, `?`, `'`, etc.)
- `hasEdition` retorna um `Set` de palavras de edição encontradas, usado para comparação simétrica evitando falsos matches entre variantes de edição.

### Tratamento de Erros

- Controllers tratam `ZodError` (400) separado de `Error` genérico (500).
- Funções de service retornam `null` em falhas individuais de jogo (não fatais), permitindo que o batch continue.
- Browser cleanup usa dupla proteção: fecha todas as páginas, mata o processo filho, chama `browser.close()`, e mata com SIGINT se ainda estiver vivo.
- `FetchListTopic` implementa o padrão `Disposable` (`src/lib/dispose.ts`); `RunListsUseCase` chama `disposeIfPresent(fetcher)` em bloco `finally`.

---

## Problemas Identificados

### Design e Corretude

**8. `checkGamivoOffer` tratado de forma inconsistente**
O endpoint `/upload` lê do `req.body.checkGamivoOffer` mas a UI envia como string `"true"`/`"false"` via FormData. O `runListsService` hardcoda `checkGamivoOffer: true` independente do input.

**9. Campo `id` em `FoundGames` reatribuído arbitrariamente**
Em `searchAllKeyShop`, `id: index` se refere ao índice no subarray `worthyGames`, não ao ID original do jogo, quebrando qualquer correlação downstream por ID.

**10. `router.ts` monta `searchGamesIdSteam` incorretamente**
O arquivo de rota `search-id-steam.route.ts` define `POST /search-id-steam` mas nunca é montado via `router.use`. O controller é passado diretamente como middleware — uso incorreto.

**11. Sem timeout no nível do servidor Express**
Operações longas de scraping (potencialmente minutos para listas grandes) mantêm a conexão HTTP aberta. Clientes com timeouts curtos desconectam, mas o servidor continua processando sem necessidade.

### Menores

**13. Sem testes automatizados** — a pasta `test/` contém apenas arquivos `.txt` de fixture. A arquitetura está bem estruturada para testabilidade, mas não há testes.

**14. `public/index.html` referencia G2A/Kinguin** na descrição do output, mas o backend atual só retorna preços via AllKeyShop. Documentação desatualizada.

**15. `moduleResolution: "node"` está depreciado para ESM** — com `"type": "module"` e `"module": "ESNext"`, o correto seria `"Bundler"` ou `"NodeNext"`.

**16. `biome.json` com `vcs.useIgnoreFile: false`** — Biome ignora o `.gitignore` e pode lintar diretórios que não deveriam ser verificados.

---

### Média Prioridade
8. **Corrigir `moduleResolution`** — mudar para `"NodeNext"` para alinhamento correto com ESM.

9. **Remover `nodemailer`** das dependências se não há planos de uso.

10. **Atualizar `public/index.html`** — corrigir a documentação para refletir o output real (AllKeyShop/Gamivo apenas).

### Baixa Prioridade

11. **Escrever testes unitários** — especialmente para `clear-string.ts`, `bestOfferPrice`, `detectOfferTooLow` e `worthyByPopularity`, que são funções puras com lógica crítica.

12. **Corrigir o `router.ts`** — montar `search-id-steam.route.ts` via `router.use` corretamente.

13. **Padronizar tratamento de `checkGamivoOffer`** — garantir que seja sempre booleano após parse do schema em todos os endpoints.

14. **Ativar `vcs.useIgnoreFile: true` no `biome.json`** — para respeitar o `.gitignore`.
