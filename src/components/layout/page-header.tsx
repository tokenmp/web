import { children, For, Show, type JSX } from "solid-js";

/** 页面头部：一句说明加右侧操作区。
 * 页面名已经在顶栏显示，这里不再重复放一遍大标题。 */
export function PageHeader(props: {
  description?: string;
  children?: JSX.Element;
}) {
  // props.children 是个懒求值的 getter，写两次（Show 里判断一次、渲染时再来一次）
  // 会让同一批 JSX 元素被求值两遍；Solid 只允许一个元素实例挂到 DOM 上，
  // 第二遍生成的东西会让 getNextElement 拿到失效的模板并抛 template is not a function。
  // children() 只求值一次并把结果缓存住。
  const resolved = children(() => props.children);

  return (
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Show when={props.description}>
        <p class="text-sm text-muted-foreground">{props.description}</p>
      </Show>
      <Show when={resolved()}>
        <div class="flex flex-wrap items-center gap-2">{resolved()}</div>
      </Show>
    </div>
  );
}

/** 顶部的一排指标，页面概览用 */
export function StatRow(props: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    // 手机上单列会把四张卡铺满一屏，正文要滚很久才看得到表格，所以直接两列。
    // 用 For 而不是 props.items.map()：items 传的是 stats() 这类取值函数，
    // props 上的字段是懒求值的 getter，每次读都拿回一个新数组，
    // 用 .map() 在 JSX 里展开会让同一批元素被反复创建，Solid 那边就报 template is not a function
    <div class="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <For each={props.items}>
        {item => (
          <div class="rounded-xl border bg-card p-3.5 shadow-sm sm:p-4">
            <p class="text-xs text-muted-foreground sm:text-sm">{item.label}</p>
            <p class="mt-1 text-lg font-semibold tabular-nums tracking-tight sm:mt-1.5 sm:text-xl">
              {item.value}
            </p>
            <Show when={item.hint}>
              <p class="mt-1 text-xs text-muted-foreground">{item.hint}</p>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
