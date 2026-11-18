FROM node:22-slim

WORKDIR /app

# Primero solo los archivos de dependencias (aprovecha la caché de Docker)
COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .
RUN mkdir -p public/img && chown -R node:node /app

ENV NODE_ENV=production
EXPOSE 3000
USER node

CMD ["node", "server.js"]