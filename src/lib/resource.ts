import { createSignal, onMount } from "solid-js";

/**
 * 客户端资源：挂载到浏览器之后才取数据。
 *
 * 不用 createResource 是因为它在 SSR 阶段也会执行 —— 服务端没有 base URL，
 * 相对路径的 fetch 会直接抛「Failed to parse URL」。这些都是登录后才看的
 * 数据，晚一个微任务到客户端再取，代价只是首帧没有内容。
 *
 * reload 给「操作失败后重新拉一次」用，比如通知标已读失败要跟服务端对齐。
 */
export function createClientResource<T>(loader: () => Promise<T>, initial: T) {
  const [data, setData] = createSignal<T>(initial);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      // 先 await 再 set：直接把 async 函数交给 setData，信号会把它当成更新函数
      const value = await loader();
      setData(() => value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  onMount(reload);

  return { data, setData, loading, error, reload };
}
