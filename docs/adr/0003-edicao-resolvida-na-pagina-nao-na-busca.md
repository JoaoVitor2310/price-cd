# Edição de jogo é resolvida dentro da página do AllKeyShop, nunca na busca

A busca no AllKeyShop (`search_name`) nunca leva palavras de edição na query (sempre `clearEdition(game.name)`) — incluir edição na query quebra a busca (ex.: `"Prey 2017 Deluxe Edition"` não encontra o jogo, `"Prey 2017"` encontra). Como consequência, `matchSearchResult` casa os resultados pelo nome-base normalizado (edição ignorada) e só usa a edição como critério de desempate quando **mais de um** candidato compartilha o mesmo nome-base — caso raro em que a edição é um produto realmente separado no catálogo (ex.: "Skyrim" 2011 vs "Skyrim Special Edition" 2021, remaster com página própria), não uma variação de preço dentro da mesma página (caso comum, ex.: Prey Standard/Deluxe/Bundle, resolvido por `findEditionKey` já dentro da página via `editions`/`prices`). Com um único candidato, ele é aceito mesmo que seu título não reflita a edição pedida — a edição desse jogo mora na página, não no título do resultado de busca.

## Considered Options

Cogitamos buscar duas vezes (sem edição primeiro; se não achar nada, repetir a busca incluindo a edição na query). Rejeitado porque o caso Skyrim não é "não achou nada" — a busca sem edição já retorna as duas linhas (Special Edition e base) — e porque reintroduzir a edição na query reativaria o próprio bug que motivou tirar a edição da busca (Prey).

## Consequences

`EDITION_TIERS` (`helpers/clear-string.ts`) não cobre toda palavra que pode sinalizar "produto separado" no catálogo (ex.: "Remastered", "Anniversary", "Enhanced Edition") — só desempata corretamente o Skyrim porque "special" já existia na lista por outro motivo. Um jogo-exceção com uma palavra de edição fora dessa lista cai no fallback "primeiro candidato" (arbitrário, ordem de relevância do AllKeyShop). Ver `docs/IMPROVEMENTS.md`.
