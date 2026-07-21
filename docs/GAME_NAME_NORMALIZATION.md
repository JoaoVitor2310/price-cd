# Game Name Normalization — Estratégia de Matching

## Problema

O price-cd envia nomes de jogos vindos do SteamCharts/AllKeyShop que podem ter formatação diferente do nome armazenado no sistema-estoque:

```
Price-CD envia:     "Grand Theft Auto V"
Sistema-estoque:    "grand theft auto 5"
```

O match falha por diferença de formatação (casing, algarismo romano), não por serem jogos diferentes.

---

## O que é diferença de formatação vs. produto diferente

### Diferença de formatação — `clearString` resolve

São o mesmo produto, escritos de jeitos diferentes:

- `"The Witcher III: Wild Hunt"` = `"witcher 3 wild hunt"` (artigo, romano, pontuação)
- `"DOOM Eternal"` = `"doom eternal"` (casing)

### Produto diferente — NÃO normalizar para fins de inventário

DLC e Edition são SKUs distintos com preços e margens diferentes. O sistema-estoque os trata como entradas separadas no estoque:

- `"Cyberpunk 2077"` ≠ `"Cyberpunk 2077 Deluxe Edition"` — preços diferentes
- `"DOOM Eternal"` ≠ `"DOOM Eternal: The Ancient Gods DLC"` — conteúdo diferente
- `"Fallout 4"` ≠ `"Fallout 4 Season Pass"` — conteúdo diferente

---

## Como cada fetcher usa as funções de normalização

### SteamChartsPopularityFetcher (`src/infrastructure/games/steam-charts-popularity-fetcher.ts`)

Objetivo: encontrar o jogo base no SteamCharts a partir de um nome que pode ser uma DLC ou edição especial. O SteamCharts só indexa o jogo base, não cada variante.

**Query enviada ao SteamCharts:**
```
clearEdition → clearQuantity
```
`clearDLC` não entra na query — os termos de DLC ajudam a refinar os resultados de busca.

**Matching contra os resultados retornados (ambos os lados):**
```
clearString → clearDLC → clearEdition → lowercase
```
Aqui sim o `clearDLC` entra, junto com `clearEdition`, para comparar jogo buscado e resultado no mesmo formato normalizado.

### AllKeyShopPriceFetcher (`src/infrastructure/games/allkeyshop-price-fetcher.ts`)

Objetivo: encontrar o preço exato do produto buscado — Edition e DLC são produtos diferentes e devem ser encontrados como tal.

**Query enviada ao AllKeyShop:**
```
clearQuantity
```
Só remove quantificadores (`x2`, `3x`). O nome vai essencialmente intacto para maximizar a precisão da busca.

**Matching contra os resultados (ambos os lados):**
```
clearEdition → clearString → clearQuantity → lowercase
```

Com uma guarda extra via `hasEdition`: antes de aceitar o match, compara os keywords de edição de ambos os lados. Se um tem `"Deluxe"` e o outro não, **o match é rejeitado** — mesmo que o nome base normalize para o mesmo valor.

```
"Cyberpunk 2077 Deluxe Edition"  → clearEdition → "cyberpunk 2077"
"Cyberpunk 2077"                  → clearEdition → "cyberpunk 2077"
// nomes iguais após clearEdition — mas:
hasEdition("Cyberpunk 2077 Deluxe Edition") → { "deluxe", "edition" }
hasEdition("Cyberpunk 2077")                → {}
// sets diferentes → editionMismatch = true → não é match
```

Ou seja, `clearEdition` normaliza o nome base para comparação, mas `hasEdition` garante que variantes de edição distintas nunca se cruzem.

---

## Pipeline de normalização por contexto

| Contexto | Pipeline |
|---|---|
| Matching de inventário (price-cd → sistema-estoque) | `clearString` |
| Query no SteamCharts | `clearEdition → clearQuantity` |
| Matching no SteamCharts | `clearString → clearDLC → clearEdition → lowercase` |
| Query no AllKeyShop | `clearQuantity` |
| Matching no AllKeyShop | `clearEdition → clearString → clearQuantity → lowercase` + guarda `hasEdition` |

---

## Opções de implementação do matching de inventário

### Opção A — Normalizar no price-cd antes de enviar *(menor esforço)*

Aplicar `clearString` no `name` antes de construir o `GameTradeInput`. O sistema-estoque recebe o nome já formatado e faz busca com `LOWER()` ou coluna `normalized_name`.

**Pro:** zero mudança no Laravel.  
**Contra:** os nomes já existentes no banco precisam também estar normalizados para o match funcionar.

### Opção B — Enviar nome original + nome normalizado *(mais robusto)*

Adicionar `normalized_name` ao payload:

```json
{
  "name": "Grand Theft Auto V",
  "normalized_name": "grand theft auto 5"
}
```

O Laravel usa `normalized_name` na busca e mantém `name` para exibição.

**Pro:** preserva o nome original; o sistema-estoque escolhe qual usar.  
**Contra:** requer mudança no payload e no controller Laravel.

### Opção C — API de lookup no sistema-estoque *(mais correto, mais trabalho)*

Price-cd chama `GET /games/lookup?name=Grand+Theft+Auto+V` antes de enviar → recebe `{ id: 42, canonical_name: "grand theft auto 5" }` → envia o ID diretamente.

**Pro:** elimina o problema de string matching completamente; o sistema-estoque é a fonte de verdade.  
**Contra:** adiciona uma chamada HTTP extra por jogo; requer novo endpoint no Laravel.

---

## Decisão pendente

Nenhuma opção foi implementada ainda. A normalização foi documentada em `NORMALIZE_GAME_NAME_PHP.md` para implementação temporária no sistema-estoque.

A Opção A é o próximo passo natural quando os nomes no banco estiverem normalizados.
