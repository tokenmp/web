import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

import { solidStart } from "@solidjs/start/config";

export default defineConfig({
  plugins: [solidStart({
    // SolidStart 默认在开发服务器上挂一条工具栏（固定在页面左下角，用来翻
    // 服务端函数的入参和报错）。它盖在我们自己的界面上，局域网里拿它当调试
    // 环境用的时候很碍事，关掉。
    devOverlay: false,
  }),
    nitro(),
    tailwindcss()
  ],
  server: {
    host: true,
    port: 6789,
    // 开发服务器默认只认 localhost 与它绑定的那几个名字，从别处用域名访问会被
    // 挡下（"This host is not allowed"）。局域网里用域名指到这台机器调试时，
    // 把域名加进来即可。
    allowedHosts: ["tokenmp.dev"],
  },
});
