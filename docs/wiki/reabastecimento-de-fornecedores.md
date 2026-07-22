# Reabastecimento de Fornecedores

## O que é

Pra fornecedores que a gente já conhece (já temos o Steam ID guardado), buscamos as Listas ativas dele de novo, pra ver se tem jogo novo pra comprar. Diferente da Descoberta, aqui já confiamos no fornecedor — não checamos de novo se ele aceita TF2 Keys, nem mandamos pro Sistema Estoque perguntar se vale comentar. Achou jogo com preço bom, já cria a Trade direto.

## Quando roda

| Gatilho | Frequência |
|---|---|
| Sob comando — quem aciona decide quando pedir um reabastecimento de um fornecedor específico | Não é automático nesse sentido; depende de quem chama |

## Passo a passo

| Situação | O que acontece |
|---|---|
| Fornecedor tem Listas ativas com jogos novos e com preço bom | Cria a Trade automaticamente no Sistema Estoque |
| Fornecedor tem Listas ativas mas sem jogos com preço encontrado | Não cria nada, sem erro |
| Alguma das Listas do fornecedor está inativa | Pula só essa Lista, continua nas outras |

## Parâmetros que dá pra ajustar

| Parâmetro | Valor atual | O que controla | Se aumentar | Se diminuir |
|---|---|---|---|---|
| Popularidade mínima | 30 jogadores simultâneos (fixo no código) | Mesmo corte da Descoberta — abaixo disso, ignora o jogo | Traz menos jogos, com menos chance de vender | Traz mais jogos, mas mais difíceis de vender (menos populares) |
| Quantas Listas do fornecedor revisar | até 3 | Fornecedores com muitos anúncios ativos só têm os 3 primeiros revisados | Não faz diferença — o SteamTrades limita cada fornecedor a no máximo 3 anúncios ativos, então 3 já cobre o total possível | Mais rápido, mas pode deixar de revisar algum anúncio ativo do fornecedor |
| Quantos reabastecimentos rodam ao mesmo tempo | 1 por vez | Evita sobrecarregar o SteamTrades com buscas simultâneas | Processa mais fornecedores em paralelo, com risco maior de bloqueio temporário no SteamTrades | Mais lento, mais seguro |
| Exigir oferta ativa na Gamivo | Sim por padrão — mas pode ser desligado explicitamente por quem aciona | Se ligado, só considera jogos com oferta especificamente na Gamivo | Menos jogos qualificam, mas todos com uma fonte de preço conhecida | Mais jogos qualificam, usando qualquer oferta do AllKeyShop |
