# price-cd é stateless — persistência e decisões de negócio pertencem ao Sistema Estoque

O price-cd nunca teve banco de dados próprio e não deve ganhar um. Seu papel é scraping e manipulação de HTML/browser — buscar preço e popularidade de jogos, extrair tópicos do SteamTrades, bump topics. Qualquer dado que precise sobreviver entre execuções (histórico de fornecedores contatados, se os jogos mudaram desde o último contato, decisão de comentar ou não em um tópico) é responsabilidade do Sistema Estoque, consultado via portas como `ProfitabilityChecker`.

## Consequences

Novas features que dependam de estado entre execuções (ex.: lembrar que um tópico já foi processado) devem consultar o Sistema Estoque via porta de aplicação — não introduzir armazenamento local (arquivo, SQLite, cache em disco) no price-cd.
