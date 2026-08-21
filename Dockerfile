# ====== Build ======
# Imagem base estavel com Node 20 (LTS)
FROM node:20-alpine AS build

WORKDIR /app

# Copia so os manifests primeiro (cache melhor de camada)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ====== Runtime ======
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data

# Copia as dependencias da fase build
COPY --from=build /app/node_modules ./node_modules

# Copia o codigo da aplicacao
COPY . .

# Diretorio de dados persistente (montado como volume no fly.toml)
RUN mkdir -p /data

# Porta usada pelo server.js (keep-alive / health check)
EXPOSE 3000

# Inicia o bot
CMD ["node", "index.js"]