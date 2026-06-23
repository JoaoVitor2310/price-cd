# Suppliers — Data Model for Sistema Estoque

Este documento descreve o modelo de dados que o **price-cd** precisa que o **Sistema Estoque** persista durante o fluxo `findNewSuppliers`. O price-cd não armazena nada localmente — toda persistência é responsabilidade do Sistema Estoque.

---

## Contexto

O price-cd varre listas de trade do SteamTrades, busca preços via AllKeyShop/Gamivo e envia os dados ao endpoint `/suppliers/prospect` do Sistema Estoque para avaliação de rentabilidade. O Sistema Estoque decide quais jogos são rentáveis e se vale negociar com aquele fornecedor.

---

## Endpoint de integração

### `POST /suppliers/prospect`

Avalia se os jogos de um fornecedor são rentáveis e registra o fornecedor no Sistema Estoque.

**Payload:**

```json
{
  "supplier": {
    "steam_id": "76561198xxxxxxxxx",
    "url": "https://steamcommunity.com/id/exemplo",
    "is_added": true
  },
  "games": [
    { "name": "Game X", "price_euro": 4.99, "popularity": 1200, "region": null }
  ]
}
```

**Campos do `supplier`:**

| Campo | Tipo | Origem no price-cd |
|---|---|---|
| `steam_id` | `string` | Extraído do href `a.author_name` → `/user/{steam_id}` na página do tópico |
| `url` | `string` | Construída como `https://steamcommunity.com/profiles/{steam_id}` |

**Resposta `200`:**

```json
{
  "profitable": [
    { "name": "Game X", "price_euro": 4.99, "popularity": 1200, "region": null, "tf2_price": 0.45 }
  ],
  "is_added": false
}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `profitable` | `array` | Jogos que passaram no critério de rentabilidade com o preço em keys TF2 calculado |
| `is_added` | `boolean` | Se o fornecedor já está adicionado como contato no Sistema Estoque — retornado pelo Sistema Estoque, não enviado pelo price-cd |

> A decisão de comentar ou não (`profitable.length > 0`) é responsabilidade do use case no price-cd, não do Sistema Estoque.

---

## Tabelas / Entidades esperadas no Sistema Estoque

### `suppliers`

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | `bigint` PK | Identificador interno |
| `steam_id` | `string` UNIQUE | Steam ID de 64 bits do usuário |
| `url` | `string` | URL do perfil Steam |
| `is_added` | `boolean` | Se o fornecedor foi adicionado como contato — gerenciado internamente pelo Sistema Estoque |
| `created_at` | `timestamp` | Primeiro encontro |
| `updated_at` | `timestamp` | Última atualização |

### `trades` (já existente)

Os tópicos do SteamTrades são apenas o mecanismo de descoberta — não precisam ser persistidos. O que vale registrar é a negociação gerada a partir dos jogos rentáveis encontrados. Cada conjunto de jogos rentáveis de um fornecedor deve gerar uma entrada na tabela `trades` existente no Sistema Estoque, vinculada ao `supplier_id`.

