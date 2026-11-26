---
name: pr-review
description: Revisa uma mudança do price-cd (o branch atual com o working tree, ou um PR do GitHub pelo número) contra as regras escritas do próprio repositório, que são o CLAUDE.md, os ADRs, o CONTEXT.md e o README (contrato dos endpoints), e contra o item do docs/IMPROVEMENTS.md que a mudança diz resolver. Cobre a fronteira das camadas e a injeção do Nest, a regra de que o price-cd pesquisa e não decide a oferta, a operação em produção (Chromium, conta do SteamTrades, tokens, SSRF, HMAC), as filas duráveis e a repetição de pedidos, o contrato com o Sistema Estoque e o chatbot, a interface web, os testes e a documentação viva. Entrega um parecer com achados classificados (Bloqueante, Atenção, Sugestão) e uma conclusão (Precisa de mudanças, Pronto com ressalvas, Pronto para merge). Só lê: não altera arquivo nem faz nada no git. Use quando o usuário pedir "revisa a mudança", "revisa o branch", "revisa o PR #N", "review antes do PR" ou invocar /pr-review.
---

# Revisão de mudança: price-cd

Esta revisão quer saber uma coisa: **a mudança pode entrar na `main` sem quebrar uma regra que o projeto já escreveu?** Ela não refaz o CI. O `npm run build` (tsc), a suíte do Vitest e o `test/unit/architecture/layer-boundary.test.ts` já pegam o que é mecânico. O trabalho aqui é o julgamento que ferramenta nenhuma faz: o código na camada certa, a decisão que um ADR registrou, o teste que só parece cobrir e o documento que ficou para trás.

Lembre o custo do erro: **todo merge na `main` vai para produção** (`deploy.yml`). Não há staging.

Duas regras valem para a revisão toda:

- **Todo achado aponta para uma regra escrita.** Pode ser uma seção do `CLAUDE.md`, um ADR de `docs/adr/`, o glossário do `CONTEXT.md` ou o contrato do `README.md`. Achado sem regra que se possa citar é preferência pessoal e entra no máximo como Sugestão. Um bug real é exceção: entra mesmo sem regra, marcado como "(correção)".
- **A revisão só lê.** Ela não edita arquivo nem roda `git add`, `commit`, `checkout`, `switch`, `stash` ou `reset`. Corrigir acontece num passo separado, quando o dono pedir.

## Passo 1. O que está sendo revisado

| Pedido | Alvo | Como ler |
|---|---|---|
| sem argumento | o branch atual e o working tree, contra `origin/main` | `git fetch -q origin main`; depois `git diff origin/main`, mais os arquivos de `git ls-files --others --exclude-standard`. Leia os arquivos do disco |
| `#N` ou `N` | o PR `N` deste repositório | `gh pr view N --json title,body,baseRefName,headRefName,files`, `gh pr diff N` e `gh pr checks N`. Leia os arquivos com `git show "origin/${head}:<caminho>"` (sempre com aspas e `${}` antes de `:` no zsh) |

Quando quem chama passa a lista de arquivos (a `pr-open` faz isso), revise só ela. Quando o working tree tiver arquivos que não parecem fazer parte da mudança, como um plano, uma lista de jogos em `test/*.txt` ou um ajuste em outro assunto, liste esses arquivos e pergunte se entram, antes de revisar. Nunca revise `dist/` nem `node_modules/`.

Escreva **numa frase** o que a mudança faz, nos termos do domínio (Lista, Trade, Fornecedor, Preset de pesquisa, Resultado da pesquisa…). Essa frase volta no passo 3.11.

## Passo 2. As regras que valem

Leia as regras na versão da base (`git show "origin/main:<caminho>"`). Se a mudança altera uma regra, leia também a versão nova e trate a alteração como parte do que está sendo revisado.

1. `CLAUDE.md`: o papel (camadas, testes obrigatórios), o idioma no código, o Git, a documentação viva e as seções de "Arquitetura" e "Tecnologias e Padrões" (concorrência, cache, filas, rate limit, tratamento de erros, desligamento, ciclo de vida do Chromium). Neste repositório o `CLAUDE.md` é também o documento de arquitetura e de testes: não há `ARCHITECTURE.md` nem `TESTING.md`.
2. Os ADRs de `docs/adr/` que tratam do assunto tocado. Os mais citados: 0001 (stateless scraper), 0004 (Nest como apresentação), 0005 (init no container), 0006 (imagem construída no CI), 0007 (presets moram no price-cd), 0008 (cache de preço), 0009 (filas duráveis), 0010 (webhook do Resultado da pesquisa), 0011 (painel das filas), 0012 (um token por consumidor).
3. `CONTEXT.md`, para os termos e os sinônimos proibidos (`_Avoid_`).
4. O item do `docs/IMPROVEMENTS.md` que a mudança diz resolver. Procure o número no título do PR, nos commits ou na conversa. Se não houver item, siga sem ele.
5. `docs/nest-conceitos.md` quando a mudança mexe no wiring do Nest, e `docs/GAME_NAME_NORMALIZATION.md` quando mexe em `helpers/clear-string.ts` ou no matching de nomes.
6. Quando a mudança toca um contrato com outro sistema: o `README.md` daqui (rota, request, response), o `docs/PRICE_RESEARCHER.md` do Estoque em `../sistema-estoque-jogos-cd/` e o `docs/PRICE-RESEARCHER.md` do chatbot em `../chatbot-steam/`, se estiverem acessíveis. **O código do outro sistema vale mais do que o documento daqui ou de lá.**

## Passo 3. O que conferir

Para cada arquivo alterado, leia o arquivo inteiro, e não só o trecho do diff. O problema costuma estar em volta: uma função ao lado que já fazia a mesma coisa, ou o chamador que ainda espera o formato antigo.

### 3.1 Fronteiras

O `layer-boundary.test.ts` já prova no CI que `domain/`, `application/` e `helpers/` não importam `@nestjs/*`, e que `infrastructure/` e `lib/` importam no máximo `@nestjs/common`. Não repita isso. Confira o que o teste não vê (`CLAUDE.md`, "Papel do Claude" e "Arquitetura"):

- **Regra de negócio nunca vive em `nest/`.** Controller, módulo, pipe e filter só orquestram. Um `if` sobre preço, popularidade ou preset num controller é Bloqueante.
- `src/domain/` não conhece o Node (`process`, `Buffer`, `node:*`, `fetch`) nem HTTP. Um use case de `application/` nunca conhece HTTP (status code, `Request`, header).
- O que a mudança sabe de um sistema externo (HTML do AllKeyShop e do SteamTrades, JSON do SteamCharts e do Estoque, Redis, BullMQ) fica em `src/infrastructure/`.
- **O wiring do ADR 0004:** portas são `abstract class`; adapters de `infrastructure/` entram com `useClass`; use cases de `application/` entram com `useFactory` + `inject`. Um use case novo registrado de outro jeito recebe `undefined` sem erro no boot.
- **`import type` de uma classe injetada pelo construtor** em `src/infrastructure/` ou `src/nest/` apaga o `design:paramtypes` e o Nest injeta `undefined` ("Tratamento de Erros", item do `biome check --write`). Procure no diff.
- Sessão de browser só é declarada no `BrowserModule`. Um segundo módulo que a declara cria um segundo Chromium.
- "Service" no sentido de DDD (`application/<módulo>/services/`): existe porque mais de um use case o usa. Uma porta nova existe porque um teste precisa de um falso dela.

### 3.2 As regras do negócio

- **O price-cd pesquisa e não decide a oferta.** Ele aplica os critérios do Preset de pesquisa (ADR 0007) e cria a Trade; o valor da oferta, o aceite e a rejeição são do Sistema Estoque (`POST /api/trades` com `currency`, ADR 0010). Qualquer conta de valor de oferta ao Fornecedor no price-cd é Bloqueante.
- **O cache guarda o dado bruto** (melhor preço e se há oferta na Gamivo), nunca o resultado filtrado por um preset. Só `priced` e `not-found` vão para o cache; `failed` nunca (ADR 0008, "Padrões de Concorrência").
- **O tier de popularidade só corta.** Com mínimo 0 ninguém sai, nem o jogo sem dados. O corte do menor tier vem antes do preço, para poupar o AllKeyShop; o da faixa do preço vem depois (`CLAUDE.md`, "O que o projeto faz").
- Uma mudança no matching de nomes (`clear-string.ts`, `hasEdition`, `EDITION_TIERS`) respeita o ADR 0003 (Edição resolvida na página, não na busca) e tem caso de teste com o nome real que motivou a mudança.
- A mudança usa os termos do `CONTEXT.md`: Lista (não "trade" nem "topic" para a listagem do SteamTrades), Trade (o registro no Estoque), Criar Trade (não "importar"), Fornecedor, Resultado da pesquisa, Preço de mercado, Edição × Versão, Preset de pesquisa (não "modo"). Um sinônimo proibido em código ou texto **novo** é Atenção; o nome antigo que a mudança só repete não é achado (os itens 1 e 2 do `IMPROVEMENTS.md` já o registram).

### 3.3 Segurança e produção

- **Nenhum teste abre browser nem faz rede real.** `initializeBrowser()` recusa rodar sob `VITEST`; a única exceção declarada é `test/unit/lib/puppeteer-browser.test.ts`. Um teste novo que chama AllKeyShop, SteamCharts, SteamTrades ou o Estoque de verdade é Bloqueante.
- **A conta do SteamTrades.** Comentário e bump passam pelo `steamTradesGate` e por um processo só (`BUMP_SCHEDULER_ENABLED`). Um laço novo que comenta em massa, ou um segundo agendador, é Bloqueante: risco de ban.
- **O ciclo de vida do Chromium.** Quem abre fecha; nenhum caminho de erro zera a referência sem encerrar o processo; `cleanupBrowser` mantém a ordem close → SIGTERM → SIGKILL e nunca lança; `init: true` e `pids_limit` continuam no `docker-compose.yml` (ADR 0005). Foi isso que derrubou a VPS em 2026-08-24 e 2026-09-18.
- **Tokens:** um por consumidor (ADR 0012), comparados em tempo constante. Uma rota autenticada nova diz qual token aceita.
- **Webhook:** a URL vem do corpo da requisição, então a allowlist `WEBHOOK_ALLOWED_HOSTS` é conferida no pedido (400) e de novo no envio; redirect nunca é seguido; o corpo é assinado com HMAC; o `failed` leva mensagem fixa, nunca o texto do erro interno (ADR 0010).
- **Painel das filas:** somente leitura e atrás de Basic Auth (ADR 0011). Nada que permita escrita.
- **Rotas `/api`** de máquina só pela porta interna; o modo demo continua limitado a 10 jogos.
- **O repositório é público.** Nada em código, teste, fixture, `.env.example` ou docs se parece com token, `STEAMTRADES_SESSION`, Steam ID real de Fornecedor, chave da Gamivo ou e-mail pessoal.

### 3.4 Falhas e repetição

Para cada efeito colateral novo (criar Trade, comentar, enviar webhook), pergunte: o que acontece se falhar no meio, se o processo cair, e se o mesmo pedido chegar duas vezes.

- **A fila guarda dado, não closure** (ADR 0009): o payload sobrevive ao restart.
- **Nova tentativa só para o pedido idempotente.** Só a Trade com oferta com `request_uuid` é segura para repetir (`ResearchGamesRunner.canRetry`); a Trade sem oferta cria outra a cada chamada. Um retry novo sobre algo que não é idempotente é Bloqueante.
- O `request_uuid` é o `jobId` da pesquisa e da fila `webhooks`; a política do reenvio (em andamento, concluído, falho) é do `EnqueueResearchGamesUseCase`, não do adapter.
- O `ResearchCheckpoint` guarda o progresso antes de chamar o Estoque; a tentativa seguinte continua de onde parou. O aviso de `failed` sai só na falha definitiva.
- **Desligamento:** filas fecham em `beforeApplicationShutdown`, devolvem o job (`moveToDelayed`) e traduzem a falha do desligamento em `DelayedError`; o trabalho novo respeita o `AbortSignal`, e o `catch` por item repassa o `JobCancelledError`. Nenhum módulo registra handler de sinal nem chama `process.exit`.
- **Fail-open do cache:** o Redis do cache fora vira miss e nunca lança. A fila fora responde 500 na hora, nunca `202` sem ter guardado o pedido.

### 3.5 Configuração e container

O price-cd não tem banco nem migração (ADR 0001); o estado mora no Redis.

- Uma variável de ambiente nova aparece em `src/config/env.schema.ts` (Zod, com o teste do schema), no `.env.example` e, se o comportamento muda para quem opera, no `README.md`. Segredo novo segue o mínimo de 32 caracteres dos outros.
- **O dev e a produção leem o mesmo `.env`.** Um valor que precisa ser diferente entre os dois (URL do Redis, `BUMP_SCHEDULER_ENABLED`) mora no `environment` do serviço no `docker-compose.yml`, não no `.env`. Uma variável com default no schema só funciona porque o `dotenv/config` é o primeiro import do `main.ts`.
- O cache usa o banco 0 do Redis e as filas o banco 1. Nada que faça `FLUSHALL` ou `FLUSHDB` no 1.
- Mudança no `Dockerfile`, no `docker-compose.yml`, em `docker/` ou nos workflows: os testes de `test/unit/docker/` e `test/unit/infrastructure/{deploy-workflow,docker-compose}.test.ts` continuam batendo; o entrypoint segue `exec node` (nunca `npm run`); a imagem continua construída no CI (ADR 0006).

### 3.6 Contrato com os outros sistemas

- Rota, request, response ou status code mudou: o `README.md` muda junto, e o `test/contract/contract-cases.ts` também. O formato de erro **não é uniforme entre as rotas de propósito** (item 18 do `IMPROVEMENTS.md`): uniformizar sem ser o objetivo do PR é Atenção.
- Payload que o Estoque recebe (`POST /api/trades`, callback de Trade sem oferta) ou que o chatbot recebe (corpo do webhook, assinatura): confira o código do outro lado em `../sistema-estoque-jogos-cd/` e `../chatbot-steam/`, e diga se o outro sistema precisa publicar algo antes deste merge. Isso vai para a seção "Deploy" do PR.
- Preset novo ou alterado: o que o Estoque e o chatbot mandam continua válido (ADR 0007).

### 3.7 Tela

Só quando o diff muda `public/` (a interface web, `public/index.html`).

- Os textos da interface estão em português, e a regra explicada no ícone **i** bate com o que o domínio faz (`test/unit/public/index-tooltips.test.ts`).
- Os estados: modo demonstração (resultado na tela, até 10 jogos), envio com token (confirmação na hora, Steam ID e Título limpos), lista vazia, erro do servidor, preset que preenche os campos, caixa de popularidade travada.
- `docs/wiki/interface-web.md` descreve a tela como ela fica depois da mudança.

### 3.8 Testes da mudança

O `CLAUDE.md` exige teste para cada alteração. Não se revisa a suíte inteira, só se a mudança está de fato coberta:

- Cada arquivo de `src/` com comportamento novo tem teste no espelho em `test/unit/<camada>/…`; uma rota nova tem caso em `test/contract/` (o `route-coverage.contract.test.ts` cobra isso) e, se mexe no wiring, em `test/integration/nest/`.
- O teste exercita o caminho que motivou a mudança. Numa correção, deve existir um teste que falharia sem ela.
- **Asserção negativa que passa por acaso.** Um `expect(...).not.toThrow()`, `not.toHaveBeenCalled()` ou `toHaveLength(0)` passa também quando o código nem chegou ao ponto testado. Confira se há uma asserção positiva no mesmo teste.
- Uma mudança nos adapters BullMQ de `src/infrastructure/background/` ou `webhooks/` pede caso em `test/integration/queue/*.redis.test.ts`. Esses testes são opcionais no CI (sem Redis): diga se foram rodados.
- Procure com `git grep` o nome antigo de toda função, tipo, rota ou texto que a mudança removeu ou renomeou, inclusive em `test/`, `docs/`, `README.md`, `CLAUDE.md` e `public/`.

### 3.9 Documentação viva

A tabela "Documentação viva" do `CLAUDE.md` é a regra. Confira:

- O item do `IMPROVEMENTS.md` que a mudança conclui foi **removido**, os itens seguintes foram renumerados e quem os citava por número (o próprio `IMPROVEMENTS.md`, `CLAUDE.md`, ADRs, comentários no código) foi corrigido. Um problema que a mudança deixa em aberto virou item novo.
- Uma decisão difícil de reverter (contrato com outro sistema, fila, cache, segurança) tem ADR novo ou atualizado.
- O `CLAUDE.md` ("Arquitetura", "Tecnologias e Padrões"), o `README.md`, o `CONTEXT.md` e a `docs/wiki/` descrevem o código como ele fica depois da mudança. Um docblock que conta a história ("agora", "antes era", "for now") é Sugestão: a história pertence ao commit.
- **Idioma:** código, testes, mensagens de erro e fixtures em inglês; português só em comentários e `.md`. A exceção é a string que reproduz uma saída de produção, e ela precisa de comentário dizendo isso.

### 3.10 Verificações fora do CI

O Biome (`npm run lint`, itens 14 e 15 do `IMPROVEMENTS.md`) e o `tsc` dos testes (`tsconfig.test.json`) não rodam no CI e já falham na `main`. Não trate a dívida antiga como achado. Se quem chamou passou o resultado dessas verificações para os arquivos da mudança, um erro **novo** num arquivo do diff é Sugestão, ou Atenção se for um erro de tipo real num teste.

### 3.11 Tamanho

Releia a frase do passo 1. Se ela precisa de "e também", são duas mudanças: diga onde separar, como Atenção, quando cada metade fica coerente sozinha. Uma mudança grande e coerente não é achado.

## Passo 4. Confirmar antes de escrever

Confirme cada candidato antes que ele vire achado:

1. O problema está no código como ele fica depois da mudança, e não num trecho que o diff removeu.
2. "Duplicado", "sem chamador" e "teste que ainda usa o antigo" vêm com o `git grep` que prova.
3. A regra citada foi relida no arquivo agora, e não de memória.
4. Quando o achado depende de como uma biblioteca se comporta (Nest, BullMQ, Puppeteer, node-redis, Vitest), a fonte está em `node_modules/` (só leitura) ou na documentação oficial (Puppeteer: https://pptr.dev). Se for preciso executar, use um container descartável, nunca o Node do host:

   ```bash
   docker run --rm -e PUPPETEER_SKIP_DOWNLOAD=true -v "$PWD":/app -v price-cd-node-modules:/app/node_modules -w /app node:22-bookworm-slim npx vitest run <arquivo>
   ```

5. O que não se confirma é descartado. Poucos achados certos valem mais que muitos com alguns falsos.

## Passo 5. Classificar e concluir

| Nível | Quando |
|---|---|
| **Bloqueante** | Quebra uma regra que o projeto escreveu como obrigatória (camadas, teste por alteração, nenhum teste com browser ou rede real), contraria um ADR vigente, decide valor de oferta no price-cd, repete um efeito que não é idempotente, põe a conta do SteamTrades ou a VPS em risco (Chromium órfão, segundo agendador, comentário em massa), abre brecha de segurança (token, SSRF, HMAC, segredo no repo), quebra o contrato com o Estoque ou o chatbot sem o outro lado, deixa um teste que finge cobrir a mudança ou é um bug com cenário concreto |
| **Atenção** | Funciona, mas precisa de uma decisão do dono antes do merge: contrato ou regra mudou sem registro, doc desatualizado, caso de borda sem teste, teste de fila com Redis que não foi rodado, termo proibido em código novo, mudança que dá para dividir |
| **Sugestão** | Melhora sem efeito no comportamento nem na arquitetura: nome, comentário, simplificação pequena, achado novo do Biome |

Quando um achado fica entre dois níveis, ele só sobe se houver um cenário de dano que dê para escrever em uma frase.

A conclusão sai da classificação, sem exceção:

- algum Bloqueante: **Precisa de mudanças**;
- nenhum Bloqueante e alguma Atenção: **Pronto com ressalvas**;
- só Sugestões, ou nada: **Pronto para merge**.

## Passo 6. O parecer

Responda no chat, em português, neste formato. Não grave o parecer em arquivo, a não ser que o dono peça.

```markdown
## Parecer: <Precisa de mudanças | Pronto com ressalvas | Pronto para merge>

**Mudança:** <a frase do passo 1>
**Alvo:** <branch ou PR #N> · <n> arquivos · +<a> −<d> · regras de <origin/main, data>
**Item do IMPROVEMENTS:** <NN - título | nenhum>

<Uma ou duas frases sobre o que decidiu a conclusão.>

### Bloqueantes
1. **<título curto>**: [arquivo.ts:42](src/...)
   - Regra: <arquivo e seção, ou ADR NNNN>
   - Consequência: <o que dá errado, com o cenário>
   - Correção: <o que fazer>

### Atenção
1. ...

### Sugestões
- [arquivo.ts:10](src/...): <uma linha>

### Para testar à mão
- <o que só um teste no dev mostra: uma pesquisa demo com os jogos que motivaram a mudança, a tela, o painel das filas; ou "nenhum">

### O que está bem feito
- <dois ou três pontos que vale repetir nas próximas mudanças>
```

Uma seção sem achados fica com "Nenhum." e não é removida: quem lê sabe que ela foi conferida.

No "Para testar à mão", lembre que o dev lê o mesmo `.env` da produção: uma pesquisa **com token** cria a Trade no Sistema Estoque para onde o `SISTEMA_ESTOQUE_URL` aponta, e isso só com o sim do dono.

Termine oferecendo, em uma linha, corrigir os Bloqueantes e as Atenções. Corrija só depois do sim, e rode esta revisão de novo depois da correção.
