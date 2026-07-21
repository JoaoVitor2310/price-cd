# Price Researcher — Referência de Integração

Serviço Node.js que pesquisa **popularidade** (SteamCharts) e **preço** (AllKeyShop/Gamivo) de jogos para revendedores. Este documento é destinado ao sistema **Sistema-Estoque** que se comunica com este serviço.

---

## Endereço base

| Ambiente | URL base |
|---|---|
| Produção (servidor compartilhado) | `http://localhost:5555` |
| Sistema-Estoque → Price Researcher (mesmo servidor) | `http://localhost:5555` |

Como o Sistema-Estoque e o Price Researcher rodam no **mesmo servidor**, use `localhost:5555` nas chamadas internas — evita tráfego de rede desnecessário. Use o IP público apenas para acesso externo ou testes manuais.

A porta é configurável via variável `HOST_PORT` no `.env` do price-researcher (default `5555`).

---

## Endpoints

### 1. `POST /api/games/search` — Busca por JSON

Busca popularidade e preço de uma lista de jogos. Resposta síncrona (aguarda todo o scraping).

**Request body** (`Content-Type: application/json`):

```json
{
  "gameNames": ["Half-Life 2", "Portal", "Hades"],
  "minPopularity": 50,
  "checkGamivoOffer": true
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `gameNames` | `string[]` | sim | Nomes dos jogos (mín. 1 item) |
| `minPopularity` | `number >= 0` | sim | Pico de jogadores mínimo em 24h no SteamCharts. `0` = ignora filtro de popularidade |
| `checkGamivoOffer` | `boolean` | sim | `true` = retorna apenas jogos com oferta ativa na Gamivo |

**Response 200:**

```json
{
  "success": true,
  "data": {
    "games": [
      {
        "id": 0,
        "name": "Half-Life 2",
        "foundName": "Half-Life 2",
        "id_steam": "220",
        "popularity": 1234,
        "region": "GLOBAL",
        "GamivoPrice": "1.99",
        "G2APrice": null,
        "KinguinPrice": null
      }
    ],
    "summary": {
      "totalRequested": 3,
      "foundGames": 2,
      "worthyByPopularity": 1,
      "foundPrices": 1,
      "processingTimeSeconds": 12.4
    }
  }
}
```

> **Atenção:** só retorna jogos que passaram no filtro de popularidade **e** tiveram preço encontrado.
> Jogos abaixo do mínimo de popularidade e acima de €2.00 são silenciosamente descartados.

**Response 400** (validação):
```json
{ "success": false, "error": "Validation failed", "details": "gameNames: Pelo menos um nome de jogo é necessário" }
```

**Response 500:**
```json
{ "success": false, "error": "Internal server error", "message": "Failed to analyze games" }
```

---

### 2. `POST /api/games/upload` — Busca por arquivo `.txt`

Mesmo fluxo do endpoint acima, mas recebe um arquivo `.txt` via `multipart/form-data`. Resposta é o download de um `.txt` formatado para colar em planilha.

**Request** (`Content-Type: multipart/form-data`):

| Campo | Tipo | Descrição |
|---|---|---|
| `fileToUpload` | `file` (text/plain, máx 1 MB) | Arquivo `.txt`: **linha 1** = popularidade mínima (número), **linhas seguintes** = nomes dos jogos |
| `checkGamivoOffer` | `string` `"true"` / `"false"` | Se deve filtrar somente jogos com oferta na Gamivo |

Formato do arquivo:
```
50
Half-Life 2
Portal
Hades
```

**Response 200:** arquivo `.txt` como download (`Content-Disposition: attachment`).

> Este endpoint é usado pela UI web (`public/index.html`). O Sistema-Estoque deve preferir `POST /api/games/search` para integração programática.

---

### 3. `POST /api/games/search-id-steam` — Busca Steam ID por nome

Recebe uma lista de jogos com seus IDs internos e retorna o `id_steam` de cada um, buscando no SteamCharts.

**Request body** (`Content-Type: application/json`):

```json
{
  "games": [
    { "id": 42, "name": "Half-Life 2" },
    { "id": 43, "name": "Portal" }
  ]
}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `games[].id` | `number` | ID interno do jogo no Sistema-Estoque |
| `games[].name` | `string` | Nome do jogo para busca no SteamCharts |

**Response 200:**

```json
{
  "success": true,
  "data": {
    "games": [
      { "id": 42, "name": "Half-Life 2", "id_steam": "220" },
      { "id": 43, "name": "Portal", "id_steam": "400" }
    ]
  }
}
```

> `id_steam` é `undefined` / ausente se o jogo não for encontrado no SteamCharts.
> O campo `id` é espelhado de volta para correlação no sistema chamador.

---

### 4. `POST /api/lists/run` — Execução assíncrona de listas SteamTrades

Enfileira a busca de listas de trade de um usuário no SteamTrades. Resposta imediata (202); o resultado chega via **callback HTTP** quando concluído.

**Request body** (`Content-Type: application/json`):

```json
{
  "id_steam": "76561198012345678",
  "callback_url": "https://seu-sistema.com/webhook/price-result",
  "checkGamivoOffer": true
}
```

| Campo | Tipo | Padrão | Descrição |
|---|---|---|---|
| `id_steam` | `string` | — | Steam ID 64-bit do usuário |
| `callback_url` | `string` (URL válida) | — | Endpoint que receberá o resultado via POST |
| `checkGamivoOffer` | `boolean` | `true` | Filtrar somente ofertas ativas na Gamivo |

**Response 202** (enfileirado):
```json
{ "success": true, "status": "queued" }
```

**Callback POST** enviado para `callback_url` quando concluído:

```json
{
  "status": "completed",
  "result": "09/04/2026\t1.99\thttps://steamcommunity.com/profiles/76561198012345678\t\t\t\t1234\tGLOBAL\t\tHalf-Life 2\n"
}
```

| Campo | Descrição |
|---|---|
| `status` | `"completed"` ou `"failed"` |
| `result` | String TSV pronta para planilha. Colunas: `data`, `GamivoPrice`, `perfil Steam`, `(vazio)×3`, `popularidade`, `região`, `(vazio)`, `nome do jogo` |

> Popularidade mínima é fixa em **30** para o fluxo de listas (não configurável via request).
> Concorrência controlada por `RUN_LISTS_CONCURRENCY` (default `1`) no `.env`.

---

### 5. Fluxo de descoberta de fornecedores (background)

O Price Researcher possui um job em segundo plano que varre páginas de listagem do SteamTrades em busca de novos fornecedores potenciais. Este fluxo **não é acionado via endpoint** — é disparado internamente pelo Sistema-Estoque via `POST /api/suppliers/find`.

**Critérios de qualificação de um tópico:**

| Critério | Comportamento ao falhar |
|---|---|
| Tópico ativo (sem `.notification.yellow`) | Pula; conta para limite de inativos consecutivos (máx. 5) |
| Seção `.want` contém `"TF2"` ou `"Team Fortress 2 Key"` (case-insensitive) **sem** `"no"` imediatamente antes | Pula silenciosamente — **não enviamos oferta em TF2 para quem não aceita** |
| Steam ID presente no tópico | Pula |
| Jogos na seção `.have` | Pula |
| Pelo menos um jogo com preço encontrado via Gamivo | Pula |
| `should_comment === true` retornado pelo Sistema Estoque | Não comenta |

> **Regra do TF2:** a oferta que enviamos aos fornecedores é sempre em keys de TF2. Por isso, só processamos tópicos cuja seção `.want` demonstre aceitar TF2 — presença de `"TF2"` ou `"Team Fortress 2 Key"` (case-insensitive) **sem** o prefixo `"no"` (ex.: `"no TF2"` ou `"no Team Fortress 2 Key"` é descartado).

---

## Comportamento geral de preços

- **Fonte de popularidade:** SteamCharts (pico de jogadores nas últimas 24h)
- **Fonte de preço:** AllKeyShop (e Gamivo quando `checkGamivoOffer: true`)
- Jogos **abaixo** do `minPopularity` e com preço **acima de €2.00** são descartados
- Jogos **abaixo** do `minPopularity` mas com preço **≤ €2.00** ainda aparecem no resultado
- Nomes são normalizados internamente (algarismos romanos → arábicos, sufixos de edição removidos, etc.) — não é necessário tratar o nome antes de enviar

### Key base ≠ key de edição

Uma key da versão **base** de um jogo e uma key de uma **edição** (Deluxe, GOTY, Definitive, etc.) são produtos distintos, com **preços diferentes**. Por isso o sistema trata os dois lados de forma separada:

- **Popularidade (SteamCharts):** busca sempre pelo **jogo base** — a edição é removida do nome só para achar o pico de jogadores (a edição não muda a popularidade). O nome original, com a edição, é preservado para as etapas seguintes.
- **Preço (AllKeyShop):** busca a key **com a edição** — o preço de "Jogo Deluxe Edition" precisa vir da oferta Deluxe, nunca da base.

A correspondência de edição usa **categorias canônicas** (`clear-string.ts`), então variações de escrita da MESMA edição casam entre si, mas edições diferentes nunca se misturam:

- `GOTY` = `Game of the Year` = `G.O.T.Y` → todas a mesma categoria `goty`
- `Deluxe Edition` = `Deluxe` (a palavra "Edition" sozinha é ignorada — não identifica uma edição)
- `Standard Edition` = **jogo base**: "Standard" não é um tier premium, é a própria versão base (mesma key, mesmo preço). Uma listagem "Standard Edition" casa com uma busca pelo jogo base — por isso `standard` **não** é uma categoria discriminante.
- Categorias premium reconhecidas: `definitive`, `goty`, `deluxe`, `premium`, `bundle`, `special`, `complete`, `day one`

Uma busca por uma edição premium só casa com uma listagem da **mesma** edição; se não houver oferta daquela edição específica, o jogo é descartado (não cai para a base). Já a versão base casa com listagens "Standard Edition".

---

## Autenticação

O Price Researcher envia um **Bearer token** em todas as requisições de saída para o Sistema Estoque (callback do fluxo de listas). O token é lido da variável de ambiente `EXTERNAL_SECRET`.

O Sistema Estoque deve validar o header `Authorization` em seu endpoint de callback:

```
Authorization: Bearer <valor de EXTERNAL_SECRET>
```

Se `EXTERNAL_SECRET` não estiver definido no `.env`, o callback é enviado sem o header (e um aviso é logado no servidor).

---

## Erros comuns

| HTTP | Causa provável |
|---|---|
| `400` | Body/arquivo com campos ausentes ou tipos inválidos (ver `details`) |
| `404` | Path errado — confirmar que usa `/api/games/...` e `/api/lists/...` |
| `500` com `"connect ECONNREFUSED"` | Chrome/Puppeteer travou — reiniciar o container resolve |
| `500` genérico | Erro de scraping; pode ser temporário (AllKeyShop / SteamCharts fora do ar) |

---

## Variáveis de ambiente relevantes (`.env` do price-researcher)

| Variável | Padrão | Descrição |
|---|---|---|
| `HOST_PORT` | `5555` | Porta exposta no host pelo Docker |
| `PORT` | `5555` | Porta interna do Express |
| `SERVER_TIMEOUT_MS` | `600000` (10 min) | Timeout do servidor HTTP |
| `RUN_LISTS_CONCURRENCY` | `1` | Máx. de execuções paralelas do fluxo de listas |
| `MAX_ACTIVE_LISTS` | `3` | Máx. de listas ativas por usuário processadas |
| `STEAMTRADES_PAGE_DELAY_MS` | — | Delay entre page loads do SteamTrades (throttling) |
