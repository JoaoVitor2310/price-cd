# Descoberta de Fornecedores

## O que é

Varre as páginas públicas de anúncios do SteamTrades — já filtradas na origem pelo próprio SteamTrades (`have=<termo>`, o que a CarcaDeals oferece) para trazer só quem pede TF2 Keys — procurando pessoas dispostas a trocar jogos por TF2 Keys. A busca do site é por substring exata, então rodamos ela duas vezes (uma por variação de texto: "TF2" e "Team Fortress 2" — essa segunda casa tanto quem escreveu só "Team Fortress 2" quanto quem escreveu "Team Fortress 2 Key"), já que um fornecedor que só escreveu por extenso não aparece numa busca pela sigla. Cada variação reduz bastante o total de páginas em relação a varrer tudo sem filtro. Quando acha alguém que parece valer a pena, manda os dados pro Sistema Estoque decidir se vale comentar no anúncio propondo negociação — seja o dono do anúncio alguém novo ou um Fornecedor que já conhecemos. Hoje ainda comentamos direto no SteamTrades do mesmo jeito nos dois casos, mesmo quando já temos o Fornecedor adicionado.

**TF2 Keys é a única moeda que aceitamos hoje** — a busca, o filtro de aceitação e o cálculo de preço downstream (via Sistema Estoque) assumem isso. Não há suporte para outra moeda ainda, mas é algo que pretendemos mudar no futuro.

A varredura roda em duas etapas: primeiro passa por todas as páginas (de cada variação de busca) coletando só o identificador e o link de cada anúncio (rápido), deduplicando os que se repetem, e só depois abre cada anúncio único pra processar de fato. Isso existe porque um usuário pode reordenar ("bumpar") sua lista no meio da varredura — se ela pular de uma página ainda não visitada para uma já visitada, coletar tudo primeiro reduz bastante a chance de perdê-la nessa execução (não elimina 100%, mas encolhe a janela de risco).

Nessa primeira etapa (coleta), o SteamTrades continua devolvendo anúncios além da última página "de verdade" — só que marcados como fechados (cadeado visível já na listagem, sem precisar abrir nada). Por isso paramos de virar página pra um termo de busca assim que aparecem vários fechados seguidos, em vez de andar até o teto de segurança à toa.

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
| Anúncio fechado (cadeado visível já na página de listagem) | Nem coletamos — nunca chega a ser aberto |
| Anúncio inativo (só se sabe depois de abrir o anúncio) | Pulamos |
| 5 anúncios fechados seguidos numa mesma busca (na listagem) | Paramos de virar página pra aquele termo — sinal de que passamos da última página com anúncios de verdade |
| 5 anúncios inativos seguidos (entre os já coletados) | Paramos de processar o restante — sinal de que chegamos na cauda de anúncios antigos |
| Uma página não retorna nenhum anúncio | Paramos de virar página — sinal de que chegamos ao fim da lista |

## Parâmetros que dá pra ajustar

| Parâmetro | Valor atual | O que controla | Se aumentar | Se diminuir |
|---|---|---|---|---|
| Popularidade mínima | 30 jogadores simultâneos (fixo no código) | Abaixo disso, o jogo é ignorado mesmo que o preço seja bom | Traz menos jogos, com menos chance de vender | Traz mais jogos, mas mais difíceis de vender (menos populares) |
| Quantas páginas varrer por execução | teto de segurança em 100 por variação de busca, mas o corte de anúncios fechados (ver abaixo) já limita a busca a uma fração disso na prática | Até onde a varredura vai antes de desistir, caso a listagem filtrada cresça muito | Encontra fornecedores mais "antigos" na lista, mas demora mais | Mais rápido, mas pode não escanear a lista toda |
| Quantos anúncios fechados seguidos até parar de paginar | 5 | Quando parar de virar página pra um termo de busca, assumindo que passamos da última página com anúncios de verdade | Mais tolerante a "buracos" de fechados isolados no meio da listagem, mas demora mais | Para mais cedo — risco de nunca coletar anúncios recentes que vieram depois de um lote fechado |
| Quantos anúncios inativos seguidos até parar de processar | 5 | Quando parar de processar os anúncios já coletados, assumindo que o resto também é antigo | Mais tolerante a "buracos" na lista, mas demora mais | Para mais cedo — risco de não processar anúncios recentes que vieram depois de um lote inativo |
| Quantos jogos analisar por fornecedor | até 1000 | Fornecedores com listas gigantes só têm os 1000 primeiros jogos pesquisados | Cobre listas maiores, mas demora mais por fornecedor | Mais rápido, mas ignora o resto da lista de fornecedores com muitos jogos |
| Exige aceitar TF2 Keys | Sempre sim | Só seguimos com fornecedores que topem TF2 Keys como pagamento — mesmo que aceitem outras formas de pagamento junto | — | — |
| Exige oferta ativa na Gamivo | Sempre sim, fixo no código | Só considera jogos que têm oferta especificamente na Gamivo, não qualquer preço do AllKeyShop | — | — |

## O que NÃO fazemos nesse processo

O price-cd não cria a Trade diretamente aqui — quem cria é o Sistema Estoque, como parte da própria decisão de aprovar a negociação. O price-cd só posta o comentário depois que essa aprovação vem.
