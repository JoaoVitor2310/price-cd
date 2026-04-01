#!/usr/bin/env bash
# Ponto de entrada do container: sobe um servidor X virtual e inicia a API Node.

# -e: para o script se algum comando falhar
# -u: erro se variável não definida for usada
# -o pipefail: pipeline falha se qualquer etapa falhar
set -euo pipefail

# DISPLAY diz ao Chromium (e a libs gráficas) em qual “tela” desenhar.
# Se o compose não passar nada, usa :99 (display 99, típico para Xvfb manual).
export DISPLAY="${DISPLAY:-:99}"

# Xvfb = X Virtual Framebuffer: simula um monitor sem hardware.
# -screen 0 1920x1080x24: primeiro screen, resolução e profundidade de cor
# -ac: desliga controle de acesso (aceitável em container isolado)
# +extension GLX +render: extensões úteis para alguns caminhos de renderização
# -noreset: não reseta o servidor ao último cliente desconectar (evita surpresas com Chromium)
# &: roda em background para liberar o shell e executar o Node em seguida
Xvfb "${DISPLAY}" -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &

# Pequena pausa para o socket do display existir antes do Node abrir o browser.
sleep 2

# exec substitui o processo do shell pelo Node: o Node vira PID 1 (sinais SIGTERM chegam certo no app).
exec node dist/server.js
