---
name: pr-open
description: Prepara e abre um PR do price-cd. Separa os arquivos que fazem parte da mudança, roda no Docker as mesmas verificações do CI (npm ci, build, test) e, como aviso, o Biome, o tsc dos testes e os testes de fila com Redis quando se aplicam, roda a pr-review e mostra o parecer. Com o sim do dono, escreve o título e a descrição do PR num arquivo em .pr/, lista as imagens de antes e depois quando a interface web muda, cria o branch sem rastrear a main, prepara o stage e entrega o comando de commit para o dono rodar. Depois do commit, faz o push, abre o PR (ou atualiza a descrição), ativa o auto-merge quando o check do CI é obrigatório na main, posta os comentários das imagens e apaga os rascunhos de .pr/. Nunca faz commit, nunca faz push na main e nunca ativa auto-merge em PR do Dependabot. Use quando o usuário pedir "prepara o PR", "vamos abrir o PR", "escreve a descrição do PR", "como divido os commits" ou invocar /pr-open.
---

# Abrir o PR: price-cd

Esta skill tem um objetivo: **abrir um PR que passa no CI e que a revisão não vai barrar.** Antes de abrir, ela responde se a mudança está pronta para ser publicada.

Lembre o custo do erro: **todo push na `main` vai para produção** (`deploy.yml` roda em cada push e o merge do PR também é um push). Não há staging.

Três regras valem para a skill toda:

- **O commit é do dono; o resto é da skill.** O `CLAUDE.md` só proíbe o commit (incluindo `--amend` e `commit-tree`): a skill entrega o comando de commit e espera. Branch, stage, push e o PR ficam com a skill. Ela só faz o push e abre o PR depois de o dono confirmar o título e a descrição que viu. Se algo mudar depois disso, ela mostra de novo.
- **A skill nunca empurra para a `main`.** O branch não rastreia `origin/main`, o push sempre nomeia o branch, e nunca há `--force`.
- **A skill não julga o código.** O julgamento é da `pr-review`. A skill não acrescenta, remove nem reclassifica achado. Mudar uma regra de revisão é editar a `pr-review` ou o documento de onde a regra vem.

## Passo 1. Delimitar a mudança

```bash
git fetch -q origin main
git rev-parse --abbrev-ref HEAD
git branch -vv --list "$(git rev-parse --abbrev-ref HEAD)"
git log --oneline origin/main..HEAD
git status --porcelain
gh pr view --json number,title,url,state 2>/dev/null
```

- **Abertura ou atualização:** se o branch já tem PR aberto, a skill prepara uma descrição nova para `gh pr edit`. Senão, prepara a abertura.
- **Branch:** se o trabalho está na `main`, proponha um nome no padrão do histórico (`feat/...`, `fix/...`, `refactor/...`, `docs/...`, `chore/...`, em inglês, kebab-case). A skill cria o branch no passo 5. Se o branch atual mostra `[origin/main]` no `git branch -vv`, pare e avise: um `git push` sem destino ali publica direto em produção. Corrija com `git branch --unset-upstream` antes de seguir.
- **Os arquivos:** monte a lista do PR a partir do diff contra `origin/main` e dos arquivos não rastreados. O working tree costuma ter coisas de outra frente: listas de jogos em `test/*.txt`, planos, `uploads/`, notas. Pergunte uma vez, numa lista só, sobre os arquivos em dúvida. Nunca presuma: arquivo a mais vai parar no histórico público, e arquivo a menos quebra o CI.
- **Rascunhos velhos em `.pr/`:** um arquivo de `.pr/` cujo branch já tem PR fechado ou mergeado (`gh pr list --head <branch> --state all --json state`) é sobra de uma execução anterior que falhou no fim. Apague sem perguntar e diga quais apagou. O rascunho de um branch sem PR, ou com PR aberto, fica.
- **O repositório é público.** Antes de tudo, confira que nenhum arquivo da lista tem segredo, token, `STEAMTRADES_SESSION`, chave da Gamivo, Steam ID real de Fornecedor, e-mail pessoal, dado de Fornecedor ou material de outra empresa. Se tiver, pare e mostre. O `.env` nunca entra.

## Passo 2. Rodar as verificações do CI

O CI (`.github/workflows/ci.yml`) tem um job só, com três passos obrigatórios: `npm ci`, `npm run build` (o `tsc` de `src/`, que o workflow chama de "Type check") e `npm test`. Rode os mesmos no Docker, nunca com o Node do host (o `node_modules` do host só existe para o editor). O dev container monta só `src/` e `public/`, então use um container descartável sobre o repositório, com as dependências de Linux num volume nomeado:

```bash
docker run --rm -e PUPPETEER_SKIP_DOWNLOAD=true -v "$PWD":/app -v price-cd-node-modules:/app/node_modules -w /app node:22-bookworm-slim sh -c "npm ci --no-audit --no-fund && npm run build && npm test"
```

Se o Docker Desktop estiver fechado, peça ao dono para abri-lo; não caia para o Node do host. Quando um passo falhar, mostre o trecho do erro e pergunte se corrige.

**Verificações que se aplicam conforme o diff.** Não são obrigatórias no CI; diga isso ao dono ao mostrar o resultado.

| Quando | O quê |
|---|---|
| O diff toca `src/infrastructure/background/`, `src/infrastructure/webhooks/`, `src/nest/queue-dashboard/` ou `test/integration/queue/` | Os testes de fila contra um Redis de verdade (o CI não tem Redis e os pula). Eles fazem `FLUSHDB` no banco da URL, por isso usam um Redis descartável, nunca o do dev |
| O diff toca `Dockerfile`, `docker/`, `docker-compose.yml`, `package.json` ou `package-lock.json` | `docker build -t price-cd:pr-check .`. O CI do PR não monta a imagem; quem monta é o deploy, já depois do merge |
| Sempre que houver `.ts` no diff | Biome e `tsc` dos testes, só nos arquivos do PR (abaixo) |

```bash
docker run -d --rm --name redis-queue-test redis:7.4-alpine
docker run --rm --network container:redis-queue-test -e PUPPETEER_SKIP_DOWNLOAD=true -e QUEUE_REDIS_TEST_URL=redis://127.0.0.1:6379/15 -v "$PWD":/app -v price-cd-node-modules:/app/node_modules -w /app node:22-bookworm-slim npx vitest run test/integration/queue
docker stop redis-queue-test
```

O Biome e o `tsc` dos testes já falham na `main` (dívida dos itens 14 e 15 do `IMPROVEMENTS.md`). Rode-os só sobre os arquivos do PR e mostre só o que cai em linha que o diff tocou; o resto é dívida antiga e não entra neste PR:

```bash
docker run --rm -v "$PWD":/app -v price-cd-node-modules:/app/node_modules -w /app node:22-bookworm-slim sh -c "npx biome check <arquivos do PR>; npx tsc --noEmit -p tsconfig.test.json | grep -F -e '<arquivo 1>' -e '<arquivo 2>'"
```

Nunca rode `npm run lint:fix` nem `biome check --write`: o `--unsafe` reescreve arquivos fora do PR, e a regra `useImportType` já quebrou a injeção do Nest uma vez (`CLAUDE.md`, "Tratamento de Erros"). Corrija à mão, só no arquivo do PR.

As verificações rodam sobre o working tree. Se ele tiver mudanças de outra frente que tocam o que o CI lê (`src/`, `test/`, `package*.json`, `tsconfig*.json`, `vitest.config.ts`, `.swcrc`), o resultado não vale para o PR: diga isso ao dono e rode depois do commit, num worktree limpo, com o mesmo comando apontando para a pasta dele (`git worktree add --detach <pasta no scratchpad> HEAD`, e `git worktree remove <pasta>` no fim). Se o PR não toca em nada que algum passo lê (só `.md`, `docs/` ou `.claude/`), diga que as verificações não se aplicam em vez de rodá-las.

## Passo 3. Revisar e decidir

Invoque a `pr-review` sobre o branch atual, passando a lista de arquivos do passo 1 e o resultado das verificações do passo 2 que não são obrigatórias. Mostre o parecer como ele vier e faça uma pergunta só, conforme a conclusão:

| Conclusão | Pergunta |
|---|---|
| **Precisa de mudanças** | Corrigir antes (a recomendação) ou abrir assim? Para abrir assim, o dono dá o motivo de cada Bloqueante, e o motivo vai para "Open points" |
| **Pronto com ressalvas** | Corrigir as Atenções ou abrir com elas em "Open points"? |
| **Pronto para merge** | Seguir para a descrição? |

Depois de uma correção, volte ao passo 2: a correção também precisa passar pelo CI e pela revisão.

## Passo 4. Título e descrição

Confira como o repositório faz o merge:

```bash
gh api repos/JoaoVitor2310/price-cd/rulesets/14848299 --jq '.rules[] | select(.type == "pull_request") | .parameters.allowed_merge_methods'
```

A configuração do repositório (`gh repo view`) ainda libera o rebase; quem restringe é o ruleset, e é ele que vale.

Desde 2026-11-25 o ruleset "Pass Tests" da `main` só aceita **squash** (até o PR #87 o histórico tem "Merge pull request #N"). **O título do PR vira o commit na `main`**, e o GitHub acrescenta o `(#N)`. As mensagens dos commits do branch não chegam à `main`: o título é o que importa. Se a consulta acima mostrar outro método liberado, diga ao dono antes de seguir.

O título segue o histórico: Conventional Commits, em inglês, tudo minúsculo exceto nomes próprios, sem ponto final. Por exemplo: `feat: idempotent trade with offer and research retries`.

A descrição é em inglês, porque é o idioma dos commits e o repositório é público. Escreva para quem não acompanhou o trabalho. Comece pelo porquê, depois o quê, depois o como. Use termos do domínio (`CONTEXT.md`) no lugar de nomes de classe sempre que der.

```markdown
## Why

<The problem in one or two sentences: what the operation, the Sistema Estoque, the chatbot or a person using the web page saw.>

## What changes

- <Behavior, in domain terms. One bullet per change a reviewer should notice.>

## How it was verified

- CI checks run locally in Docker: `npm ci`, build, `npm test` (<n> tests).
- <The test that proves the fix or the feature, by behavior: "a retried research with the same request_uuid reuses the Trade the Sistema Estoque already created".>
- <When they apply: real-Redis queue tests (<n> tests), production image build, Biome and test typecheck on the changed files.>
- Manual check: <what was run in the dev container (a demo research with the games that motivated the change, the web page, the queue dashboard), or "not needed: <why>".>

## Deploy

<The merge deploys to production right away, so list what must be in place before it: a new env var in the VPS `.env` (and where its value comes from), a change the Sistema Estoque or the chatbot must ship first, a Redis change. With nothing: "Nothing beyond the merge.">

## Open points

<Only with content: the review's Atenção items the owner chose to keep, and any Bloqueante opened on purpose, each with the owner's reason. Follow-ups registered in docs/IMPROVEMENTS.md, by number.>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Não liste arquivos nem inclua checklist: o diff já mostra os arquivos, e o CI já é a checklist.

Quando houver imagens (passo 4a), acrescente uma seção `## Screenshots` antes de "Deploy". Ela só diz quais estados mudaram; as imagens vão nos comentários do PR, um por estado.

## Passo 4a. Imagens da tela (só quando a interface muda)

A interface web é `public/index.html` (HTML, CSS e JS num arquivo só), servida pela raiz do serviço e descrita em `docs/wiki/interface-web.md`. O passo vale para todo diff em `public/` e para mudança de resposta que a tela mostra (a tabela do modo demonstração, os presets de `GET /api/games/presets`).

1. **Os estados.** Liste cada estado da tela que o diff muda: o formulário vazio, um preset escolhido, a caixa de popularidade travada, um balão **i**, a lista vazia, o resultado do modo demonstração, a confirmação do envio com token, o erro. Tire os estados das condições alteradas no código. Para cada um, informe o que o reproduz e se ele já existia antes (só então há imagem de "antes").
2. **Como subir a tela.** O dev container monta `src/` e `public/` e recarrega sozinho, então mostra o working tree:

   ```bash
   docker compose --profile dev up -d price-researcher-dev
   ```

   A tela fica em `http://localhost:5556` (ou o `HOST_PORT_DEV` do `.env`). Nunca suba o serviço `price-researcher` sem perfil: é o de produção.
3. **Os dados.** Prefira estados que não precisam enviar nada. O modo demonstração (sem token) raspa AllKeyShop e SteamCharts de verdade, então use dois ou três jogos conhecidos. **Nunca envie com token**: o dev lê o mesmo `.env` da produção, e o envio cria uma Trade no Sistema Estoque para onde o `SISTEMA_ESTOQUE_URL` aponta. A confirmação do envio com token só entra se o dono disser que esse endereço é um Estoque local.
4. **Quem tira cada imagem.**
   - **Antes:** quem tira é o dono, porque exige rodar a `main`. A skill nunca troca de branch no working tree dele.
   - **Depois:** o agente tira pelo navegador do app (`mcp__Claude_Browser__*`), em `http://localhost:5556`.
   - **Nomes:** `<n>-<estado>-before.png` e `<n>-<estado>-after.png`, com `<estado>` em kebab-case.
   - **Estado sem imagem:** pode ficar sem imagem, desde que tenha um motivo, que vai para o comentário do PR.
5. **Onde as imagens ficam.** Num branch órfão `pr-assets`, uma pasta por número de PR. Assim o histórico da `main` não guarda imagens, e o link continua valendo depois do merge. O `deploy.yml` só roda para a `main`, então um push no `pr-assets` não faz deploy. Subir as imagens é um commit e um push, então quem roda o comando é o dono, **depois** de o PR existir (o número do PR é o nome da pasta):

   ```bash
   N=<número do PR>; IMGS=(<caminhos das imagens>)
   git fetch -q origin pr-assets 2>/dev/null
   (
     set -e
     tmp_index="$(mktemp)"; trap 'rm -f "$tmp_index"' EXIT
     export GIT_INDEX_FILE="$tmp_index"
     if git rev-parse -q --verify origin/pr-assets >/dev/null; then
       git read-tree origin/pr-assets; parent=(-p origin/pr-assets)
     else
       git read-tree --empty; parent=()
     fi
     for img in "${IMGS[@]}"; do
       git update-index --add --cacheinfo "100644,$(git hash-object -w "$img"),${N}/$(basename "$img")"
     done
     commit="$(git commit-tree "$(git write-tree)" "${parent[@]}" -m "screenshots: PR #${N}")"
     git show --stat --format= "${commit}"
     git push origin "${commit}:refs/heads/pr-assets"
   )
   ```

   O índice temporário existe só dentro do subshell: o índice e o working tree do dono não mudam. Sem `origin/pr-assets`, o primeiro commit nasce sem pai e cria o branch. Use sempre `${}` antes de `:`, porque no zsh `$commit:r` é um modificador. Se o push for recusado, rode de novo desde o `fetch`. Nunca use `--force`.
6. **Os comentários.** Um texto por estado, com o link `https://github.com/JoaoVitor2310/price-cd/raw/pr-assets/<N>/<arquivo>`, gravado em `.pr/`, que a skill posta no passo 6.

Grave a descrição em `.pr/<branch, com / trocado por ->.md` (a pasta `.pr/` é ignorada pelo git). Mostre o arquivo ao dono: no app desktop, com `SendUserFile` e `display: "render"`; no terminal, com o conteúdo na resposta. Junto, mostre o título e pergunte uma vez se o dono confirma os dois. Esse sim é o que autoriza o passo 6.

## Passo 5. Branch, commit e push

Proponha mais de um commit só quando isso ajudar quem revisa, por exemplo separando uma refatoração sem mudança de comportamento da mudança que a usa. O normal é um commit só, porque o squash junta tudo de qualquer jeito. Para cada commit, dê a mensagem e a lista exata de arquivos.

Pule o que já está feito: o branch que já existe, e o commit que já está no remoto.

1. **Branch.** Se o trabalho está na `main`, a skill cria o branch a partir do `HEAD`: `git switch -c <branch>`. As mudanças não commitadas vão junto, inclusive as de outra frente, que continuam fora do stage. Nunca crie o branch a partir de `origin/main` sem `--no-track`. Confira com `git branch -vv` que o branch novo não mostra `[origin/main]`.
2. **Stage.** Se o índice já tiver arquivos de outra frente (`git diff --cached --name-only`), pare e pergunte: o `git add` não tira do índice o que já estava lá. Depois, `git add -- <arquivos do commit>` e mostre `git diff --cached --stat` para o dono conferir.
3. **Commit.** Entregue o comando ao dono num bloco `bash` e espere ele dizer que commitou:

   ```bash
   git commit -m "<mensagem>" -m "Co-Authored-By: <a linha de coautoria da sessão>"
   ```

4. **Push.** Confira que o branch atual não é a `main` e, com `git log --oneline origin/main..HEAD`, que o commit é o esperado. Rode `git push -u origin <branch>`, sempre com o nome do branch. Nunca use `--force`; se o push for recusado, pare e diga ao dono.

## Passo 6. Abrir o PR

1. **Confira o que está no GitHub.** Rode `git fetch -q origin <branch>` e depois `git rev-list --left-right --count origin/<branch>...HEAD`. O resultado tem de ser `0 0`, e `git status --porcelain` não pode listar nenhum arquivo do PR. Se o local estiver à frente, falta um push: rode o passo 5.4. Se o remoto estiver à frente, alguém empurrou algo que não foi revisado: pare e diga ao dono.
2. **Abra ou atualize.** Para abrir, use `gh pr create --base main --head <branch> --title "<título>" --body-file .pr/<arquivo>.md`; como rascunho (`--draft`), só se o dono pedir. Para atualizar, use `gh pr edit <N> --title "<título>" --body-file .pr/<arquivo>.md`.
3. **Auto-merge.** O merge é deploy, então o auto-merge só vale quando o GitHub de fato espera o CI. Ative no PR que a skill abriu ou atualizou, com estas condições:
   - **O check do CI é obrigatório na `main`.** Confira com `gh api repos/JoaoVitor2310/price-cd/rulesets --jq '.[] | {name, enforcement}'`: o ruleset "Pass Tests" (que exige o check "Run tests") tem de estar `active`. Desativado, o auto-merge não tem o que esperar e faz o merge na hora, sem CI. Nesse caso não ative: diga ao dono que o ruleset está desligado e que o merge fica com ele.
   - **Nunca em PR do Dependabot** (autor `app/dependabot`). Atualização de dependência é revisada e mergeada pelo dono, porque puppeteer e afins pedem teste de scraping real que a suíte não cobre (`.github/dependabot.yml`). A skill não abre esses PRs; se for chamada sobre um, não ativa.
   - **Nada pendente antes do merge.** Se "Deploy" pede algo antes do merge (variável nova no `.env` da VPS, o Estoque ou o chatbot publicando primeiro), ou se "Open points" tem um Bloqueante mantido, não ative: diga o que falta e deixe o merge com o dono. Ative depois, quando o dono disser que está pronto.
   - **Rascunho** (`--draft`) não recebe auto-merge.

   Com tudo certo, rode `gh pr merge <N> --auto --squash --subject "<título> (#<N>)" --body "Co-Authored-By: <a linha de coautoria da sessão>"` (squash é o único método que o ruleset aceita, passo 4). **O `--subject` é obrigatório:** o repositório usa "commit ou título do PR" no squash, e com um commit só o GitHub usa a mensagem do commit, não o título do PR. Se o commit saiu com uma mensagem errada, ela iria para a `main` (aconteceu no PR #89). Confira com `gh pr view <N> --json autoMergeRequest` o `commitHeadline` e o `commitBody`; para trocar, desligue antes com `gh pr merge <N> --disable-auto`. Nunca `--admin`. O ruleset exige o branch em dia com a `main`: se ela andar depois de o PR abrir, o auto-merge fica parado até `gh pr update-branch <N>`, que a skill roda quando o dono pedir. Confira com `gh pr view <N> --json autoMergeRequest` que ficou ativo e diga ao dono que o PR vai entrar sozinho quando o CI passar.
4. **Imagens.** Se houver, entregue ao dono o comando do passo 4a, já com o número do PR, porque ele faz um commit e um push no `pr-assets`. Depois que o dono confirmar, poste um comentário por estado com `gh pr comment <N> --body-file <arquivo>`.
5. **Apague os rascunhos de `.pr/`.** Depois de o PR ser aberto ou atualizado, e de os comentários das imagens estarem postados, apague sempre a descrição e os textos dos comentários desta mudança, sem perguntar: o conteúdo já está no GitHub. Se o `gh` falhou, não apague, porque o arquivo ainda é necessário para tentar de novo (o passo 1 da próxima execução limpa o que sobrar). Confira com `ls .pr/` que nada desta mudança ficou.
6. **Responda em poucas linhas:** o link do PR, se o auto-merge ficou ativo (e, se não, por quê), o que ficou em "Open points", o que precisa estar pronto antes do merge (a seção "Deploy") e os testes manuais que ainda faltam. Se o dev container foi subido pela skill, ofereça derrubá-lo (`docker compose --profile dev stop price-researcher-dev`).

O PR não é anunciado em lugar nenhum, e o parecer da revisão não é postado nele: o parecer é do autor.
