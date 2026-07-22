# Price Researcher

Serviço que pesquisa popularidade e preço de jogos para revendedores, e identifica fornecedores potenciais no SteamTrades para o CarcaDeals.

## Language

### Moeda de troca

**Key**:
License key de jogo na Steam — o produto que o CarcaDeals compra de fornecedores e revende ao consumidor final.
_Avoid_: TF2 Key (conceito de moeda de troca, não produto — ver abaixo)

**TF2 Key**:
Mann Co. Supply Crate Key, o item virtual do Team Fortress 2 usado como moeda de troca líquida na comunidade do SteamTrades. É a forma de pagamento que o CarcaDeals oferece aos fornecedores em troca dos jogos ofertados — não tem relação com license keys.
_Avoid_: Key (sem qualificador — sempre especificar "TF2 Key")

### Ciclo de vida do fornecedor

**Fornecedor**:
Dono de uma Lista no SteamTrades que oferece jogos — é fornecedor independente de já estar adicionado como contato (`is_added`) ou já ter negociado com o CarcaDeals (`has_traded`, rastreado no Sistema Estoque; ainda não consumido pelo price-cd). Os critérios de elegibilidade (Lista ativa, jogos com preço encontrado, disposto a receber TF2 Keys) determinam se ele qualifica para receber uma oferta de compra — não se ele é ou não um Fornecedor.
_Avoid_: Supplier, Trader

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
