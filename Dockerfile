FROM node:26.13.1-bookworm-slim
WORKDIR /app
COPY server.mjs ./
COPY dist/ ./dist/
COPY submitsounds/ ./submitsounds/
ENV HOST=0.0.0.0
EXPOSE 4173
CMD ["node", "server.mjs"]