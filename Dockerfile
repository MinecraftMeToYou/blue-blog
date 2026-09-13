FROM node:24-alpine

WORKDIR /app

COPY package.json server.js ./
COPY lib ./lib
COPY routes ./routes
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/themes >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
