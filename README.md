# tokenmp/web

TokenMP 销售控制台的前端。栈是 SolidStart 2、Tailwind CSS v4、TypeScript，包管理器用 Bun。

界面参照线上 tokenmp.top 复刻，令牌与组件清单见 [DESIGN.md](DESIGN.md)。

## 本地数据库

控制台的用户数据放在一个本地 MySQL 里，用 docker compose 起：

```bash
sudo docker compose up -d      # 起库，映射到宿主 3307
sudo docker compose down       # 停库
sudo docker compose down -v    # 停库并清空数据
```

首次启动会自动执行 [db/init/01-schema.sql](db/init/01-schema.sql) 建表。

> 本地这个账号不在 `docker` 组里，所以命令前面得加 `sudo`。要免掉的话：
> `sudo usermod -aG docker $USER`，然后重新登录。

库里的用户是从线上搬过来的，密码哈希原样保留，所以线上账号在本地也能登录。数据来源和字段含义见 [src/lib/schema.ts](src/lib/schema.ts) 的注释。

## 登录

[src/routes/index.tsx](src/routes/index.tsx) 是登录页。登录状态存在 `tokenmp_session` 这个 httpOnly cookie 里（JWT，7 天），`/dashboard` 下的页面都要求登录，没登录会被送回登录页。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | `{email, password}`，`email` 一栏也接受用户名；返回 `{token, user}` |
| POST | `/api/auth/register` | `{email, password, name?}` |
| GET | `/api/auth/me` | 读 cookie 返回当前用户 |
| POST | `/api/auth/logout` | 清 cookie |

几处需要注意的地方：

- 密码用 bcrypt 校验。线上库里的哈希混了 `$2a$10$`、`$2b$10$`、`$2y$12$` 三种前缀（`$2y$` 是 PHP 那套的风格），bcryptjs 三种都能验，已逐条确认。
- 会话是无状态 JWT，改密码后靠 `users.token_version` 把旧会话顶掉。
- 接口形状是照着线上 Go 后端拄的（`/auth/login` 返回 `{token, user}`）。
- 线上注册要先调 `/auth/send-code` 发邮箱验证码，本地没有邮件服务，注册接口直接建账号，只适合开发环境用。

## 开发

```bash
bun install
bun run dev
```

开发服务器绑定 `0.0.0.0:6789`，本机和同一局域网的其他设备都能打开，局域网地址用 `hostname -I` 里的那个。

| 场景 | 地址 |
| --- | --- |
| 本机 | `http://localhost:6789` |
| 局域网其他设备 | `http://<本机局域网 IP>:6789` |

新增或删除 `src/routes/` 下的文件后要重启开发服务器。文件监听会刷新页面，但不会重新生成路由表。

装依赖走本机的 mihomo 代理会快很多，直连 `registry.npmjs.org` 只有百来 KB/s。

```bash
with-proxy bun install
```

## 构建

```bash
bun run build     # 产出到 .output
bun run start     # 运行生产构建
```

## Solid 的一个坑

props 上的字段是惰性 getter。同一个 JSX 类型的 prop 在一处读两遍，比如 `<Show when={props.children}>` 判断一次、渲染时再取一次，会让同一批 JSX 元素被求值两遍并创建成两个实例。Solid 只允许一个元素实例挂到 DOM 上，第二次插入就让整个页面报 `template is not a function` 然后一片空白，控制台里的报错还只在某个微任务里出现，现象看着像随机。

页头、指标行、弹窗这三个共享组件都踩了这个坑：前两个读了两遍 children，弹窗里 `props.footer ?? 默认值` 加上 `<Show when={props.children}>` 也是两遍。因为分享件，一开始看上去像是那几个用到了共享件的页面各自出了毛病，跟图标、缓存、HMR 都不相关。现在都改成只读一遍，八个页面跟生产构建都正常。

要给子组件传 JSX 时，用 `children(() => props.children)` 求值一次并把结果缓存住，或者安排每个 JSX prop 只在一个地方出现。

## 目录

| 路径 | 内容 |
| --- | --- |
| [src/routes](src/routes) | 文件路由，`index.tsx` 是登录页，`dashboard.tsx` 是控制台布局，`api/auth/` 是登录相关接口 |
| [src/components/ui](src/components/ui) | 基础组件，shadcn/ui 写法 |
| [src/components/layout](src/components/layout) | 控制台外壳 |
| [src/store](src/store) | 外观偏好 |
| [src/lib](src/lib) | 类名合并、数字格式化、数据库连接与认证 |
| [docker-compose.yml](docker-compose.yml) | 本地开发用的 MySQL |
| [db/init](db/init) | 建表脚本，容器首次启动时执行 |
