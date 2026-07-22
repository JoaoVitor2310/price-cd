# Wiki do Price Researcher

Visão de alto nível de como o price-cd funciona — pra entender o que roda, quando roda, e quais parâmetros existem, sem precisar ler código.

## O que o price-cd faz, em uma frase

Ele encontra jogos baratos e populares em anúncios de troca no SteamTrades, decide quais valem a pena comprar, e manda essas oportunidades pro Sistema Estoque como propostas de negociação (Trades). Hoje as buscas rodam sob comando; só o Bump de Tópicos roda sozinho.

## Os 4 processos

| Processo | O que faz | Quando roda | Cria Trade automaticamente? |
|---|---|---|---|
| [Descoberta de Fornecedores](descoberta-de-fornecedores.md) | Varre o SteamTrades procurando quem está disposto a trocar jogos por TF2 Keys, novo ou já conhecido | Sob comando manual | Sim — o Sistema Estoque cria a Trade como parte da própria decisão de aprovar |
| [Reabastecimento de Fornecedores](reabastecimento-de-fornecedores.md) | Revisita fornecedores já conhecidos pra ver se têm jogos novos | Sob comando — quem aciona decide quando | Sim, automaticamente |
| [Interface Web do Price Researcher](interface-web.md) | Um usuário envia uma lista de jogos pela página do próprio price-researcher | Sob demanda, pela interface web | Só se o token interno for informado |
| [Bump de Tópicos](bump-de-topicos.md) | Mantém os anúncios do próprio CarcaDeals visíveis no topo do SteamTrades | A cada 5 minutos (automático) | Não se aplica |

## Termos usados nessa wiki

- **Fornecedor** — pessoa no SteamTrades disposta a trocar jogos por TF2 Keys. Não precisa já ter negociado com a gente antes pra ser chamada assim.
- **Lista** — o anúncio do Fornecedor no SteamTrades: os jogos que ele tem, e o que ele aceita em troca.
- **TF2 Key** — a "moeda" que usamos pra pagar os fornecedores. Não tem relação com license key de jogo.
- **Trade** — a proposta de negociação registrada no Sistema Estoque depois de achar uma oportunidade boa. Fica lá até alguém do time fechar a negociação de verdade e as keys entrarem no estoque.

Definições completas (incluindo as usadas só internamente no código) ficam em [`../../CONTEXT.md`](../../CONTEXT.md).
