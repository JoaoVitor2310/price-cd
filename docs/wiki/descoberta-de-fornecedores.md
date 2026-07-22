# Descoberta de Fornecedores

## O que é

Varre as páginas públicas de anúncios do SteamTrades procurando pessoas dispostas a trocar jogos por TF2 Keys. Quando acha alguém que parece valer a pena, manda os dados pro Sistema Estoque decidir se vale comentar no anúncio propondo negociação — seja o dono do anúncio alguém novo ou um Fornecedor que já conhecemos. Hoje ainda comentamos direto no SteamTrades do mesmo jeito nos dois casos, mesmo quando já temos o Fornecedor adicionado.

## Quando roda

| Gatilho | Frequência |
|---|---|
| Manual | A qualquer momento, sob comando |

## Passo a passo

| Situação | O que acontece |
|---|---|
| Anúncio ativo, aceita TF2 Keys, tem jogos com preço, Sistema Estoque aprova | O Sistema Estoque cria a Trade e comentamos no anúncio propondo negociação |
| Anúncio ativo, aceita TF2 Keys, mas Sistema Estoque não aprova dessa vez | Não comentamos, nenhuma Trade é criada |
| Anúncio não aceita TF2 Keys | Pulamos, sem gastar tempo pesquisando preço |
| Anúncio inativo/fechado | Pulamos |
| 5 anúncios inativos seguidos | Paramos de virar página — sinal de que chegamos ao fim da lista de anúncios recentes |

## Parâmetros que dá pra ajustar

| Parâmetro | Valor atual | O que controla | Se aumentar | Se diminuir |
|---|---|---|---|---|
| Popularidade mínima | 30 jogadores simultâneos (fixo no código) | Abaixo disso, o jogo é ignorado mesmo que o preço seja bom | Traz menos jogos, com menos chance de vender | Traz mais jogos, mas mais difíceis de vender (menos populares) |
| Quantas páginas varrer por execução | até 100 | Até onde a varredura vai antes de desistir | Encontra fornecedores mais "antigos" na lista, mas demora mais | Mais rápido, mas pode não escanear a lista toda |
| Quantos anúncios inativos seguidos até parar | 5 | Quando parar de virar página assumindo que acabaram os anúncios recentes | Mais tolerante a "buracos" na lista, mas demora mais | Para mais cedo — risco de não ver anúncios recentes que vieram depois de um lote inativo |
| Quantos jogos analisar por fornecedor | até 50 | Fornecedores com listas gigantes só têm os 50 primeiros jogos pesquisados | Cobre listas maiores, mas demora mais por fornecedor | Mais rápido, mas ignora o resto da lista de fornecedores com muitos jogos |
| Exige aceitar TF2 Keys | Sempre sim | Só seguimos com fornecedores que topem TF2 Keys como pagamento — mesmo que aceitem outras formas de pagamento junto | — | — |
| Exige oferta ativa na Gamivo | Sempre sim, fixo no código | Só considera jogos que têm oferta especificamente na Gamivo, não qualquer preço do AllKeyShop | — | — |

## O que NÃO fazemos nesse processo

O price-cd não cria a Trade diretamente aqui — quem cria é o Sistema Estoque, como parte da própria decisão de aprovar a negociação. O price-cd só posta o comentário depois que essa aprovação vem.
