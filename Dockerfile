# tokenmp/web 的生产镜像。
#
# 三段：
#   builder       bun install + vite build，出 .output
#   runtime-deps  只装运行期真正用得上的那一个包（mysql2），见下
#   runtime       node:24-slim + .output + mysql2
#
# 运行段用 node 而不是 bun：.output 是 nitro 的 node-server 预设，产物只依赖 node 内置模块
#（依赖全被 bundle 进 .output/server/_libs），运行期不需要装业务依赖。package.json 的 start
# 本来就是 node，容器里跟着走，开发与线上是同一条路径。为此 prestart 也从 bun 改成 node：
# check-env.ts 里只有 import、顶层 await 与类型标注，node 24 起能直接执行 .ts（类型擦除）。
#
# 为什么还要单独装一份 mysql2：scripts/check-env.ts 是唯一在 .output 之外还 import 包的
# 文件（它连库确认建表脚本跑过），而它是 prestart。要么把整个 node_modules 搬进运行段
#（248MB，其中 99% 只给构建用），要么只装它。这里选后者：4.9MB，一个 stage 的代价。
#
# scripts/ 与 db/init/ 是 npm start 的两处依赖：
#   scripts/check-env.ts   prestart 会跑它
#   db/init/*.sql          check-env 找不到表时会提示「先跑一遍 db/init 下的建表脚本」

FROM oven/bun:1 AS builder
WORKDIR /app

# 先只拷清单，让依赖层能被缓存住
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# 必须显式指定 preset。nitro 不设时按「谁在跑构建」自动挑：在 bun 里跑就选 bun preset，
# 产物直接引用全局 Bun，塞进 node 运行段会 `ReferenceError: Bun is not defined`。
# 构建段是 bun 镜像，不指定就必然挑错。（本机 `bun run build` 挑到的是 node-server，
# 那是 nitro 认到了别的东西，不该赌这个。）
ENV NITRO_PRESET=node-server
RUN bun run build

# 运行期依赖：只有 mysql2。版本跟着 package.json 走，不在这里写死。
FROM oven/bun:1 AS runtime-deps
WORKDIR /rt
COPY package.json ./package.json
RUN printf '{"name":"tokenmp-web-runtime","private":true,"dependencies":{"mysql2":"%s"}}' \
      "$(bun -e 'console.log(require("./package.json").dependencies.mysql2)')" > minimal.json \
 && mv minimal.json package.json \
 && bun install --production

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/db ./db
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.env.example ./.env.example
COPY --from=runtime-deps /rt/node_modules ./node_modules

EXPOSE 3000
CMD ["npm", "start"]
