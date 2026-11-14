FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node server.js ./server.js
COPY --chown=node:node public ./public
COPY --chown=node:node lib ./lib
COPY --chown=node:node db ./db

EXPOSE 3000
USER node
CMD ["npm", "start"]
