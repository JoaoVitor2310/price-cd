#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUM=99
export DISPLAY=":${DISPLAY_NUM}"

rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}"

Xvfb ":${DISPLAY_NUM}" -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &

sleep 2

# Interruptor `APP_ENTRYPOINT`, igual ao do `start.sh` (produção), para o
# container de dev conseguir rodar os dois apps. Sem isto, exercitar o Nest em
# container exigiria editar este arquivo. Ambos são cobertos por
# `test/unit/docker/entrypoint.test.ts`.
APP_ENTRYPOINT="${APP_ENTRYPOINT:-express}"
APP_ENTRYPOINT="${APP_ENTRYPOINT,,}"

case "${APP_ENTRYPOINT}" in
	express) DEV_SCRIPT="dev" ;;
	nest)    DEV_SCRIPT="dev:nest" ;;
	*)
		echo "❌ Invalid APP_ENTRYPOINT: '${APP_ENTRYPOINT}'. Use 'express' or 'nest'." >&2
		exit 1
		;;
esac

echo "🚀 Starting the ${APP_ENTRYPOINT} app in dev mode (npm run ${DEV_SCRIPT})"

exec npm run "${DEV_SCRIPT}"
