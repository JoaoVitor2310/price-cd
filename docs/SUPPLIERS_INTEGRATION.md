# Suppliers — Integração Price Researcher ↔ Sistema Estoque

Este documento é **compartilhado** entre os dois sistemas mas tem **seções de propriedade separada**:

- A seção [Price Researcher](#price-researcher) é mantida pelo **price-cd**. O Sistema Estoque pode consultá-la para entender o que o price espera, mas não deve editá-la.
- A seção [Sistema Estoque](#sistema-estoque) é mantida pelo **Sistema Estoque**. O price-cd pode consultá-la para entender o contrato implementado, mas não deve editá-la.

---

## Price Researcher

> **Proprietário:** price-cd (`\\wsl.localhost\ubuntu-24.04\var\www\price-cd`)
> Não edite esta seção se você é do Sistema Estoque.

### O que o price-cd faz

O price-cd varre as páginas de listagem do SteamTrades em busca de fornecedores potenciais. Para cada tópico encontrado:

1. Extrai o `list_code` (ex.: `G0eXM`) e a lista de jogos da seção `.have`.
2. Busca popularidade no SteamCharts e preço no Gamivo/AllKeyShop.
3. Envia os dados ao Sistema Estoque via `POST /suppliers/prospect`.
4. Se `should_comment === true` na resposta, posta o comentário no tópico.

### Regra de negócio: quando comentar

A decisão é **centralizada no Sistema Estoque** (`CommentPolicy`). O price-cd apenas age sobre `should_comment` — não reimplementa a lógica. Os campos `last_commented_at` e `games_changed` são retornados na resposta apenas para logging.

### Contrato com o Sistema Estoque

**Payload enviado:**

```json
{
  "supplier": {
    "steam_id": "76561198xxxxxxxxx",
    "url": "https://steamcommunity.com/profiles/76561198xxxxxxxxx"
  },
  "list_code": "G0eXM",
  "games": [
    { "name": "Game X", "price_euro": 4.99, "popularity": 1200, "region": null }
  ]
}
```

**Resposta consumida:**

```json
{
  "profitable": [
    { "name": "Game X", "price_euro": 4.99, "popularity": 1200, "region": null, "tf2_price": 0.45 }
  ],
  "is_added": false,
  "last_commented_at": "2026-06-10T14:30:00.000000Z",
  "games_changed": true,
  "should_comment": true
}
```

| Campo | Uso no price-cd |
|---|---|
| `profitable` | Monta o texto do comentário com os jogos rentáveis e preços em TF2 |
| `is_added` | Adapta a mensagem final (pedir add ou mandar mensagem direta se já é amigo) |
| `should_comment` | **Campo principal.** `true` → posta comentário; `false` → pula o tópico |
| `last_commented_at` | Logging apenas |
| `games_changed` | Logging apenas |

### Plano de implementação

O Sistema Estoque já entregou o contrato acima. As mudanças abaixo estão pendentes no price-cd:

#### 1. Remover scraping de `hasRecentComment`

Atualmente o scraper faz uma segunda navegação por tópico (`/search?page=last`) para buscar nosso último comentário. Essa lógica some — o Sistema Estoque já tem o histórico via `trades.last_commented_at`.

- Remover `hasRecentOurComment()` de `src/infrastructure/suppliers/puppeteer-topic-scraper.ts`
- Remover a segunda chamada `page.goto()` no `PuppeteerTopicScraper.scrape()`
- Remover `hasRecentComment` de `TopicData` em `src/application/suppliers/ports/topic-scraper.port.ts`
- Remover a verificação `if (topic.hasRecentComment)` do use case
- Remover testes de `hasRecentOurComment` de `test/unit/infrastructure/suppliers/puppeteer-topic-scraper.test.ts`

#### 2. Atualizar a porta `ProfitabilityChecker`

Em `src/application/suppliers/ports/profitability-checker.port.ts`:

- Adicionar `list_code: string` a `SupplierInput` (o `code` do tópico já vem do paginator)
- Adicionar `should_comment: boolean`, `last_commented_at: string | null` e `games_changed: boolean` a `ProspectResult`

#### 3. Atualizar `HttpProfitabilityChecker`

Em `src/infrastructure/suppliers/http-profitability-checker.ts`:

- Incluir `list_code` no payload enviado ao endpoint
- Mapear `should_comment`, `last_commented_at` e `games_changed` da resposta para `ProspectResult`

#### 4. Atualizar o use case

Em `src/application/suppliers/find-new-suppliers.use-case.ts`:

- Passar `list_code: code` dentro do `SupplierInput` (o `code` já existe no loop do tópico)
- Substituir `if (profitableGames.length === 0)` por `if (!result.should_comment)`
- Adicionar log com `last_commented_at` e `games_changed` para observabilidade

#### 5. Atualizar testes

- Use case: substituir casos de `hasRecentComment` por `should_comment: true/false`
- Scraper: remover casos de `hasRecentOurComment`

---

## Sistema Estoque

> **Proprietário:** Sistema Estoque
> Não edite esta seção se você é do price-cd.

> **⚠ Aviso para o price-cd:** o contrato descrito na seção acima está desatualizado em relação ao que foi implementado. Quando for integrar, leia esta seção — ela tem o contrato real — e atualize a seção Price Researcher para refletir o que foi de fato acordado. Diferenças principais: (1) `topic_code` foi renomeado para `list_code`; (2) a resposta agora inclui `should_comment` e a lógica de decisão foi centralizada aqui — o price-cd não precisa mais reimplementá-la.

---

### Estado atual do schema

| Tabela | Campos relevantes |
|--------|------------------|
| `suppliers` | `id`, `steam_id` (nullable, unique), `url` (nullable), `is_added` (bool, default `false`), `has_traded` (bool, default `false`), `timestamps` |
| `trades` | `id`, `title`, `rows` (JSON), `supplier_id` (FK nullable → `suppliers.id`, on delete set null), `list_code` (nullable), `last_commented_at` (timestamp nullable), `timestamps` |
| `keys` | `supplier_id` (FK → `suppliers.id`, NOT NULL), `supplier_url` (redundante — remoção planejada na Fase 6) |

**Endpoint ativo:** `POST /suppliers/prospect` → `SupplierController@prospect` (Bearer via `EXTERNAL_SECRET`)

**Payload atual:**
```json
{
  "supplier": { "steam_id": "76561198xxxxxxxxx", "url": "https://steamcommunity.com/profiles/..." },
  "list_code": "G0eXM",
  "games": [{ "name": "Game X", "price_euro": 4.99, "popularity": 1200, "region": null }]
}
```

> `list_code` é opcional — código gerado pelo SteamTrades que identifica o tópico de origem. Trades criadas manualmente ficam com `null`.

**Resposta atual:**
```json
{
  "profitable": [{ "name": "Game X", "price_euro": 4.99, "popularity": 1200, "region": null, "tf2_price": 0.45 }],
  "is_added": false,
  "last_commented_at": "2026-06-10T14:30:00.000000Z",
  "games_changed": true,
  "should_comment": true
}
```

> `should_comment` — **campo principal para o price-cd**. Calculado por `Domain/Trades/CommentPolicy::shouldComment()` com a regra: `profitable.length > 0` AND (`games_changed` OR `last_commented_at === null` OR ≥ 14 dias desde o último comentário). Quando `true`, a trade é criada com `last_commented_at = now()`. Quando `false`, nenhuma trade é criada.
> `last_commented_at` — valor da trade anterior com o mesmo `list_code` onde `last_commented_at IS NOT NULL`. `null` se nunca comentamos nesse tópico ou `list_code` não foi enviado. Útil para logging no price-cd.
> `games_changed` — derivado por `Domain/Trades/TradeGameComparison::hasChanged()`; compara nomes do request com rows da trade anterior. Útil para logging no price-cd.
> **Nota de design:** a regra de "quando comentar" é centralizada no Sistema Estoque (`CommentPolicy`). O price-cd apenas age sobre `should_comment` — não reimplementa a lógica.

---

### Fases planejadas

#### Fase 5 — Normalizar `marketPriceRaw` em `trades.rows`

Rows antigas armazenam `marketPriceRaw` como string com vírgula (`"5,78"`) por herança do TSV colado manualmente. O correto é ponto decimal (`"5.78"`) — vírgula é formatação de display.

Migration: ler todos os `rows`, converter vírgula → ponto em `marketPriceRaw` e `tf2Qty`, salvar. O frontend já faz `replace(',', '.')` antes de `parseFloat`, então não quebra durante a transição.

---

#### Fase 6 — Remover `supplier_url` de `keys`

Hoje `keys.supplier_url` é redundante: o vínculo real é via `keys.supplier_id → suppliers.id → suppliers.url`.

Estratégia Expand-Contract:
1. Garantir que todos os `keys.supplier_id` estejam preenchidos corretamente
2. Remover leituras/escritas de `supplier_url` do código (KeyController, RegisterKeyUseCase, ImportKeysFromXlsxUseCase)
3. Migration `dropColumn('supplier_url')` em `keys`

---

#### Fase 7 — Absorver `VipList` em `trades` e `vips` em `suppliers`

Hoje `Vip`, `VipList` e `Supplier` são entidades separadas, mas representam o mesmo conceito: um fornecedor Steam com uma lista de jogos.

**`VipList` → `trades`:**
- Uma execução de lista VIP é estruturalmente idêntica a uma trade: tem `rows` (jogos), um responsável (o VIP = supplier) e uma origem (o tópico do SteamTrades = `list_code`)
- Migração: cada `VipList` vira uma `Trade` com `list_code` preenchido e `supplier_id` apontando para o supplier correspondente
- `VipListExecutionService`, `ExecuteVipListUseCase` e a tabela `vip_lists` são removidos após a migração

**`Vip` → `suppliers`:**
- `Vip.id_steam` já é coberto por `suppliers.steam_id`
- Campos de VIP (flags, histórico) migram para `suppliers`
- Tabela `vips` removida após migração

Escopo detalhado a definir antes de implementar.

---

#### Fase 8 — Tela de gerenciamento de fornecedores (UI)

- Listar suppliers com `has_traded`, `is_added`, última trade associada
- Permitir marcar `is_added` manualmente (quando o usuário adiciona o fornecedor no Steam)
- Exibir supplier no card de Trade na aba Trades (hoje `supplier_id` está no banco mas não é exibido)