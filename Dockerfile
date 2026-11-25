FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json server.mjs ./
COPY dist/ ./dist/
COPY submitsounds/ ./submitsounds/

ENV CHECKIN_HOST=0.0.0.0
EXPOSE 4173
USER node
CMD ["node", "server.mjs"]
