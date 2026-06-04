# Lógica do buscador de novos fornecedores (new_suppliers)

Documento de referência para reescrever essa lógica dentro do price researcher.
O objetivo original era descobrir usuários no SteamTrades que vendem jogos por keys TF2,
avaliar se são rentáveis e entrar em contato. Aqui estão os detalhes que importam para
reimplementar isso de forma melhor.

---

## Problema central da implementação atual (ignorar na reescrita)

A implementação original parte de perfis Steam semeados manualmente, percorre listas de
amigos para acumular SteamIDs e só então verifica quem tem trade no SteamTrades.
**Essa abordagem está descartada.** A reescrita vai direto na fonte.

---

## Nova estratégia de descoberta: varrer o SteamTrades diretamente

### Ponto de entrada
Começar em `https://www.steamtrades.com/` e avançar pelas páginas de listagem:
- Página 1: `https://www.steamtrades.com/`
- Página 2: `https://www.steamtrades.com/trades/search?page=2`
- Página 3: `https://www.steamtrades.com/trades/search?page=3`
- ...até página 100

### Critério de parada antecipada
Parar antes da página 100 se **5 tópicos inativos forem encontrados em sequência**
(trade inativa = `.notification.yellow` presente na página do tópico).

### Como extrair os links dos tópicos em cada página
Cada tópico está em um elemento `.row_trade_name h2 a`. O `href` é relativo, ex.:
```html
<div class="row_trade_name">
  <h2><a href="/trade/FjgPJ/h-few-leftovers-w-offers">[H] Few leftovers [W] Offers</a></h2>
</div>
```
Link completo: `https://www.steamtrades.com` + href

Mais detalhes serão adicionados sobre filtragem e processamento de cada tópico.

---

## Como o SteamTrades funciona (detalhes de página)

### Página de um tópico individual
- Trade inativa: presença de `.notification.yellow` na página — se existir, pular
- Nome do autor: `.author_name` (innerText)
- ID do usuário no SteamTrades: extraído do `href` de qualquer `a[href*="/user/"]` via regex `/\/user\/([^\/?#]+)/i`
  - Fallback: pegar o segundo segmento do `window.location.pathname`
- Seção "Have" (o que o vendedor tem): `.have` — innerText splitado por `\n`, cada linha é um jogo. Descartar linhas vazias (`.filter(Boolean)`) pois o HTML costuma ter quebras em branco entre os itens
- Caixa de comentário: `textarea[name="description"]`
- Botão de enviar: `.btn_action.white.js_submit`
- Verificar se já está logado: ausência de `a[href*="/login"]` e ausência de "Sign in"/"Log in" no body
- Verificar se já comentou nessa trade: `.comment` elements — checar se algum contém o texto "Interested"

---

## Lógica de avaliação de rentabilidade

### Fluxo
1. Para cada tópico encontrado na paginação, abrir a página do tópico
2. Verificar se está inativo: presença de `.notification.yellow` → pular (e incrementar contador de inativos consecutivos)
3. Se ativo, extrair os jogos da seção `.have`
4. Enviar para o price researcher obter o preço em EUR de cada jogo
5. Para cada jogo, calcular o valor em keys TF2:

```
TAXA_STEAM:
  se preço < 0.28 EUR   → taxa = 0.11 EUR (fixo)
  se preço >= 8.00 EUR  → taxa = (preço * 0.08) + 0.40
  caso contrário        → taxa = (preço * 0.06) + 0.25

valor_liquido = preço - taxa
chave_TF2_em_EUR = R$8.90 / cotação_EUR_BRL   (API: exchangerate.host/latest?base=EUR&symbols=BRL, fallback: 5.87)
keys = (valor_liquido / chave_TF2_em_EUR) / 1.7
```

O divisor `1.7` é a **margem de lucro** embutida. Ajustar conforme necessário.

6. Filtrar jogos com `keys > 0`
7. Se houver ao menos 1 jogo rentável → vale contatar

### Consulta de preços
Para cada jogo extraído do `.have`, utilizar as funções internas disponíveis no projeto
para buscar preço, popularidade e demais dados relevantes de cada título.

---

## Detalhes de anti-bot e rate limiting

Os delays serão definidos conforme observação real do comportamento da Cloudflare/SteamTrades.
A estratégia é começar sem delays e ajustar conforme os erros que aparecerem.

### Tratamento de rate limit (429)
Já existe um padrão implementado no price researcher que pode ser reutilizado:
verificar o header `retry-after` da resposta para saber exatamente quanto tempo esperar,
com fallback em backoff exponencial:

```js
if (status === 429) {
    const retryAfterHeader = headers["retry-after"];
    const retryAfterSeconds = retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : Math.pow(2, attempt - 1) * (baseDelay / 1000);

    console.log(
        `⚠️ [INFO] Too many requests(fetch). Attempt ${attempt}/${maxRetries}. Retrying in ${retryAfterSeconds}s...`
    );

    await delay(retryAfterSeconds * 1000);
} else {
    console.error(
        `⚠️ [INFO] Service Unavailable. Attempt ${attempt}/${maxRetries}. Retrying in 1.5s...`
    );
    await delay(1500);
}
```

### Configuração do Puppeteer que funciona
```js
puppeteer.launch({
  headless: false,          // para sessão logada (postagem de comentários)
  userDataDir: "./profile", // mantém sessão entre execuções (ver nota abaixo)
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled"
  ]
})
```

**Nota sobre `userDataDir: "./profile"`:** essa pasta armazena toda a sessão do browser
(cookies, localStorage, etc.) em disco. Isso mantém o usuário logado no SteamTrades
entre execuções sem precisar fazer login toda vez. Na reescrita, usar um caminho absoluto
e garantir que a pasta exista antes de iniciar.

Para scraping sem login (só leitura), `headless: true` funciona bem com concorrência de 3 workers.

Para scraping de leitura, usar `puppeteer-extra` com `puppeteer-extra-plugin-stealth` ajuda a
evitar detecção.

---

## Controle de estado (o que não reprocessar)

O projeto usa arquivos `.txt` como banco de dados simples. Para a reescrita, trocar por
banco de dados real, mas a lógica de deduplicação é a mesma:

| Arquivo | Propósito |
|---|---|
| `arq/processados.txt` | Trades já processadas (incluindo puladas) |
| `arq/comentados.txt` | SteamTrades user IDs que já receberam comentário |

A normalização de URL usada para deduplicação: `.trim().replace(/\/+$/, "")` (remove trailing slash).

---

## Formato do comentário postado

```
{intro aleatório} Interested in:

{jogo1} --- {X,XX}x TF2
{jogo2} --- {X,XX}x TF2
...

Add me 🙂
```

Intros usadas (rotação aleatória para variar o texto):
- `"Hi! Interested in:"`
- `"Hey! I'm interested in:"`
- `"Hello! Looking for:"`
- `"Hi there! Interested in these:"`

O preço é formatado como `toFixed(2).replace(".", ",")` (vírgula como separador decimal).

---

## O que mudar na reescrita

1. **Persistência**: substituir os arquivos `.txt` por banco de dados para facilitar
   consultas, deduplicação e rastreamento de status.

2. **Concorrência**: o scraping de leitura já usa 3 workers em paralelo e funciona bem.
   A etapa de postagem de comentários precisa ser serial por conta dos delays longos.
