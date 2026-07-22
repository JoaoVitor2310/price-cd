# Lista de fornecedor tem duas representações — TopicData (descoberta) e ListTopic (reabastecimento)

A mesma Lista do SteamTrades é modelada por dois tipos diferentes — `TopicData` (`application/suppliers`, nome a padronizar para "List" — ver `docs/IMPROVEMENTS.md`) e `ListTopic` (`domain/lists`) — não por duplicação acidental, mas porque cada um serve um estágio diferente do relacionamento com o Fornecedor. `TopicData` é usado quando o `steamId` do dono ainda é desconhecido (fluxo de descoberta via `FindNewSuppliersUseCase`): precisa extrair `authorName`/`steamId` do HTML, checar `wantsTf2Key`, e consultar `should_comment` no Sistema Estoque. `ListTopic` é usado quando o `steam_id` já é conhecido de entrada (fluxo de reabastecimento via `RunListsUseCase`, chamado para um Fornecedor já rastreado): não precisa reextrair identidade nem reavaliar elegibilidade — só extrai os jogos ofertados e cria a Trade dos que têm preço encontrado.

## Consequences

Não unificar os dois tipos num só — cada porta deve carregar só os campos que seu próprio caso de uso precisa. Se um novo campo for necessário nos dois fluxos, avalie se ele pertence à extração (sempre) ou só à qualificação de um Fornecedor desconhecido (só em `TopicData`).
