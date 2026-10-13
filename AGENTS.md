# AGENTS.md

在本仓库工作的规则。

## 项目

TokenMP 的销售控制台与后端，Bun + TypeScript（SolidStart + Vite），数据在 MySQL。
模块名 `tokenmp-web`，Node 引擎不低于 `>=24`。

```
src/routes/       页面与 HTTP 端点，一个文件一个路由
src/lib/          数据访问与业务逻辑，不含 JSX
src/components/   界面组件
db/init/          建表脚本，按序号执行
scripts/          开发与校验脚本
tests/            接口测试与浏览器测试
docs/             数据对接与缺口记录
```

## 命令

```
bun run dev        # 开发服务器
bun run typecheck  # 类型检查
bun run test       # 测试
bun run build      # 生产构建
bun run start      # 运行生产构建
```

改动后必须跑 `bun run typecheck && bun run test` 并保持全绿。

## 分层

- 路由只做参数校验与响应组装，数据访问放在 `src/lib/`。
- 一个资源的数据访问集中在一个文件里，不允许多处各自实现同一张表的读写。
- 扣费与账本的写入只在摄入路径上发生，页面不直接改余额。

## 约定

- 注释与用户可见文案使用中文。
- 注释写取舍与原因，不复述代码在做什么。
- 数据库连接、回调密钥等一律从环境变量读，配置文件只放 `.env.example` 里的占位值。
- 新增依赖要写清它替代了什么，以及为什么不能自己写或不用。

## 测试

- 接口测试直接调路由的处理函数，要连真库（CI 用 service 容器起 MySQL）。
- 浏览器测试用 Playwright，浏览器缓存在 `~/.cache/ms-playwright`，需要时先装。

## 文档

仓库内容默认公开，文档按职责分流：

| 文件 | 职责 |
| --- | --- |
| `README.md` | 运行方式、接口现状、账本口径、几个取舍 |
| `DESIGN.md` | 界面设计规范：令牌、组件、排版 |
| `openapi.yaml` | 接口契约，改动等同对外的接口承诺 |
| `docs/gaps.md` | 功能缺口清单，按设计保留为当时的记录，不随之更新 |
| `docs/` | 数据对接等专题说明 |
| `AGENTS.md` | 本文件：工作规则 |

规则：

- **不写本机与环境特定信息**：账号名、主机名、本机路径、网络环境、代理与镜像源、
  自己实测的网速与耗时、登录状态、密钥、本地配置。文档描述仓库本身，不描述某台机器
  或某次环境。通用的 PATH 惯例（`~/.config`、`~/.cache`）不算本机信息。
- 只陈述仓库中已经存在的事实。计划、进度、待办与设计推演写进 `docs/gaps.md`，
  不写进 `README.md` 与 `DESIGN.md`。
- 功能先实现，再更新文档；路由、字段、行为的变更与文档同步。
- 实现取舍写进对应源文件的注释，不写进公开文档。
- 文案与提交信息不使用对话式指代（你 / 我 / 咱们），只陈述代码与事实。
- 文档里的行内代码块与表格不受行长限制，正文每行控制在 40 到 60 个字。

### 接口文档的两套后端

`openapi.yaml` 同时描述线上与本机两套实现，每个操作用 `x-implemented` 标记：
`local`（两边都有）、`local-only`（只有本机，如系统版本、公告、通知）、
`remote`（只在线上，本机没有表也没有路由）。新增端点必须给出这个标记。

## GitHub 协作

`gh` CLI 操作 Issue 与 PR，不经网页手工编辑：

- **不直接推送 `main`**：一切改动走分支。
- 取任务：`gh issue list` / `gh issue view <n>`；
  新建：`gh issue create -t "<type>: <标题>" -b "<现象、期望、验收条件>"`
- 实现走分支：`git checkout -b <type>/<短描述>`，完成后 `gh pr create`，
  标题符合 Conventional Commits，正文写 `Closes #<n>` —— **不用 `Refs #<n>`**，
  `Refs` 只会留下交叉引用，合并后 issue 仍开着，看板就落后于代码。
- 合并前置：`bun run typecheck && bun run test` 全绿，CI 通过。
- 改动属于哪个仓库先想清楚：命令行、配置读写、密钥鉴权、算金额归 cli；
  协议转换、选路、重试归 core。

## 提交

使用 Conventional Commits（`<type>(<scope>): <描述>`）。
