# Price CD — Análise da Base de Código

## O que o projeto faz

Serviço Node.js que automatiza a pesquisa de preço e popularidade de jogos para revendedores. Recebe um arquivo `.txt` onde a primeira linha é o **mínimo de popularidade** e as linhas seguintes são **nomes de jogos** (um por linha). O sistema:

1. Busca cada jogo no SteamCharts para obter o pico de jogadores em 24h (popularidade).
2. Filtra jogos abaixo do mínimo de popularidade.
3. Pesquisa o melhor preço no AllKeyShop para os jogos qualificados.
4. Retorna um `.txt` formatado para colar direto em planilha.

Há também um fluxo assíncrono ("lists") que aceita um Steam ID, rastreia as listas de trade do usuário no SteamTrades, extrai os jogos e roda o mesmo pipeline com popularidade mínima fixa de 30.

## Papel do Claude neste projeto

Atue sempre como arquiteto de software sênior com conhecimento profundo de Node e clean architecture.
- Questione decisões quando houver práticas consolidadas no mercado que apontem em outra direção
- Proponha soluções que o Node oferece, sempre respeitando as camadas de clean architecture
- Explique o raciocínio antes de implementar — nunca apenas execute sem contextualizar
- Quando o Node oferecer algo relevante, apresente o que ele resolve, onde vive nas camadas e qual o custo de usá-lo
- Todo código novo deve respeitar a separação de camadas: `Domain → Application → Infrastructure → Apresentação`. Nunca coloque lógica de negócio fora do Domain ou Application, nunca deixe o Domain conhecer o Node, nunca deixe um Use Case conhecer HTTP
- Ao sugerir onde um novo arquivo deve viver, justifique com base na camada correta da arquitetura
- Sempre gerar testes para cada alteração feita no projeto e só aceitar depois de executar os testes e passarem todos.
- Esse sistema é utilizado pelo Sistema Estoque, mantenha o arquivo PRICE_RESEARCHER.md sempre atualizado.

### Documentação viva

Toda documentação `.md` do projeto é **viva**: deve ser atualizada na mesma alteração que a tornou desatualizada, nunca "depois". Documentação errada é pior que documentação ausente — ela é lida como verdade, entra no contexto e propaga o erro. Ao mexer no código, verifique se algum destes arquivos passou a mentir e corrija junto:

| Arquivo | O que guarda | Atualize quando |
|---|---|---|
| `CONTEXT.md` | Glossário do domínio (só termos, sem detalhe de implementação) | Um termo do negócio nasce, muda de significado ou é aposentado |
| `docs/adr/` | Decisões arquiteturais difíceis de reverter | Uma decisão com trade-off real é tomada |
| `docs/IMPROVEMENTS.md` | Backlog de dívida técnica | Uma dívida é descoberta, resolvida ou muda de prioridade |
| `docs/wiki/` | Visão de alto nível para leitura não-técnica | Um fluxo, parâmetro ou comportamento visível ao negócio muda |
| `PRICE_RESEARCHER.md` | Contrato de integração com o Sistema Estoque | Endpoint, payload, header ou comportamento de callback muda |

Quando código e documentação divergirem, **o código é a verdade**: corrija o `.md` e avise explicitamente o que estava errado, em vez de silenciosamente reescrever.

### Puppeteer — referência

Sempre consulte a documentação mais recente antes de implementar qualquer alteração:
**https://pptr.dev/guides/getting-started**

---

## Contexto do negócio

A empresa é a **CarcaDeals** — vende keys de jogos para o consumidor final, comprando mais barato de fornecedores que compram bundles(Humble, Fanatical, Green Man Gaming) diretamente ou conseguem vários jogos através de giveaways ou contato com desenvolvedores.

Esse sistema é um projeto que apenas dá suporte ao sistema princial **Sistema-estoque** — onde fica armazenado todas as keys com os dados necessário(key, jogo, preço de compra, venda, lucro, data, etc).

---

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
│   ├── http/              # HTTP callback poster (native fetch)
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
| Node.js 22 + TypeScript 5 | Runtime e linguagem |
| Express 5 | HTTP server |
| Zod 4 | Validação de input (body e conteúdo do arquivo) |
| Native fetch (Node 22) | HTTP client (callback posts, integração com Sistema Estoque) |
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

Dívida técnica e melhorias rastreadas em `docs/IMPROVEMENTS.md`.

---

## Agent skills

### Issue tracker

Issues são rastreados no GitHub Issues (`JoaoVitor2310/price-cd`), via CLI `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulário padrão: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Layout single-context — `CONTEXT.md` + `docs/adr/` na raiz do repo, criados sob demanda. See `docs/agents/domain.md`.
