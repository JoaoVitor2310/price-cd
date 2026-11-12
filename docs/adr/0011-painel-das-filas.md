# O painel das filas é o Bull Board, somente leitura, atrás de Basic Auth

Acompanhar as filas (ADR 0009 e 0010) era `redis-cli` no banco 1: saber se um pedido está esperando, rodando ou falhou, e por quê, exigia acesso ao Redis e conhecer as chaves da BullMQ. A falha de um Reabastecimento ou de uma Descoberta fica registrada no job por 30 dias, mas ninguém a via.

**Decisão:** o **Bull Board** (`@bull-board/api` + `@bull-board/express`) montado no próprio app em `/api/admin/queues`, mostrando as quatro filas do banco 1 (`research`, `webhooks`, `lists`, `suppliers`), todas em **somente leitura**, atrás de **HTTP Basic Auth** com usuário e senha do ambiente. Sem as credenciais, ou sem `QUEUE_REDIS_URL`, o painel não é montado e a rota responde 404.

## Por que o Bull Board

- **Taskforce.sh** (dos autores da BullMQ) é pago e manda os dados das filas para um terceiro. O payload dos jobs tem listas de jogos, Steam IDs de Fornecedores e critérios de pesquisa.
- **Uma tela própria** repetiria o que o Bull Board já faz (estados, payload, `failedReason`, stack trace) e teria de ser mantida.
- **Compatibilidade conferida antes de instalar:** `@bull-board/express` 9.13 depende de `express ^5.3` (o mesmo major do Nest 12) e `@bull-board/api` aceita `bullmq ^5.56`. O `@bull-board/nestjs` **não** entrou: exige `@nestjs/bull-shared`, do ecossistema `@nestjs/bullmq`, que o price-cd não usa (ADR 0009).

## Somente leitura, conferido no servidor

O painel tem botões de *retry*, *promote*, *clean*, *add*. Repetir um job de pesquisa ou de Reabastecimento que já chamou o Estoque cria outra Trade, pelo mesmo motivo do `attempts: 1` (ADR 0009). `readOnlyMode` em todas as filas, inclusive `webhooks`, onde repetir seria inofensivo (quem recebe é idempotente pelo `request_uuid`): uma regra só é mais fácil de conferir que uma exceção. O Bull Board aplica o modo no **servidor** — as rotas de escrita respondem 405 mesmo chamadas direto, não só somem da tela —, e um teste contra Redis real trava isso. Liberar escrita só depois da idempotência do Estoque (item 22 do `docs/IMPROVEMENTS.md`).

## Acesso

- **Basic Auth, não guard do Nest:** o Bull Board é um router Express montado com `app.use`, fora das rotas de controller, onde guard não age. Um usuário só (`QUEUE_DASHBOARD_USER` / `QUEUE_DASHBOARD_PASSWORD`): o painel é de quem opera o price-cd, não tem contas.
- **Comparação em tempo constante** (`crypto.timingSafeEqual` sobre o SHA-256 de cada lado), sempre usuário e senha, para o tempo da resposta não dizer o que errou.
- **Senha de no mínimo 16 caracteres**, e os dois juntos ou nenhum (o schema recusa a configuração pela metade): a rota é pública e o Basic Auth não limita tentativas. Depende de HTTPS na frente, como o resto do domínio.
- **Sob `/api`**, o prefixo das outras rotas, para passar pelo mesmo proxy.
- **Alternativa descartada:** só por túnel SSH à VPS. Mais fechado, mas quem opera precisaria de acesso à máquina para olhar uma fila.

## Conexão própria

O painel não pega os `Queue` dos adapters: abre **uma** conexão de leitura (`createBullmqReaderConnection`, fila offline desligada, como a do produtor) e um `Queue` por nome, compartilhando-a — `Queue` só faz comandos não bloqueantes. Assim ele não se acopla a como cada fila é montada, e só existe quando ligado. Os nomes das filas ficam num arquivo só (`queue-names.ts`): uma fila nova que não entrasse lá ficaria invisível no painel.

## Consequences

- Duas dependências novas (`@bull-board/api`, `@bull-board/express`) e duas variáveis (`QUEUE_DASHBOARD_USER`, `QUEUE_DASHBOARD_PASSWORD`), no `.env`. A imagem de dev precisa de rebuild (`node_modules` mora nela).
- Uma conexão Redis a mais, só com o painel ligado.
- O painel mostra "ativo há 4 minutos", não "jogo 37 de 120": o progresso por jogo ficou no backlog (item 10 do `docs/IMPROVEMENTS.md`).
