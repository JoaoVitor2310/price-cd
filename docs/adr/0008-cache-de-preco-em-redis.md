# O preço do AllKeyShop é cacheado em Redis por 1 hora

O AllKeyShop é a etapa cara da pesquisa: um jogo por vez num navegador, passando por Cloudflare e rate limit. Na Descoberta de Fornecedores e no Reabastecimento, o mesmo jogo aparece em várias Listas no intervalo de minutos, e cada aparição refazia a busca inteira.

**Decisão:** o preço encontrado no AllKeyShop fica guardado num Redis por 1 hora (`PRICE_CACHE_TTL_SECONDS`, default 3600). A busca seguinte do mesmo jogo, de qualquer preset, lê o cache em vez de abrir o navegador.

## Revê o ADR 0001 num ponto só

O ADR 0001 proibia armazenamento local no price-cd, e citava cache em disco como exemplo. A razão dele continua de pé: **estado de negócio** (o que foi contatado, o que foi decidido, o que precisa sobreviver entre execuções) é do Sistema Estoque. O que muda é que o price-cd passa a poder guardar **dado derivado e descartável**. O critério é: apagar tudo só deixa a próxima busca mais lenta, e nenhuma decisão depende do cache para estar correta. Guardar "tópicos já processados" no Redis continua proibido.

## O que é guardado

- **Só o preço.** A popularidade do SteamCharts continua sendo consultada sempre: é `fetch` simples, sem navegador, paralelo em lotes de 50. Cacheá-la adicionaria superfície sem economizar quase nada.
- **O dado bruto, não o resultado filtrado pelo preset.** A entrada guarda o melhor preço, se há oferta na Gamivo, o `gamivo_id` e o nome encontrado. O corte "exigir oferta na Gamivo" saiu do adapter do AllKeyShop e virou regra de domínio, aplicada depois do cache. Sem isso, um preset que exige Gamivo gravaria "sem preço" e outro que não exige herdaria o descarte.
- **A chave é o nome normalizado + região + categorias de Edição.** "Crysis 2 EU" e "Crysis 2" são entradas diferentes, assim como "Crysis 2" e "Crysis 2 Remastered". Quantidade (`x2`) não entra na chave, porque o preço é por unidade.
- **"Não encontrado" é guardado só quando é definitivo:** o AllKeyShop respondeu sem resultado, sem match, ou sem a região, a Edição ou oferta pedida. O TTL é o mesmo, 1h: "não tem" é tão estável quanto "custa X". Falha transitória (timeout, Cloudflare, HTML inesperado) **nunca** é gravada, senão esconderia o jogo pela duração do TTL. Exceção consciente: um preço com oferta na Gamivo mas sem `gamivo_id` é gravado. A resolução do id não distingue "falhou" de "não há slug", e sem `API_KEY_GAMIVO` ela nunca dá id. Recusar esse caso deixaria fora do cache os jogos com oferta na Gamivo, que são o caso mais comum. O custo é que uma falha transitória na resolução do id fica guardada pelo TTL.

## Onde mora

A porta `PriceCache` fica em `application/`. `CachedPriceFetcher` é um decorator de `PriceFetcher`, também em `application/`, porque "o que é cacheável" é política, testável sem Redis. O `PriceGames` não sabe que o cache existe. O adapter Redis só faz `get`/`set` com TTL.

## O cache nunca derruba a pesquisa

É fail-open: comando com timeout curto e sem fila offline. Com o Redis fora do ar, toda leitura vira miss e toda escrita é ignorada, com um aviso `[CACHE]` no log. Sem `REDIS_URL`, o app sobe com um cache no-op. O `GET /api/health` informa `cache: "up" | "down" | "disabled"` (`disabled` é sem `REDIS_URL`, para não ser confundido com o Redis fora do ar) e continua 200: liveness não depende de uma dependência opcional.

## Por que não as alternativas

- **Cache em memória do processo:** daria o mesmo ganho sem infraestrutura nova, e o price-cd já precisa rodar como instância única por causa do bump. Escolhemos o Redis por sobreviver ao restart do app e por poder ser inspecionado com `redis-cli`, aceitando o container a mais e o modo de falha "Redis fora", que o fail-open cobre.
- **Cache no Sistema Estoque:** ele tem banco, mas teria que conhecer a normalização de nomes e o formato das ofertas do AllKeyShop. Seria detalhe de scraping vazando para o sistema principal.
- **Cache dentro do `AllKeyShopPriceFetcher`:** mais simples, mas mistura scraping com política de cache, e testar hit/miss exigiria mockar o navegador.
- **Opção por preset de ignorar o cache:** descartada. O cache vale para todos os presets.

## Consequences

- Todo preset pode receber um preço com até 1h de idade, inclusive o `bundle-sync`. Como ele roda de hora em hora, o preço de um bundle pode ficar até ~2h sem atualizar de fato.
- Um deploy que muda a lógica de busca (match, Edição, região) não limpa o cache, porque o Redis sobrevive ao restart do app. Por até 1h, o resultado antigo continua sendo servido. O log `💾 [CACHE] hit` torna isso visível, e o flush manual está no README.
- Duas buscas simultâneas do mesmo jogo, em fluxos diferentes, ainda pesquisam duas vezes: as duas dão miss antes de entrar na fila do navegador. Single-flight ficou fora (`docs/IMPROVEMENTS.md`).
- O Redis roda sem persistência, com `maxmemory` e LRU, numa rede interna e sem porta publicada. O dev tem o próprio Redis, para que código em desenvolvimento nunca grave no cache que a produção lê.
