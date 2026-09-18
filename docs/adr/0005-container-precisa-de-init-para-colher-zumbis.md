# O container roda com `init: true` — o Node nunca deve ser o PID 1

O `docker/start.sh` termina em `exec node dist/server.js`, o que faz do Node o PID 1 do container. O Node **não é um init**: o libuv só dá `waitpid` nos filhos que ele mesmo criou via `child_process`. Qualquer processo reparentado para o PID 1 — e o Chromium produz muitos, porque `cleanupBrowser` mata a árvore de baixo para cima e os netos perdem o pai antes de morrer — fica em estado `Z` para sempre.

Zumbi não gasta memória, mas ocupa um slot da tabela de processos e conta para o `pids_limit`. A falha é lenta e silenciosa: acumula ~10-20 PIDs por sessão de browser até o teto, e só então o container para de funcionar — de uma vez, para tudo.

**Decisão:** `init: true` nos dois serviços do `docker-compose.yml`. O Docker injeta um init mínimo como PID 1, que colhe qualquer órfão; o Node passa a ser um filho comum.

## Por que não as alternativas

- **Subir o `pids_limit`** apenas adia a falha e desfaz a rede de segurança criada depois do OOM de 2026-08-24.
- **Reaproveitar o `cleanupBrowser` para colher os mortos** confunde dois papéis diferentes: derrubar a árvore (do app) e colher quem morreu (do init). O app não tem como colher um processo que não é filho dele.
- **Tirar o `exec` do `start.sh`** deixaria o bash como PID 1, mas o bash só colhe órfãos em modo interativo e a entrega de sinais ao Node passaria a depender de um trap manual.

## Incidente que originou a decisão

2026-09-18, produção: `511/512` PIDs em uso com memória em 1,03 GB de 2 GB. Todo `fork()` dentro do container passou a falhar com `Cannot fork`, incluindo `docker exec`. O erro visível foi na abertura do browser para o AllKeyShop — `chrome-launcher` varre `/usr/share/applications` com `execSync("grep … | awk …")` a cada launch (o `linux()` faz isso mesmo com `CHROME_PATH` definido), então ele é o primeiro a quebrar quando não há mais PIDs. O stack apontava para o `chrome-launcher`; a causa estava três camadas abaixo.

## Consequences

- O `cleanupBrowser` (`src/lib/puppeteer-browser.ts`) **continua obrigatório** — o init colhe processos mortos, não encerra processos vivos. Os dois mecanismos são complementares e nenhum substitui o outro.
- `test/unit/infrastructure/docker-compose.test.ts` falha se `init`, `pids_limit` ou `mem_limit` sumirem de qualquer serviço.
- Qualquer novo container do projeto que rode Chromium nasce com `init: true`.
- Sintoma a reconhecer no futuro: `Cannot fork` / `EAGAIN` em qualquer ponto do código é esgotamento de PIDs, não um bug da lib que aparece no stack.
