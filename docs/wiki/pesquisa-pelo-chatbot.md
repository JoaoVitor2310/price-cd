# Pesquisa pedida pelo chatbot

## O que é

Um Fornecedor manda uma lista de jogos pelo chat da Steam, ou o link do próprio tópico no SteamTrades, e escolhe em que moeda quer receber (TF2 Key, euro ou dólar). O chatbot repassa o pedido ao price-cd, que pesquisa os jogos e pede ao Sistema Estoque que crie a Trade **já com a oferta**. Quem decide quanto oferecer é o Sistema Estoque, não o price-cd.

Ao terminar, o price-cd **avisa o chatbot** do resultado, para ele mostrar a oferta ao Fornecedor. O pedido é confirmado na hora e a pesquisa roda em segundo plano: leva alguns minutos.

## O que o chatbot manda

| Dado | Para que serve |
|---|---|
| Lista de jogos **ou** link do tópico | A lista vem como o Fornecedor escreveu, com a região no fim quando houver (`Rust ROW`). Com o link, o price-cd lê a seção de jogos oferecidos do tópico inteira, sem limite de jogos, e guarda o código do tópico na Trade |
| Steam ID do Fornecedor | A oferta é feita a alguém: o Sistema Estoque exige saber a quem |
| Moeda escolhida | Em que moeda a oferta é calculada |
| Identificador do pedido | Gerado pelo chatbot; volta no aviso, para ele saber de qual pedido é |
| Endereço do aviso | Para onde o price-cd manda o resultado |
| Token do chatbot | Prova que o pedido veio do chatbot. É só dele, diferente do usado pela interface web e pelo Sistema Estoque: dá para cortar o acesso do chatbot sem mexer nos outros |

Os critérios de pesquisa são os do preset padrão; com o link, os do Reabastecimento, que hoje são iguais. O price-cd não confere de quem é o tópico, pesquisa mesmo se ele estiver fechado (foi o Fornecedor quem mandou o link), e só lê jogos de Steam: seções de outras lojas, como GOG, ficam de fora.

## O resultado

| Resultado | Quando |
|---|---|
| Trade criada | O Sistema Estoque criou a Trade com a oferta. O aviso leva o identificador dela |
| Sem Trade | Nenhum jogo passou nos filtros (pouco popular, barato demais ou sem preço), o Sistema Estoque não viu nada a ofertar, ou o tópico do link não mostra jogos |
| Falhou | Não deu para ler o tópico do link, a pesquisa não terminou, nenhum jogo passou e algum deles não pôde ser pesquisado, ou o Sistema Estoque não pôde criar a Trade naquela hora |

Se só alguns jogos não puderem ser pesquisados, a Trade é criada com os que deram certo.

O aviso só sai **depois** de o Sistema Estoque responder: quando chega "Trade criada", a Trade já existe. Ele nunca leva preço de mercado, popularidade ou margem.

## Garantias

| Situação | O que acontece |
|---|---|
| O price-cd reinicia ou é atualizado no meio da pesquisa | O pedido não se perde: volta para a fila e roda de novo quando o serviço sobe, aproveitando os preços já buscados na última hora |
| O chatbot está fora do ar quando o resultado fica pronto | O price-cd tenta de novo por cerca de 24 horas: a primeira nova tentativa depois de 30 segundos, e o intervalo dobra até 1 hora |
| O chatbot manda o mesmo pedido de novo | Se ainda está rodando, nada muda. Se já terminou, o mesmo resultado é avisado de novo, sem pesquisar outra vez. Se tinha falhado, a pesquisa roda de novo |
| Alguém tenta se passar pelo price-cd | O aviso vai assinado com um segredo que só o price-cd e o chatbot conhecem, e que nunca viaja na mensagem; o chatbot confere a assinatura |
| Alguém manda um endereço de aviso qualquer | Recusado: o price-cd só avisa endereços de uma lista configurada no servidor |

## Parâmetros que dá pra ajustar

| Parâmetro | Valor atual | O que controla |
|---|---|---|
| Endereços permitidos para o aviso | Configurado no servidor (vazio = nenhum) | Quem pode receber o resultado |
| Tempo tentando avisar | ~24 horas | Depois disso o price-cd desiste e registra a falha; o chatbot tem um alarme próprio de 6 horas |
