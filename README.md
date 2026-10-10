# tokenmp/web

TokenMP 销售控制台的前端。栈是 SolidStart 2、Tailwind CSS v4、TypeScript，包管理器用 Bun。

界面参照线上 tokenmp.top 复刻，令牌与组件清单见 [DESIGN.md](DESIGN.md)。

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

## 目录

| 路径 | 内容 |
| --- | --- |
| [src/routes](src/routes) | 文件路由，`index.tsx` 是登录页，`dashboard.tsx` 是控制台布局 |
| [src/components/ui](src/components/ui) | 基础组件，shadcn/ui 写法 |
| [src/components/layout](src/components/layout) | 控制台外壳 |
| [src/store](src/store) | 外观偏好 |
| [src/lib](src/lib) | 类名合并与数字格式化 |
