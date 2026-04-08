# Imagem em duas etapas: (1) compila TypeScript, (2) imagem final só com runtime + Chromium leve.

# ---------------------------------------------------------------------------
# Estágio builder: dependências completas (inclui TypeScript) e gera dist/
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Só o manifesto primeiro: melhora cache do Docker — só reinstala node_modules se package*.json mudar.
COPY package*.json ./

# Evita que o pacote puppeteer baixe outro Chromium durante npm ci (usamos o chromium do apt na imagem final).
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Instalação reproduzível conforme package-lock.json (recomendado em CI/Docker).
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# Compila TS → dist/ e resolve aliases (@/...) via tsc-alias (script "build" no package.json).
RUN npm run build

# ---------------------------------------------------------------------------
# Estágio final: só Node produção + bibliotecas de sistema para o Chromium
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim

# Pacotes mínimos para rodar Chromium “de verdade” (UI toolkit, áudio, DRM/GBM, etc.).
# --no-install-recommends reduz tamanho; rm -rf limpa cache do apt na mesma camada (imagem menor).
RUN apt-get update && apt-get install -y --no-install-recommends \
	chromium \
	xvfb \
	fonts-liberation \
	libatk-bridge2.0-0 \
	libgtk-3-0 \
	libnss3 \
	libxss1 \
	libasound2 \
	libx11-xcb1 \
	libxcb-dri3-0 \
	libdrm2 \
	libgbm1 \
	ca-certificates \
	wget \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Produção: sem devDependencies (typescript, biome, etc. ficam de fora).
ENV NODE_ENV=production

# De novo: não baixar Chromium do Puppeteer nesta etapa.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# App usa para não iniciar Xvfb duplicado dentro do puppeteer-real-browser (ver src/lib/puppeteer-browser.ts).
ENV DOCKER=true

# Display virtual onde o start.sh sobe o Xvfb; processos filhos (Chromium) herdam ao rodar no mesmo container.
ENV DISPLAY=:99

# Qual binário o launcher deve usar (Chromium do sistema, não o bundle do Puppeteer).
ENV CHROME_PATH=/usr/bin/chromium

# Só dependências de runtime.
RUN npm ci --omit=dev

# Artefatos já compilados no estágio builder (não copiamos src/ nem node de dev).
COPY --from=builder /app/dist ./dist

# Express serve arquivos estáticos a partir de public/ (ver src/app.ts).
COPY public ./public

# Script de entrada: sobe Xvfb e depois node dist/server.js.
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Documentação: a app escuta na 5555 por padrão (mapeamento real é no docker-compose).
EXPOSE 5555

# Processo PID 1 do container: start.sh (que por fim faz exec node, substituindo o shell).
CMD ["/app/start.sh"]
