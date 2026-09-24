# Nest.js é a camada de apresentação — o núcleo continua sem framework

O price-cd adota Nest 12 como camada de apresentação e composition root, substituindo
`src/app.ts`, `src/routes/`, `src/controllers/` e `src/services/`. A migração acontece pelo
padrão Strangler Fig dentro da `main`, com os dois apps sobre um núcleo compartilhado
(`docs/NEST.md`).

A fronteira não é negociável e é verificável por `grep` no CI:

| Camada | Pode importar `@nestjs/*`? |
|---|---|
| `domain/`, `application/`, `helpers/` | **nunca** |
| `infrastructure/`, `lib/` | no máximo `@Injectable()` |
| `nest/`, `main.ts` | sim — apresentação e wiring, zero regra de negócio |

Portas de aplicação são declaradas como `abstract class`, não `interface`. Interface não
existe em runtime e não pode ser token de injeção; `abstract class` é um valor, serve de token
sozinha e mantém `application/` sem conhecer o Nest.

## Sistema de módulos: ESM permanece

O spike confirmou Nest 12 funcionando sob `"type": "module"` com `cheerio`, `zod` e
`puppeteer-real-browser` carregados no mesmo processo, respondendo HTTP 200 com uma porta
injetada por `abstract class`. Não há troca para CommonJS, e portanto não há branch longa: a
coexistência Express/Nest acontece na `main`.

`moduleResolution` passa de `"node"` (depreciado sob ESM) para `"bundler"`, aplicado no PR 2
junto com `experimentalDecorators` e `emitDecoratorMetadata`.

## Toolchain: `emitDecoratorMetadata` exige SWC fora do build

`emitDecoratorMetadata` é o que alimenta `design:paramtypes`, sem o qual o Nest não resolve
dependência por tipo. O spike mediu cada ferramenta do projeto:

| Ferramenta | Emite metadata? | Consequência |
|---|---|---|
| `tsc` (build de produção) | **sim** | `npm run build` funciona sem mudança |
| `tsx` (`npm run dev`) | **não** | serve ao Express, que não tem decorator — fica como está. O entrypoint Nest (`dev:nest`) usa `node --import @swc-node/register/esm-register`; o `dev` só troca no cutover |
| Vitest com esbuild (padrão) | **não** | `vitest.config.ts` passa a usar `unplugin-swc` |

O modo de falha é o que torna isso perigoso: **sem metadata o Nest não lança erro no boot** —
ele injeta `undefined` e a aplicação sobe normalmente, quebrando só quando a rota é chamada,
com um 500 genérico. Um teste que apenas resolve um provider pelo token passa mesmo com a
metadata ausente; só uma asserção HTTP de ponta a ponta, ou uma leitura direta de
`Reflect.getMetadata("design:paramtypes", Classe)`, detecta o problema.

## Consequences

- Qualquer novo `.ts` em `domain/`, `application/` ou `helpers/` que importe `@nestjs/*` é bug
  de arquitetura, não preferência de estilo.
- Trocar `unplugin-swc` por outro transform nos testes, ou apontar `dev:nest` para o `tsx`, reintroduz
  a falha silenciosa. As duas configurações existem por essa razão e não são cosméticas.
- Toda porta nova nasce como `abstract class` em `application/**/ports/`.
- O `.swcrc` passa a ser arquivo de infraestrutura de build: `legacyDecorator` e
  `decoratorMetadata` ligados, alinhados com o `tsconfig.json`.
