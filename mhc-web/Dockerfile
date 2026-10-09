# 模型健康监控中心 - Web 前端 (Next.js 15)
# 固定基础镜像 digest：避免依赖镜像站 tag 解析（hub-mirror 不可达时也能用本地层缓存构建）
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build
FROM base AS builder
WORKDIR /app
# NEXT_PUBLIC_* 变量在构建时内联到浏览器 bundle，需作为构建参数传入
ARG NEXT_PUBLIC_MHC_HOST
ENV NEXT_PUBLIC_MHC_HOST=$NEXT_PUBLIC_MHC_HOST
ARG NEXT_PUBLIC_MHC_API_PORT
ENV NEXT_PUBLIC_MHC_API_PORT=$NEXT_PUBLIC_MHC_API_PORT
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
