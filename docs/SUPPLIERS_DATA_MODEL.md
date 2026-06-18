# Suppliers — Data Model for Sistema Estoque

Este documento descreve o modelo de dados que o **price-cd** precisa que o **Sistema Estoque** persista durante o fluxo `findNewSuppliers`. O price-cd não armazena mais nada localmente — toda persistência é responsabilidade do Sistema Estoque.

---

## Contexto

O price-cd varre listas de trade do SteamTrades, busca preços via AllKeyShop/Gamivo e envia os dados ao endpoint `/suppliers/evaluate` do Sistema Estoque para avaliação de rentabilidade. Após receber os jogos rentáveis, o price-cd posta um comentário no tópico do SteamTrades com os preços em keys TF2.

O Sistema Estoque deve persistir:
1. O **fornecedor** (dono do tópico no SteamTrades).
2. O **tópico** do SteamTrades vinculado ao fornecedor.
3. Os **jogos rentáveis** ofertados naquele tópico (quando houver).

---

## Tabelas / Entidades

### `suppliers`

Representa um usuário do SteamTrades que possui pelo menos um tópico de trade.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | `bigint` PK | Identificador interno |
| `steam_id` | `string` UNIQUE | Steam ID do usuário (ex: `76561198012345678`) |
| `created_at` | `timestamp` | Primeiro encontro |
| `updated_at` | `timestamp` | Última atualização |

> O `steam_id` é extraído do perfil do SteamTrades via link para o perfil Steam do usuário. É o identificador primário para evitar duplicatas.

---

### `supplier_topics`

Representa um tópico de trade no SteamTrades. Um fornecedor pode ter múltiplos tópicos ao longo do tempo.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | `bigint` PK | Identificador interno |
| `supplier_id` | `bigint` FK → `suppliers.id` | Dono do tópico |
| `code` | `string` UNIQUE | Código do tópico no SteamTrades (ex: `t12345`) — extraído da URL |
| `url` | `string` | URL completa do tópico (ex: `https://www.steamtrades.com/trade/t12345/...`) |
| `status` | `enum` | Ver valores abaixo |
| `last_commented_at` | `timestamp` nullable | Última vez que o price-cd postou comentário neste tópico |
| `created_at` | `timestamp` | Primeira vez que o tópico foi encontrado |
| `updated_at` | `timestamp` | Última atualização |

**Valores de `status`:**

| Valor | Significado |
|---|---|
| `active` | Tópico está aberto e o dono está negociando |
| `inactive` | Tópico marcado como inativo pelo SteamTrades (ícone amarelo) — dono pode ter saído ou encerrado o trade |
| `commented` | price-cd postou comentário com oferta; aguardando resposta do fornecedor |

> **Regra de negócio:** um tópico não deve receber comentário se `last_commented_at` for há menos de 24h. Essa lógica deve ser aplicada pelo price-cd consultando este campo antes de postar.

---

### `supplier_topic_games` (opcional, mas recomendado)

Registra os jogos rentáveis encontrados em cada tópico no momento do comentário. Útil para rastrear quais jogos levaram a uma negociação.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | `bigint` PK | Identificador interno |
| `topic_id` | `bigint` FK → `supplier_topics.id` | Tópico de origem |
| `name` | `string` | Nome do jogo normalizado |
| `price_euro` | `decimal(8,2)` | Preço encontrado no AllKeyShop/Gamivo em euros |
| `tf2_price` | `decimal(8,2)` | Equivalente em keys TF2 calculado pelo Sistema Estoque |
| `popularity` | `integer` | Pico de jogadores em 24h (SteamCharts) |
| `region` | `string` nullable | Região da key (`global`, `eu`, `br`, etc.) ou `null` se não identificada |
| `created_at` | `timestamp` | Data do registro |

---

## Fluxo de Persistência

```
price-cd                          Sistema Estoque
   │                                    │
   │── POST /suppliers/evaluate ────────▶│  (avalia jogos, retorna tf2_price)
   │◀─ { profitable: [...] } ───────────│
   │                                    │
   │── POST /suppliers/topics ──────────▶│  (registra tópico + fornecedor + jogos)
   │◀─ { topic_id: 42 } ────────────────│
   │                                    │
   │  [posta comentário no SteamTrades] │
```

### Payload sugerido para `POST /suppliers/topics`

```json
{
  "steam_id": "76561198012345678",
  "topic": {
    "code": "t12345",
    "url": "https://www.steamtrades.com/trade/t12345/my-trade-list",
    "status": "commented"
  },
  "games": [
    {
      "name": "Half-Life 2",
      "price_euro": 1.85,
      "tf2_price": 2.10,
      "popularity": 1200,
      "region": "global"
    }
  ]
}
```

O Sistema Estoque deve:
1. Fazer upsert do `supplier` pelo `steam_id`.
2. Fazer upsert do `supplier_topic` pelo `code`, atualizando `status` e `last_commented_at`.
3. Inserir os `supplier_topic_games` vinculados ao tópico.

---

## Consulta necessária pelo price-cd

Antes de postar comentário, o price-cd precisará consultar:

```
GET /suppliers/topics/{code}
```

Resposta esperada:
```json
{
  "last_commented_at": "2025-06-17T14:00:00Z"
}
```

Se `last_commented_at` for há menos de 24h, o price-cd pula o tópico sem comentar.

> Alternativamente, o endpoint `POST /suppliers/topics` pode receber o tópico mesmo sem ter comentado (status `active`) e retornar `{ skip: true }` quando o comentário for muito recente — consolidando a lógica no Sistema Estoque.
