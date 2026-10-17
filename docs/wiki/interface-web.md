# Interface Web do Price Researcher

## O que é

Um usuário acessa a interface web do próprio price-researcher (a página inicial do serviço), preenche os dados de uma pesquisa e envia. É o único processo em que a lista de jogos vem digitada por uma pessoa, em vez de ser raspada de uma Lista do SteamTrades.

Quando o token interno é informado, o envio é **assíncrono**: a tela confirma o recebimento na hora e o processamento continua em segundo plano. Cada jogo passa por uma consulta de popularidade no SteamCharts e uma busca de preço no AllKeyShop, um de cada vez — para listas grandes isso leva vários minutos até a Trade aparecer no Sistema Estoque. O usuário não precisa deixar a página aberta esperando.

## O que o usuário informa

| Campo | Obrigatório | Para que serve |
|---|---|---|
| Lista de jogos | Sim | Um nome de jogo por linha — é o que será pesquisado |
| Preset | Não (só aparece com token) | Atalho: preenche os campos abaixo com os valores de um caso de uso (padrão, bundle, Reabastecimento, Descoberta). Os campos continuam editáveis |
| Popularidade mínima até o limite / acima do limite | Não (vem preenchida) | Corte de jogadores simultâneos por faixa de preço: jogo barato precisa de menos jogadores que jogo caro |
| Limite de preço | Não (vem preenchido) | Valor em euro que separa as duas faixas. Um jogo exatamente no limite usa a faixa de baixo |
| Preço mínimo | Não (vem preenchido) | O melhor preço precisa ser maior que este valor |
| Token interno | Só para criar Trade | Autoriza o price-researcher a criar a Trade no Sistema Estoque. Sem ele, roda em modo demonstração |
| Oferta na Gamivo | Não | Se marcado, só traz jogos que têm oferta ativa na Gamivo — ou seja, jogos que conseguimos revender |
| Steam ID do fornecedor | Não | Vincula a Trade criada ao Fornecedor correspondente no Sistema Estoque |
| Código da lista | Não | Vincula a Trade à Lista do SteamTrades de onde os jogos vieram |
| Título | Não | Nome da Trade que será criada, para identificação no Sistema Estoque |

## Passo a passo

| Situação | O que acontece |
|---|---|
| Token interno informado | A tela confirma o recebimento na hora e libera o usuário; o processamento roda em segundo plano e a Trade é criada no Sistema Estoque ao final. Os campos de Steam ID e Título são limpos para a próxima lista |
| Sem token (modo demonstração) | Processa só os 10 primeiros jogos e mostra o resultado na própria tela — nada é enviado ao Sistema Estoque. Aqui a tela fica aguardando, porque o resultado é exibido nela |
| Lista de jogos vazia | Erro, pede para preencher antes de enviar |
| Falha durante o processamento em segundo plano | O usuário não é avisado — a Trade simplesmente não aparece no Sistema Estoque. O erro fica registrado apenas nos logs do servidor |

## Parâmetros que dá pra ajustar

| Parâmetro | Valor atual | O que controla | Se aumentar | Se diminuir |
|---|---|---|---|---|
| Popularidade mínima por faixa de preço | Padrão 30 até 5 € e 100 acima, editável a cada pesquisa | Abaixo do mínimo da faixa do preço, o jogo é descartado. Quem não alcança nem o menor dos dois é descartado antes da busca de preço | Traz menos jogos, com menos chance de vender | Traz mais jogos, mas mais difíceis de vender, e mais jogos na busca de preço, que é a etapa lenta |
| Preço mínimo negociável | Padrão 0,50 €, editável a cada pesquisa | Jogos cujo melhor preço não passa disso são descartados depois da busca de preço | Descarta mais jogos, focando só nos que dão lucro relevante | Traz jogos mais baratos, cujo lucro por unidade é de centavos |
| Limite de jogos no modo demonstração | 10 | Quantos jogos são processados quando não há token interno | Demonstração mais completa, porém mais demorada | Resposta mais rápida na demonstração |
| Exigir oferta ativa na Gamivo | Escolhido pelo usuário (marcado no preset padrão) | Se marcado, só considera jogos com oferta na Gamivo | Menos jogos no resultado, todos revendáveis pela Gamivo | Mais jogos no resultado, usando qualquer oferta do AllKeyShop |
