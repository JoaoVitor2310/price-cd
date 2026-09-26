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

# ---------------------------------------------------------------------------
# Qual app sobe: o Express (atual) ou o Nest (migração — docs/NEST.md).
#
# O cutover é esta variável, e o rollback também: trocar o valor e reiniciar o
# container. Sem rebuild, sem revert de commit, sem deploy. É o que torna a
# troca reversível em um comando — e a razão de ela não ser um `exec` fixo.
#
# Default `express` de propósito: o merge deste PR não muda nada em produção.
# A troca acontece na VPS, deliberadamente, e é observada por 1–2 semanas antes
# de o Express ser removido (PR 10).
#
# ⚠️ Um app por container, sempre. O `mem_limit: 2g` e o `pids_limit: 512` do
# docker-compose existem por causa do OOM de 2026-08-24; dois processos Node com
# Chromium próprio dentro desse teto é convite para repetir o incidente.
# Comparação lado a lado acontece no CI e em dev, nunca aqui.
# ---------------------------------------------------------------------------
# Minúsculas: quem edita isto no `.env` da VPS não deve ser punido por digitar
# "Nest". Valor desconhecido continua falhando alto — a tolerância é com a
# caixa, não com o conteúdo.
#
# `${var,,}` é expansão do bash, não `echo | tr`: sem subshell, e sem o risco de
# um valor como `-n` ser engolido como flag do `echo` (viraria string vazia, e a
# mensagem de erro sairia sem dizer o que estava errado).
APP_ENTRYPOINT="${APP_ENTRYPOINT:-express}"
APP_ENTRYPOINT="${APP_ENTRYPOINT,,}"

case "${APP_ENTRYPOINT}" in
	express) ENTRYPOINT_FILE="dist/server.js" ;;
	nest)    ENTRYPOINT_FILE="dist/main.js" ;;
	*)
		echo "❌ Invalid APP_ENTRYPOINT: '${APP_ENTRYPOINT}'. Use 'express' or 'nest'." >&2
		exit 1
		;;
esac

echo "🚀 Starting the ${APP_ENTRYPOINT} app (${ENTRYPOINT_FILE})"

# exec substitui o processo do shell pelo Node: o Node vira PID 1 (sinais SIGTERM chegam certo no app).
exec node "${ENTRYPOINT_FILE}"
