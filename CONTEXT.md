# Price Researcher

Serviço que pesquisa popularidade e preço de jogos para revendedores, e identifica fornecedores potenciais no SteamTrades para o CarcaDeals.

## Language

### Moeda de troca

**Key**:
License key de jogo na Steam — o produto que o CarcaDeals compra de fornecedores e revende ao consumidor final.
_Avoid_: TF2 Key (conceito de moeda de troca, não produto — ver abaixo)

**TF2 Key**:
Mann Co. Supply Crate Key, o item virtual do Team Fortress 2 usado como moeda de troca líquida na comunidade do SteamTrades. É a Moeda de oferta preferida do CarcaDeals aos fornecedores em troca dos jogos ofertados — não tem relação com license keys.
_Avoid_: Key (sem qualificador — sempre especificar "TF2 Key")

**Plataforma**:
A loja que resgata a key — Steam, GOG, Epic, etc. O CarcaDeals compra e revende apenas keys da Steam: é a única plataforma que o price-cd sabe precificar, porque o AllKeyShop trata key de outra loja como produto separado. Fornecedores que misturam plataformas declaram isso na Lista com um cabeçalho (`GOG:`) acima dos jogos daquela loja; essas seções são descartadas antes da pesquisa de preço.
_Avoid_: Loja, Store

### Ciclo de vida do fornecedor

**Fornecedor**:
Dono de uma Lista no SteamTrades que oferece jogos — é fornecedor independente de já estar adicionado como contato (`is_added`) ou já ter negociado com o CarcaDeals (`has_traded`, rastreado no Sistema Estoque; ainda não consumido pelo price-cd). Os critérios de elegibilidade (Lista ativa, jogos com preço encontrado, aceitar alguma Moeda de oferta) determinam se ele qualifica para receber uma oferta de compra — não se ele é ou não um Fornecedor.
_Avoid_: Supplier, Trader

**Moeda de oferta**:
A moeda em que o CarcaDeals propõe pagar o Fornecedor por uma Lista: TF2 Key, euro ou dólar. Sai do que a Lista aceita no `.want`, não de configuração — o mesmo Fornecedor pode receber TF2 Keys numa Lista e euros em outra. Precedência quando a Lista aceita mais de uma: **TF2 Key**, depois **dólar**, depois **euro** (dólar vence euro porque quem cita dólar pensa em dólar). PayPal não é moeda: é meio de pagamento em euro, então cai em euro. Quem calcula e converte o valor é o Sistema Estoque; o price-cd só o repassa ao comentário (ver `docs/adr/0001`).
_Avoid_: Moeda de pagamento, Meio de pagamento (PayPal é meio de pagamento, não moeda)

**Lista**:
A relação de jogos/keys que um Fornecedor está oferecendo em `.have` num tópico do SteamTrades. É o que o price-cd raspa para descobrir novos Fornecedores e para reabastecer os já conhecidos. Termo canônico atual — o código ainda usa nomes antigos ("trade", "topic") para o mesmo conceito em partes diferentes do `suppliers`.
_Avoid_: Trade (nome antigo — hoje reservado para o registro no Sistema Estoque, ver abaixo), Topic

**Trade**:
Proposta de negociação persistida no Sistema Estoque — relaciona as keys que o Fornecedor tem com os valores ofertados. Nasce de duas formas: via `GameTradeImporter` (Reabastecimento e Pesquisa Manual, quando o price-cd já tem jogos precificados prontos) ou como efeito colateral do `ProfitabilityChecker.evaluate()` (Descoberta de Fornecedores — o Sistema Estoque cria a Trade ali mesmo, ao decidir `should_comment`). Fica editável manualmente (preço ofertado, keys recebidas) até se concretizar; quando concretiza, o Sistema Estoque efetivamente coloca as keys no estoque.
_Avoid_: usar para a listagem do SteamTrades — isso é Lista

**Criar Trade**:
Ação do price-cd de enviar jogos precificados ao Sistema Estoque (via `GameTradeImporter`), dando origem a uma Trade nova em estado de proposta. Usado no Reabastecimento e na Pesquisa Manual — na Descoberta de Fornecedores, quem cria a Trade é o próprio Sistema Estoque dentro do `evaluate()`, não o price-cd.
_Avoid_: Importar (verbo reservado para a ação do Sistema Estoque, ver abaixo)

**Importar**:
Ação do Sistema Estoque de finalizar uma Trade concretizada, colocando as keys recebidas no Estoque de fato. Ação interna do Sistema Estoque — o price-cd não participa dela, apesar do método `GameTradeImporter.import()` usar esse verbo (nomenclatura a corrigir, ver `docs/IMPROVEMENTS.md`).
_Avoid_: usar para o envio de jogos precificados pelo price-cd — isso é "Criar Trade"

### Catálogo de jogos (AllKeyShop)

**Edição**:
Variação de preço dentro do MESMO produto no AllKeyShop (Standard, Deluxe, Bundle, Dayone, etc.). Nunca aparece como um resultado de busca separado — a busca sempre ignora edição, e a edição pedida só é resolvida depois de já se estar no jogo certo. Ver `docs/adr/0003-edicao-resolvida-na-pagina-nao-na-busca.md`.
_Avoid_: usar para um remaster/relançamento com produto próprio — isso é Versão

**Versão**:
Relançamento de um jogo que o AllKeyShop trata como PRODUTO separado no catálogo — resultado de busca próprio — mesmo compartilhando o nome-base com o jogo original (ex.: "Skyrim" 2011 vs "Skyrim Special Edition" 2021). A palavra de edição só entra pra desempatar entre Versões candidatas com o mesmo nome-base, nunca para filtrar Edições.
_Avoid_: Edição (reservado para variação de preço dentro do mesmo produto, ver acima), Remaster

**Preço de mercado**:
O melhor preço de um jogo no AllKeyShop, em euros — o que a key vale para revenda. Chama-se `market_price_euro` em todo lugar — no contrato com o Sistema Estoque e na resposta demo da interface web (antes `price_euro`, renomeado porque se confundia com o valor ofertado ao fornecedor). **Não é a oferta**: a oferta é a Moeda de oferta (`offer_price`), calculada pelo Sistema Estoque. O Fornecedor nunca vê o Preço de mercado.
_Avoid_: Preço, `price_euro` (nome antigo do campo), usar para o valor que se propõe ao Fornecedor

### Preço mínimo negociável

Piso de valor abaixo do qual não vale a pena negociar um jogo: mesmo com popularidade suficiente e oferta encontrada, o lucro por unidade seria de poucos centavos e não paga o tempo da negociação com o Fornecedor. O piso **default** é 0,50 € e o corte é estrito — um jogo exatamente em 0,50 € é descartado. Aplicado depois da busca de preço, sobre o melhor preço encontrado. O default vale para a busca, o Reabastecimento e a Descoberta de Fornecedores; a Pesquisa (endpoint `research`) pode sobrescrever o piso por requisição via `minPrice` — a de bundle manda `0` porque quer os jogos independente de preço.
_Avoid_: usar para o corte de Popularidade mínima, que é anterior e olha jogadores simultâneos, não preço
