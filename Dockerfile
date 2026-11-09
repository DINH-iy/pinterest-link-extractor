FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY app.mjs server.mjs extractor.mjs board-media.mjs errors.mjs ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
USER node
EXPOSE 3100
CMD ["node", "server.mjs"]
