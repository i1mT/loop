# Loop 网关（Node + PostgreSQL + S3 自托管）。
# 多阶段：先在完整依赖里构建，再只把运行所需的产物与依赖放进最终镜像。
FROM node:24-slim AS build
WORKDIR /app

# 只允许工作区声明的原生依赖构建脚本执行，其余依赖脚本保持禁用。
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/daemon/package.json apps/daemon/package.json
COPY packages/core/package.json packages/core/package.json
# 根 postinstall 会构建 packages/core，需要先有脚本与源码。
COPY scripts ./scripts
COPY packages/core ./packages/core
RUN pnpm install --frozen-lockfile

COPY . .
# SDK 是公开静态文件（public/sdk.js），Node 目标也要一并产出。
RUN pnpm --filter @loop/web run build:sdk \
 && pnpm --filter @loop/web run build:node

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# 运行期只带构建产物、SDK 静态文件与入口；不复制源码与测试。
COPY --from=build /app/apps/web/node/dist /app/apps/web/node/dist
COPY --from=build /app/apps/web/public /app/apps/web/public
COPY --from=build /app/apps/web/server.mjs /app/apps/web/server.mjs
COPY --from=build /app/apps/web/lib /app/apps/web/lib
COPY --from=build /app/apps/web/package.json /app/apps/web/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/web/node_modules /app/apps/web/node_modules
COPY --from=build /app/packages/core /app/packages/core

# 迁移与建号脚本在容器内用同一套 DATABASE_URL 运行。
COPY --from=build /app/scripts /app/scripts

# 运行期需要以非 root 读取源码形式的服务端模块。
RUN chown -R node:node /app

USER node
# EXPOSE 只是声明，实际监听端口由 PORT 决定（compose 会把同一个值用于监听与映射）。
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.mjs"]
