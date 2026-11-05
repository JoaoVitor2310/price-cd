#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUM=99
export DISPLAY=":${DISPLAY_NUM}"

rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}"

Xvfb ":${DISPLAY_NUM}" -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &

sleep 2

# `node` direto, e não `npm run dev`: o npm não repassa o SIGTERM do `docker stop`
# — ele morre e leva o app junto, sem os hooks de desligamento (medido: 0,2s, nenhum
# handler rodou). Sem desligamento ordenado o Chromium fica órfão e o job da fila da
# pesquisa só volta como travado no próximo boot (ADR 0009). O `node --watch` repassa
# o sinal e espera o filho sair. Os argumentos são os do script `dev` do
# package.json — `test/unit/docker/entrypoint.test.ts` trava os dois iguais.
exec node --import @swc-node/register/esm-register --watch src/main.ts
