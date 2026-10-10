import { Title } from "@solidjs/meta";
import Eye from "lucide-solid/icons/eye";
import EyeOff from "lucide-solid/icons/eye-off";
import { createSignal, Show } from "solid-js";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";

type Tab = "login" | "register";

export default function LoginPage() {
  const [tab, setTab] = createSignal<Tab>("login");
  const [showPassword, setShowPassword] = createSignal(false);
  const [notice, setNotice] = createSignal("");

  const isLogin = () => tab() === "login";

  return (
    <main class="grid min-h-dvh place-items-center bg-muted/40 px-6 py-10">
      <Title>登录 | TokenMP 销售控制台</Title>

      <div class="w-full max-w-[380px] rounded-xl border bg-card p-6 shadow-sm">
        <div class="flex flex-col items-center gap-3">
          <div class="grid size-12 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">
            T
          </div>
          <h1 class="text-xl font-semibold tracking-tight">TokenMP</h1>
        </div>

        {/* 分段切换：登录 / 注册 */}
        <div class="mt-6 grid grid-cols-2 items-center gap-1 rounded-lg bg-muted p-1">
          {(["login", "register"] as const).map(value => (
            <button
              type="button"
              onClick={() => setTab(value)}
              class={cn(
                "inline-flex h-8 items-center justify-center rounded-md text-sm font-medium transition-all",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                tab() === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form
          class="mt-6 space-y-4"
          onSubmit={event => {
            event.preventDefault();
            setNotice("这是设计样板，登录接口还没有接上。");
          }}
        >
          <div class="space-y-2">
            <Label for="email">邮箱</Label>
            <Input id="email" type="email" placeholder="you@example.com" autocomplete="email" />
          </div>

          <div class="space-y-2">
            <Label for="password">密码</Label>
            <div class="relative">
              <Input
                id="password"
                type={showPassword() ? "text" : "password"}
                autocomplete={isLogin() ? "current-password" : "new-password"}
                class="pr-10"
              />
              <div class="absolute right-1 top-1/2 -translate-y-1/2">
                <button
                  type="button"
                  aria-label={showPassword() ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword(v => !v)}
                  class="hit-target grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {showPassword() ? <EyeOff class="size-4" /> : <Eye class="size-4" />}
                </button>
              </div>
            </div>
          </div>

          <Button type="submit" class="h-10 w-full">
            {isLogin() ? "登录" : "创建账号"}
          </Button>

          <Show when={notice()}>
            <p class="text-center text-sm text-muted-foreground">{notice()}</p>
          </Show>
        </form>
      </div>
    </main>
  );
}
