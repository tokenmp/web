import { Title } from "@solidjs/meta";
import { useNavigate } from "@solidjs/router";
import Eye from "lucide-solid/icons/eye";
import EyeOff from "lucide-solid/icons/eye-off";
import { createSignal, Show } from "solid-js";

import { AnnouncementBanner } from "~/components/layout/announcement-banner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";

type Tab = "login" | "register";

export default function LoginPage() {
  const navigate = useNavigate();
  const [tab, setTab] = createSignal<Tab>("login");
  const [showPassword, setShowPassword] = createSignal(false);
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [pending, setPending] = createSignal(false);

  const isLogin = () => tab() === "login";

  const submit = async (event: Event) => {
    event.preventDefault();
    if (pending()) return;
    setNotice("");
    setPending(true);
    try {
      const res = await fetch(isLogin() ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email(), password: password() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data.error ?? "请求失败，请稍后再试");
        return;
      }
      // cookie 已经由服务端种下，直接进控制台
      navigate("/dashboard", { replace: true });
    } catch {
      setNotice("连不上服务器，请稍后再试");
    } finally {
      setPending(false);
    }
  };

  return (
    <main class="grid min-h-dvh place-items-center bg-muted px-6 py-10">
      <Title>登录 | TokenMP 销售控制台</Title>

      {/* 公告是公开接口，未登录也能看到「v0.1.0 正式发布」这类全站消息 */}
      <div class="w-full max-w-[380px] space-y-4">
        <AnnouncementBanner />

        <div class="rounded-xl border bg-card p-6">
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
                onClick={() => {
                  setTab(value);
                  setNotice("");
                }}
                class={cn(
                  "inline-flex h-8 items-center justify-center rounded-md text-sm font-medium transition-all",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  tab() === value
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>

          <form class="mt-6 space-y-4" onSubmit={submit}>
            <div class="space-y-2">
              <Label for="email">{isLogin() ? "邮箱或用户名" : "邮箱"}</Label>
              <Input
                id="email"
                type={isLogin() ? "text" : "email"}
                placeholder={isLogin() ? "邮箱或用户名" : "you@example.com"}
                autocomplete="username"
                value={email()}
                onInput={event => setEmail(event.currentTarget.value)}
                required
              />
            </div>

            <div class="space-y-2">
              <Label for="password">密码</Label>
              <div class="relative">
                <Input
                  id="password"
                  type={showPassword() ? "text" : "password"}
                  autocomplete={isLogin() ? "current-password" : "new-password"}
                  class="pr-10"
                  value={password()}
                  onInput={event => setPassword(event.currentTarget.value)}
                  required
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

            <Button type="submit" class="h-10 w-full" disabled={pending()}>
              {pending() ? (isLogin() ? "登录中…" : "创建中…") : isLogin() ? "登录" : "创建账号"}
            </Button>

            <Show when={notice()}>
              <p class="text-center text-sm text-destructive-text" role="alert">
                {notice()}
              </p>
            </Show>
          </form>
        </div>
      </div>
    </main>
  );
}
