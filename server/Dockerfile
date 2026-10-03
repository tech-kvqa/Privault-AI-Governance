# NOTE: written but not built in the environment this repo was developed in (no Docker there).
# The commands inside it — generate, migrate, start — were each run for real on the host.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
COPY prisma.config.ts ./
# Rust-free Prisma client: generated with the WASM schema engine, so no engine binary is downloaded.
RUN npx prisma generate

COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 CMD wget -qO- http://127.0.0.1:4100/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
