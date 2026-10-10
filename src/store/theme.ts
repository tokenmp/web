import { createSignal } from "solid-js";

export type ThemeMode = "light" | "dark" | "system";

/** 与线上控制台同一个存储键，便于两个版本共享偏好 */
const STORAGE_KEY = "tokenmp.theme";

function isMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

const [mode, setModeSignal] = createSignal<ThemeMode>("system");
// 系统外观做成信号：SSR 时是 false，客户端 initTheme 里同步真值，
// 这样"跟随系统"下的图标与文案会跟着更新，而不是停留在服务端渲染的那一份
const [systemDark, setSystemDark] = createSignal(false);

/** 把模式落到 <html class="dark"> 上，与 entry-server.tsx 的内联脚本用同一套判断 */
function apply(next: ThemeMode) {
  if (typeof document === "undefined") return;
  const dark = next === "dark" || (next === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** 读取已持久化的偏好，并订阅系统主题变化 */
export function initTheme() {
  if (typeof window === "undefined") return;

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  setSystemDark(media.matches);

  const stored = window.localStorage.getItem(STORAGE_KEY);
  const initial: ThemeMode = isMode(stored) ? stored : "system";
  setModeSignal(initial);
  apply(initial);

  media.addEventListener("change", event => {
    setSystemDark(event.matches);
    if (mode() === "system") apply("system");
  });
}

export function setTheme(next: ThemeMode) {
  setModeSignal(next);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next);
  }
  apply(next);
}

/** 在浅色与深色之间切换，system 视作跟随当前系统结果 */
export function toggleTheme() {
  const dark = mode() === "dark" || (mode() === "system" && systemDark());
  setTheme(dark ? "light" : "dark");
}

export function themeMode() {
  return mode();
}

/** 当前实际生效的外观，用于给切换按钮选图标 */
export function resolvedTheme(): "light" | "dark" {
  return mode() === "dark" || (mode() === "system" && systemDark()) ? "dark" : "light";
}
