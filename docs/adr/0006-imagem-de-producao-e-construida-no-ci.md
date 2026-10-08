# A imagem de produção é construída no CI e puxada pela VPS

O deploy antigo rodava `docker compose up --build` **na VPS**. Em 2026-10-08 um build frio estourou os 10 minutos do `appleboy/ssh-action` (`Run Command Timeout`) no meio da instalação do Chromium (184 pacotes, 746 MB), deixando o código novo na VPS e o container antigo rodando.

A causa da lentidão não era o Dockerfile: o `vmstat` da VPS mostrava `st` (steal) entre **60% e 80%** sustentado, com o `wa` (iowait) perto de zero. A CPU é emprestada pelo hipervisor, então `dpkg` e `tsc` rodam em uma fração da velocidade. O mesmo steal é o principal suspeito dos timeouts de navegação do Chromium no AllKeyShop.

**Decisão:** o GitHub Actions constrói a imagem e a publica no GHCR (`ghcr.io/joaovitor2310/price-cd`, tags `latest` e `sha-<commit>`). A VPS só faz `docker compose pull` e `up -d` — nada é compilado nela.

## Por que não as alternativas

- **Subir o `command_timeout` do SSH** esconde o sintoma: o build continuaria levando 10+ minutos de CPU roubada, competindo com o container de produção que está rodando.
- **Manter o build na VPS e proteger o cache** (ajustar os crons de prune) reduz a frequência do build frio, mas não o torna rápido, e o cache continua dependendo de uma máquina que perde CPU.
- **Imagem pública no GHCR** dispensaria autenticação na VPS, mas expõe o código compilado. A imagem não carrega segredos (`.env` está no `.dockerignore`), porém publicar o código é uma decisão de negócio, não de infraestrutura.

## Como a VPS autentica

O job de deploy passa o `GITHUB_TOKEN` do próprio workflow pelo SSH (`envs`), faz `docker login` e remove a credencial com `trap ... EXIT`, mesmo se o pull falhar. O token expira quando o job termina, então **não há PAT guardado na VPS**. Isso só funciona porque o build grava o label `org.opencontainers.image.source`, que liga o pacote ao repositório.

## Consequences

- O cache de camadas vive no cache do GitHub Actions (`type=gha`), não no BuildKit da VPS. Os crons `docker builder prune` e `docker image prune` da VPS deixam de afetar o tempo do deploy; o prune de imagens passa até a ajudar, apagando as imagens `latest` anteriores.
- O deploy depende do GHCR e do GitHub estarem no ar. Plano B manual: `docker compose up -d --build price-researcher` (o `build: .` continua no compose de propósito). O deploy normal **nunca** cai nisso: o `pull` é explícito e o script aborta (`set -eu`) se ele falhar.
- Rollback: `IMAGE_TAG=sha-<commit> docker compose up -d price-researcher`.
- O nome da imagem precisa ser minúsculo (regra do GHCR) e aparece em dois lugares — `deploy.yml` e `docker-compose.yml`. `test/unit/infrastructure/deploy-workflow.test.ts` falha se os dois divergirem; sem isso a VPS puxaria uma imagem velha sem nenhum erro.
- O `git pull` na VPS continua existindo, mas só para trazer o `docker-compose.yml` e `docker/`; o código da aplicação vem dentro da imagem.
- Isto não resolve o steal. Enquanto a CPU da VPS continuar sendo roubada, o Chromium em produção continua lento; o que muda é que o deploy deixa de depender dela.
