import { MetaProvider } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { onMount, Suspense } from "solid-js";

import "./app.css";
import { initTheme } from "~/store/theme";

export default function App() {
  // 主题偏好只在客户端生效：SSR 用默认浅色，首屏闪白由 entry-server.tsx 的内联脚本挡住
  onMount(initTheme);

  return (
    <Router
      root={props => (
        <MetaProvider>
          <Suspense>{props.children}</Suspense>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
