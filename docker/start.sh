#!/usr/bin/env bash
# Ponto de entrada do container: sobe um servidor X virtual e inicia a API Node.

# -e: para o script se algum comando falhar
# -u: erro se variável não definida for usada
# -o pipefail: pipeline falha se qualquer etapa falhar
set -euo pipefail

# Display virtual fixo em :99 — não lê DISPLAY do ambiente para evitar
# que valores com aspas literais vindos do docker-compose quebrem o Xvfb.
DISPLAY_NUM=99
export DISPLAY=":${DISPLAY_NUM}"

# Remove lock file órfão do display caso o container tenha sido reiniciado sem
# que o Xvfb anterior tivesse encerrado corretamente (evita "already active" fatal).
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}"

# Xvfb = X Virtual Framebuffer: simula um monitor sem hardware.
# -screen 0 1920x1080x24: primeiro screen, resolução e profundidade de cor
# -ac: desliga controle de acesso (aceitável em container isolado)
# +extension GLX +render: extensões úteis para alguns caminhos de renderização
# -noreset: não reseta o servidor ao último cliente desconectar (evita surpresas com Chromium)
# &: roda em background para liberar o shell e executar o Node em seguida
Xvfb ":${DISPLAY_NUM}" -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &

# Pequena pausa para o socket do display existir antes do Node abrir o browser.
sleep 2

# exec substitui o processo do shell pelo Node: o Node vira PID 1 (sinais SIGTERM chegam certo no app).
exec node dist/server.js
