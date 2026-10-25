# Wiki do Price Researcher

Visão de alto nível de como o price-cd funciona — pra entender o que roda, quando roda, e quais parâmetros existem, sem precisar ler código.

## O que o price-cd faz, em uma frase

Ele encontra jogos baratos e populares em anúncios de troca no SteamTrades, decide quais valem a pena comprar, e manda essas oportunidades pro Sistema Estoque como propostas de negociação (Trades). Hoje as buscas rodam sob comando; só o Bump de Tópicos roda sozinho.

## Os 4 processos

| Processo | O que faz | Quando roda | Cria Trade automaticamente? |
|---|---|---|---|
| [Descoberta de Fornecedores](descoberta-de-fornecedores.md) | Varre o SteamTrades procurando quem está disposto a trocar jogos por TF2 Keys, PayPal, euro ou dólar, novo ou já conhecido | Sob comando manual | Sim — o Sistema Estoque cria a Trade como parte da própria decisão de aprovar |
| [Reabastecimento de Fornecedores](reabastecimento-de-fornecedores.md) | Revisita fornecedores já conhecidos pra ver se têm jogos novos | Sob comando — quem aciona decide quando | Sim, automaticamente |
| [Interface Web do Price Researcher](interface-web.md) | Um usuário envia uma lista de jogos pela página do próprio price-researcher | Sob demanda, pela interface web | Só se o token interno for informado |
| [Bump de Tópicos](bump-de-topicos.md) | Mantém os anúncios do próprio CarcaDeals visíveis no topo do SteamTrades | A cada 5 minutos (automático) | Não se aplica |

## Preço guardado por 1 hora

Vale para todos os processos que buscam preço. O preço que o price-cd encontra no AllKeyShop fica guardado por **1 hora**. Se o mesmo jogo aparecer de novo nesse intervalo, em qualquer processo, o preço guardado é usado em vez de buscar no AllKeyShop outra vez. A busca no AllKeyShop é a parte lenta, porque passa pelas proteções anti-robô do site. Um jogo que aparece em várias Listas passa a ser buscado uma vez só.

O que isso significa na prática:

- **Um preço pode ter até 1 hora de idade.** A Sincronização de bundles, que roda de hora em hora, pode ler o preço gravado pela rodada anterior: na prática, o preço de um bundle pode ficar até cerca de 2 horas sem atualizar.
- **"Não está no AllKeyShop" também fica guardado por 1 hora.** Um jogo que acabou de entrar no catálogo pode levar até 1 hora para aparecer.
- **Falha não fica guardada.** Se a busca de um jogo falhou (site fora do ar, bloqueio anti-robô), a próxima tentativa busca de novo.
- **A popularidade do SteamCharts não fica guardada.** Ela é consultada sempre, porque é rápida.
- **A exigência de oferta na Gamivo continua sendo de cada processo.** O que fica guardado é o melhor preço e se havia oferta na Gamivo. Um processo que exige Gamivo e outro que não exige leem o mesmo preço guardado, e cada um aplica a própria regra.
- **Se o armazenamento do preço guardado cair, nada para.** As buscas voltam a ser feitas no AllKeyShop, mais lentas, até ele voltar.

Para forçar preços novos na hora (por exemplo, depois de corrigir a busca), alguém com acesso ao servidor limpa o cache. O comando está no `README.md` da raiz.

## Termos usados nessa wiki

- **Fornecedor** — pessoa no SteamTrades disposta a trocar jogos por TF2 Keys, PayPal, euro ou dólar. Não precisa já ter negociado com a gente antes pra ser chamada assim.
- **Lista** — o anúncio do Fornecedor no SteamTrades: os jogos que ele tem, e o que ele aceita em troca.
- **TF2 Key** — a moeda preferida pra pagar os fornecedores. Não tem relação com license key de jogo.
- **Moeda de oferta** — a moeda em que propomos pagar um fornecedor por uma Lista: TF2 Key, dólar ou euro, conforme o que ele aceita (PayPal conta como euro).
- **Trade** — a proposta de negociação registrada no Sistema Estoque depois de achar uma oportunidade boa. Fica lá até alguém do time fechar a negociação de verdade e as keys entrarem no estoque.

Definições completas (incluindo as usadas só internamente no código) ficam em [`../../CONTEXT.md`](../../CONTEXT.md).
