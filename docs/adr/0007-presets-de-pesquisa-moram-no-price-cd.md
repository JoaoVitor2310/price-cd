# Os critérios de pesquisa moram no price-cd, como presets nomeados

Cada caso de uso do price-cd pesquisava com uma combinação própria de critérios — popularidade mínima, piso de preço, exigir oferta na Gamivo — e cada um a montava num lugar diferente: a página tinha os seus valores, `lists` e `suppliers` tinham um 30 fixo no código, e o Sistema Estoque montava os critérios de bundle do lado dele. Mudar a regra de bundle exigia deploy dos dois sistemas, e ninguém conseguia dizer de cabeça qual combinação valia para quê.

**Decisão:** os critérios viram **presets nomeados** no Domain do price-cd (`src/domain/games/search-presets.ts`): `default`, `bundle-research`, `bundle-sync`, `lists`, `suppliers`. Quem chama manda o nome; qualquer critério enviado explicitamente sobrescreve o do preset, campo a campo. A página lê os presets de `GET /api/games/presets` e só preenche os campos com eles — sem oferecer o `bundle-sync`, que só a chamada do Sistema Estoque usa (o filtro é da página; a API e o endpoint continuam expondo).

## Popularidade por faixa de preço, cortada em dois estágios

A popularidade mínima deixou de ser um número único: há um mínimo para jogos **até** um limite de preço (inclusive) e outro para os **acima** dele. Jogo barato rende pouco por key, então basta pouca procura; jogo caro só compensa com procura de verdade. O padrão é 30 até €5 — o corte plano de antes — e 100 acima.

O tier depende do preço, que só se conhece depois do AllKeyShop, a etapa cara (sequencial, num navegador). Filtrar tudo no fim faria o AllKeyShop pesquisar quase todo jogo. Por isso o corte é feito duas vezes: antes do preço, pelo **menor** tier (quem não passa nele não passa em nenhum); depois, pelo tier exato da faixa do preço encontrado.

## Consultar a popularidade e cortar por ela são decisões separadas

Antes, o `0` dos tiers fazia duas coisas: "não corta ninguém" e "não consulta o SteamCharts". O `bundle-research` precisava do contrário do que o `0` dava: consultar (para informar o número) e **não** cortar ninguém, porque o fornecedor vende o bundle inteiro, inclusive o jogo com pico 0 ou que o SteamCharts não conhece. Ele usava popularidade 1 para forçar a consulta, e esse 1 descartava justamente esses jogos.

**Decisão:** `SearchCriteria` ganha `lookupPopularity`, que decide só se há consulta. Os tiers passam a só cortar. Jogo que o SteamCharts não devolve entra com popularidade 0 (`withUnratedGames`) e o tier decide: com mínimo 0 segue para o preço, com mínimo 1 ou mais cai, como sempre caiu. O `bundle-research` fica com tiers `0/0` e `lookupPopularity: true`; o `bundle-sync` com `0/0` e `false`.

O invariante entre os dois eixos é resolvido uma vez, em `resolveSearchCriteria`: um tier acima de 0 exige a consulta, então `lookupPopularity` sai `true` mesmo que o preset ou a requisição peçam `false`. Sem isso, escolher `bundle-sync` e digitar um mínimo de 30 descartaria todo jogo em silêncio. O motor (`PriceGames`) só lê a flag. A porta `PopularityFetcher` não mudou: ela continua omitindo quem não achou, e a política sobre o omitido fica no Domain.

Consequência aceita: o SteamCharts não distingue "o jogo não existe lá" de "a consulta falhou" (429, 5xx, rede) — o fetcher devolve `null` para os dois. Num bundle isso é o lado certo para errar (o jogo volta), mas o `0` passa a poder significar "sem dado" além de "0 jogadores". Distinguir os dois com `null` mexeria no contrato com o Sistema Estoque; está no `docs/IMPROVEMENTS.md`.

## Critério e entrega são eixos separados

O preset define **o que** pesquisar. **O que fazer com o resultado** é outro parâmetro (`delivery`): criar a Trade em background (`trade`), devolver na resposta (`respond`) ou, sem token, o demo limitado a 10 jogos. O mesmo preset pode ser usado dos dois jeitos, então misturar os dois eixos num preset só multiplicaria os presets sem necessidade.

`respond` existe para a sync de bundle do Sistema Estoque, que guarda os preços no próprio bundle e não cria Trade. Com ela, `POST /api/games/search` deixou de ter consumidor e foi removido junto com o `SearchGamesUseCase` — o `/research` é a única rota de pesquisa de preço.

## Por que não as alternativas

- **Presets só no front (`index.html`)**: as regras ficariam duplicadas com o Sistema Estoque, que não lê a página, e sem teste num arquivo de mil linhas.
- **Critérios montados por quem chama, como antes**: é exatamente o que espalhava a regra e exigia deploy coordenado para mudá-la.
- **Filtrar a popularidade só depois do preço**: correto, mas manda ao AllKeyShop jogos que nenhum tier aceitaria.
- **`enum` do TypeScript para os nomes**: não resolve o nome amigável da tela (ainda precisaria de um mapa à parte), não é validado direto pelo `z.enum` e gera código extra de runtime. Os nomes são um array `as const`; os rótulos ficam em `SEARCH_PRESET_LABELS`, fora dos critérios.

## Consequences

- Mudar o critério de um caso de uso é mudar o preset aqui; o Sistema Estoque manda só o nome e não precisa de deploy.
- O contrato do `/research` é estrito: um campo novo exige combinar com o Sistema Estoque antes. `minPopularity` foi um atalho da migração e saiu; mandá-lo hoje é campo desconhecido, logo `400`.
- Os presets são congelados (`Object.freeze`, inclusive os tiers aninhados) porque são estado compartilhado do processo inteiro; `resolveSearchCriteria` sempre devolve uma cópia nova.
- `respond` roda dentro da requisição, um jogo por vez no AllKeyShop, e **fora** da fila de 1 da pesquisa. A sync assíncrona com callback, que eliminaria a requisição longa e o próprio `respond`, está registrada em `docs/IMPROVEMENTS.md`.
- Quem consulta é `lookupPopularity`, não os tiers. Com `0/0` e a flag ligada (`default`, `bundle-research`), a consulta acontece e ninguém é cortado. Com um tier só em 0, o jogo que o SteamCharts não conhece sobrevive na faixa que pedia 0 (mudou: antes era descartado).
