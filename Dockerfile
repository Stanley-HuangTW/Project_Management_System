FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY . .
# prisma generate only needs DATABASE_URL to be defined (it validates the
# schema's env() reference, but never connects) — the real value is
# supplied at runtime via docker-compose.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db"
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/server.js ./server.js
# server.js 用 next({dev: false}) 這個自訂 server 的方式啟動——這個路徑
# 會在執行期重新讀 next.config.ts 決定 experimental 設定(例如 Server
# Actions 的 bodySizeLimit),不是只看 build 時算好放進 .next 裡的那份。
# 漏了這一行,容器裡完全沒有這個檔案,Server Actions 的請求大小上限會
# 悄悄退回 Next.js 預設的 1MB,匯入稍大的 Excel 檔就會被擋下來。
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
