FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
ARG ACCESS_CODE
ENV ACCESS_CODE=${ACCESS_CODE}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:24-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
ENV NODE_ENV=production
COPY --from=builder /app ./
RUN chmod +x /app/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["pnpm", "exec", "eve", "start", "--host", "0.0.0.0", "--port", "3000"]
