# syntax=docker/dockerfile:1
#
# node:*-alpine is musl libc - @contentauth/c2pa-node only ships prebuilt
# native binaries for glibc targets (x86_64-unknown-linux-gnu /
# aarch64-unknown-linux-gnu, see its postinstall.cjs getPlatform()), so
# Alpine would fall through to attempting a from-source Rust build during
# `npm ci`, which isn't set up here. Using node:24-slim (Debian, glibc)
# instead - confirmed by actually building and running this image, not
# just by reading the postinstall script.
FROM node:24-slim AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No NEXT_PUBLIC_* build args - this project has no client Firebase SDK and
# nothing else that needs baking into the client bundle at build time.
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs pixeltruth

COPY --from=builder /app/public ./public
COPY --from=builder --chown=pixeltruth:nodejs /app/.next/standalone ./
COPY --from=builder --chown=pixeltruth:nodejs /app/.next/static ./.next/static

USER pixeltruth
EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
