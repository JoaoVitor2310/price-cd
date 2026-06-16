# Contrato de API — Avaliação de Rentabilidade de Fornecedores

## Contexto

O **Price Researcher** é responsável por descobrir fornecedores no SteamTrades e obter
os preços dos jogos via SteamCharts + AllKeyShop. Ele **não calcula** rentabilidade em
keys TF2 — essa lógica fica centralizada no **Sistema Estoque**.

Quando um fornecedor tem jogos com preço encontrado, o Price Researcher chama o
Sistema Estoque para saber quais desses jogos são rentáveis e com qual valor em keys TF2.

---

## Variável de ambiente necessária (Price Researcher)

```env
SISTEMA_ESTOQUE_PROFITABILITY_URL=https://seu-sistema-estoque.com/api/suppliers/evaluate
```

---

## Requisição — Price Researcher → Sistema Estoque

**`POST {SISTEMA_ESTOQUE_PROFITABILITY_URL}`**

```json
{
  "games": [
    {
      "name": "Half-Life",
      "priceEur": 4.50,
      "popularity": 500,
      "region": "global"
    },
    {
      "name": "Terraformers",
      "priceEur": 2.10,
      "popularity": 155,
      "region": "eu"
    }
  ]
}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | string | Nome do jogo normalizado |
| `priceEur` | number | Melhor preço encontrado no AllKeyShop em EUR |
| `popularity` | number | Pico de jogadores em 24h (SteamCharts) |
| `region` | string | `"global"`, `"eu"` ou `"row"` |

---

## Resposta esperada — Sistema Estoque → Price Researcher

**HTTP 200**

```json
{
  "profitable": [
    {
      "name": "Half-Life",
      "priceEur": 4.50,
      "popularity": 500,
      "region": "global",
      "tf2_price": 2.10
    }
  ]
}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `profitable` | array | Apenas os jogos com `keys > 0`. Jogos não rentáveis são omitidos. |
| `name` | string | Mesmo nome recebido |
| `priceEur` | number | Mesmo preço recebido |
| `popularity` | number | Mesma popularidade recebida |
| `region` | string | Mesma região recebida |
| `tf2_price` | number | Preço em keys TF2 calculado pelo Sistema Estoque |

Se nenhum jogo for rentável, retornar `{ "profitable": [] }`.

---

## O que o Price Researcher faz com a resposta

1. Se `profitable` estiver vazio → registra o tópico como `not_profitable` no banco local e segue para o próximo.
2. Se houver jogos rentáveis → posta um comentário no SteamTrades com a lista de jogos e seus valores em keys, no formato:

```
Hi! Interested in:

Half-Life --- 2,10x TF2

Add me 🙂
```

3. Registra o tópico como `commented` no banco local com o resultado em formato TSV (mesmo formato do export de arquivo do sistema).

---

## Erros

Em caso de falha na chamada (timeout, 5xx, rede), o Price Researcher **não** posta
comentário e **não** registra o tópico como processado — na próxima rodada do scheduler
(24h), o tópico será tentado novamente.
