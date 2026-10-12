/**
 * 「当前套餐」的判定。
 *
 * 一个用户身上能挂两个套餐：后台绑的 users.plan_id，与自己订阅出来的 subscriptions 行。
 * 面板上显示哪一个，取决于一条判据：有生效订阅以订阅为准，只有绑定就退回绑定的那一档。
 *
 * 这条判据在两处都要用：浏览器里的面板（手里已经有 /user/plans 与 /user/me 的结果）
 * 和本机服务端（内部密钥校验端点要拿这个用户的计价口径）。所以抽到这里，
 * 两边共用一份，免得改了一处另一处还是旧口径。
 *
 * 这里只有判定，不查库、也不依赖接口形状：查库在 src/lib/api-key-lookup.ts，
 * 浏览器那边把已经取回来的对象递进来。
 */
export function pickCurrentPlan<T>(bySubscription: T | null, byBinding: T | null): T | null {
  return bySubscription ?? byBinding;
}
