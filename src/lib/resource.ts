import { createSignal, onMount } from "solid-js";

/**
 * 客户端资源：挂载到浏览器之后才取数据。
 *
 * 不用 createResource 是因为它在 SSR 阶段也会执行 —— 服务端没有 base URL，
 * 相对路径的 fetch 会直接抛「Failed to parse URL」。这些都是登录后才看的
 * 数据，晚一个微任务到客户端再取，代价只是首帧没有内容。
 *
 * reload 给「操作失败后重新拉一次」用，比如通知标已读失败要跟服务端对齐。
 *
 * 失败时不保留上一次的数据：留着的话，页面上会同时出现「请求失败」和一份看不出
 * 已经过期的旧列表，读起来像「这就是现在的数据」。宁可空着配错误提示，也不要
 * 把旧结果当成本次结果。要显示旧数据的场景（筛选条件改变后的重新取数）由调用方
 * 自己决定，不在这里做。
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
      setData(() => initial);
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  onMount(reload);

  return { data, setData, loading, error, reload };
}
