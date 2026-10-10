import { Title } from "@solidjs/meta";
import { A } from "@solidjs/router";
import { For, type JSX } from "solid-js";

import { ThemeToggle } from "~/components/layout/app-shell";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";

const colors = [
  { name: "--background", use: "页面底色" },
  { name: "--foreground", use: "正文" },
  { name: "--card", use: "卡片、侧边栏、弹层" },
  { name: "--primary", use: "主按钮、进度条、趋势线" },
  { name: "--secondary", use: "次级底、悬停底" },
  { name: "--muted", use: "弱化区块、表头底" },
  { name: "--muted-foreground", use: "说明文字" },
  { name: "--accent", use: "菜单悬停" },
  { name: "--border", use: "边框" },
  { name: "--input", use: "输入框描边" },
  { name: "--ring", use: "聚焦环" },
  { name: "--success-text", use: "已支付、正向变化" },
  { name: "--warning-text", use: "待支付、提醒" },
  { name: "--destructive-text", use: "已退款、负向变化" },
];

const typeScale = [
  { cls: "text-xs", label: "12px", use: "表头、辅助说明" },
  { cls: "text-sm", label: "14px", use: "正文、表格、按钮" },
  { cls: "text-base", label: "16px", use: "顶栏页名、移动端输入" },
  { cls: "text-xl", label: "20px", use: "卡片标题、登录页品牌名" },
  { cls: "text-2xl", label: "24px", use: "指标卡数值、页面大标题" },
];

const layout = [
  { area: "导航", desktop: "左侧固定侧边栏，宽 240px，右侧 1px 边框", mobile: "抽屉，宽 256px，遮罩点击关闭" },
  { area: "顶栏", desktop: "高 56px，粘顶，半透明加毛玻璃", mobile: "同左，左侧多一个汉堡按钮" },
  { area: "内容区", desktop: "左边距 240px，内边距 24px", mobile: "内边距 16px 到 20px" },
  { area: "主题切换", desktop: "侧边栏底部，带文字", mobile: "顶栏右侧，只有图标" },
];

const pages = [
  { route: "/", name: "登录", status: "done" },
  { route: "/dashboard", name: "概览", status: "done" },
  { route: "/design", name: "设计系统", status: "done" },
  { route: "/dashboard/users", name: "用户列表", status: "todo" },
  { route: "/dashboard/balances", name: "余额", status: "todo" },
  { route: "/dashboard/api-keys", name: "API 密钥", status: "todo" },
  { route: "/dashboard/plans", name: "套餐", status: "todo" },
  { route: "/dashboard/billing", name: "计费", status: "todo" },
  { route: "/dashboard/channels", name: "渠道", status: "todo" },
  { route: "/dashboard/channel-groups", name: "渠道分组", status: "todo" },
  { route: "/dashboard/channel-applications", name: "渠道申请", status: "todo" },
];

export default function DesignSystem() {
  return (
    <main class="min-h-dvh bg-background">
      <Title>设计系统 | TokenMP 销售控制台</Title>

      <header class="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div class="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 lg:px-6">
          <div class="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            T
          </div>
          <h1 class="font-semibold tracking-tight">设计系统</h1>
          <span class="hidden text-sm text-muted-foreground sm:inline">
            令牌、组件、布局、页面
          </span>
          <div class="ml-auto flex items-center gap-1">
            <ThemeToggle compact />
            <A href="/dashboard" class={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              控制台
            </A>
          </div>
        </div>
      </header>

      <div class="mx-auto max-w-5xl space-y-10 px-4 py-8 lg:px-6">
        <Section
          title="颜色"
          hint="色值以 HSL 存在 CSS 变量里，切换深浅色时同一块色板会跟着变。"
        >
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <For each={colors}>
              {token => (
                <Card class="overflow-hidden">
                  <div
                    class="h-16 border-b ring-1 ring-inset ring-foreground/10"
                    style={{ background: `hsl(var(${token.name}))` }}
                  />
                  <div class="p-3">
                    <p class="font-mono text-xs">{token.name}</p>
                    <p class="mt-1 text-sm text-muted-foreground">{token.use}</p>
                  </div>
                </Card>
              )}
            </For>
          </div>
        </Section>

        <Section title="排版" hint="系统字体栈，中文走 PingFang SC 与 Microsoft YaHei。">
          <Card class="divide-y">
            <For each={typeScale}>
              {row => (
                <div class="flex items-baseline justify-between gap-4 p-4">
                  <span class={cn(row.cls, "font-medium")}>TokenMP 销售控制台</span>
                  <span class="shrink-0 text-xs text-muted-foreground">
                    {row.cls} · {row.label} · {row.use}
                  </span>
                </div>
              )}
            </For>
          </Card>
        </Section>

        <Section title="按钮" hint="六种变体，四种尺寸，禁用态统一 50% 透明度。">
          <Card class="space-y-4 p-5">
            <div class="flex flex-wrap gap-2">
              <Button>主要</Button>
              <Button variant="secondary">次级</Button>
              <Button variant="outline">描边</Button>
              <Button variant="ghost">幽灵</Button>
              <Button variant="destructive">危险</Button>
              <Button variant="link">链接</Button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Button size="sm">sm</Button>
              <Button size="default">default</Button>
              <Button size="lg">lg</Button>
              <Button disabled>禁用</Button>
            </div>
          </Card>
        </Section>

        <Section title="徽标" hint="状态用低透明度底色加同色文字，深浅色下都保持可读。">
          <Card class="flex flex-wrap gap-2 p-5">
            <Badge>默认</Badge>
            <Badge variant="secondary">次级</Badge>
            <Badge variant="outline">描边</Badge>
            <Badge variant="success">已支付</Badge>
            <Badge variant="warning">待支付</Badge>
            <Badge variant="destructive">已退款</Badge>
          </Card>
        </Section>

        <Section title="输入" hint="移动端 16px 高 40px，桌面 14px 高 36px。">
          <Card class="max-w-md space-y-4 p-5">
            <div class="space-y-2">
              <Label for="demo-email">邮箱</Label>
              <Input id="demo-email" placeholder="you@example.com" />
            </div>
            <div class="space-y-2">
              <Label for="demo-disabled">已停用</Label>
              <Input id="demo-disabled" value="不可编辑" disabled />
            </div>
          </Card>
        </Section>

        <Section title="布局" hint="断点 1024px，宽屏用固定侧边栏，窄屏换成抽屉。">
          <Card class="overflow-x-auto">
            <table class="w-full min-w-[640px] text-sm">
              <thead>
                <tr class="border-b bg-muted/50 text-muted-foreground">
                  <Th>区域</Th>
                  <Th>桌面</Th>
                  <Th>移动</Th>
                </tr>
              </thead>
              <tbody>
                <For each={layout}>
                  {row => (
                    <tr class="border-b last:border-0">
                      <Td class="font-medium">{row.area}</Td>
                      <Td class="text-muted-foreground">{row.desktop}</Td>
                      <Td class="text-muted-foreground">{row.mobile}</Td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Card>
        </Section>

        <Section title="页面" hint="路由按文件生成，新增或删除路由文件之后要重启开发服务器。">
          <Card class="overflow-x-auto">
            <table class="w-full min-w-[520px] text-sm">
              <thead>
                <tr class="border-b bg-muted/50 text-muted-foreground">
                  <Th>路由</Th>
                  <Th>页面</Th>
                  <Th>状态</Th>
                </tr>
              </thead>
              <tbody>
                <For each={pages}>
                  {page => (
                    <tr class="border-b last:border-0">
                      <Td class="font-mono text-xs">{page.route}</Td>
                      <Td>{page.name}</Td>
                      <Td>
                        <Badge variant={page.status === "done" ? "success" : "secondary"}>
                          {page.status === "done" ? "已实现" : "待做"}
                        </Badge>
                      </Td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Card>
        </Section>
      </div>
    </main>
  );
}

function Section(props: { title: string; hint: string; children: JSX.Element }) {
  return (
    <section class="space-y-3">
      <div>
        <h2 class="text-lg font-semibold tracking-tight">{props.title}</h2>
        <p class="text-sm text-muted-foreground">{props.hint}</p>
      </div>
      {props.children}
    </section>
  );
}

function Th(props: { children: JSX.Element }) {
  return <th class="px-5 py-2.5 text-left font-medium">{props.children}</th>;
}

function Td(props: { children: JSX.Element; class?: string }) {
  return <td class={cn("px-5 py-3", props.class)}>{props.children}</td>;
}
