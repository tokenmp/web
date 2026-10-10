import { Show, type JSX } from "solid-js";

/** 分节标题加一句说明。页面把长表单、列表按主题切开时用 */
export function Section(props: {
  title: string;
  caption?: string;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <section class={props.class}>
      <div class="mb-2">
        <h2 class="text-sm font-semibold">{props.title}</h2>
        <Show when={props.caption}>
          <p class="mt-0.5 text-xs text-muted-foreground">{props.caption}</p>
        </Show>
      </div>
      {props.children}
    </section>
  );
}
