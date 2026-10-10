/**
 * 面板里各种状态值到徽标的映射。
 *
 * 返回的是本机 Badge 的 variant，不另造一套配色 —— 线上的语义色（emerald/amber/red/blue）
 * 在这里换成设计令牌：success / warning / destructive 三个 tinted 变体，
 * 已经按 AA 对比度调过，深色模式下会自动提亮。
 *
 * info 用 outline（带描边、无底色）：本机令牌里没有蓝色，用描边跟 secondary 的灰底区分开。
 * muted 与 secondary 都落成 secondary。
 */
export type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "destructive";

export type BadgeMeta = { label: string; variant: BadgeVariant };

/** 余额流水的来源 */
export function txSourceMeta(source: string): BadgeMeta {
  switch (source) {
    case "recharge":
      return { label: "充值", variant: "success" };
    case "adjust":
      return { label: "调账", variant: "outline" };
    case "usage":
      return { label: "消费", variant: "destructive" };
    case "channel_share":
      return { label: "渠道分成", variant: "success" };
    case "subscription":
      return { label: "订阅", variant: "outline" };
    default:
      return { label: source, variant: "secondary" };
  }
}

/** 扣的是订阅额度还是余额 */
export function ledgerMeta(ledger: string): BadgeMeta {
  if (ledger === "quota") return { label: "额度", variant: "outline" };
  if (ledger === "balance") return { label: "余额", variant: "secondary" };
  return { label: ledger, variant: "secondary" };
}

export function billingStatusMeta(status: string): BadgeMeta {
  if (status === "success") return { label: "成功", variant: "success" };
  if (status === "error") return { label: "失败", variant: "destructive" };
  return { label: status, variant: "secondary" };
}

/** 请求记录状态。in_progress 是「已记录、回调还没回来」，排查请求有没有进来时用得上 */
export function requestStatusMeta(status: string): BadgeMeta {
  if (status === "in_progress") return { label: "请求中", variant: "outline" };
  if (status === "success") return { label: "成功", variant: "success" };
  if (status === "error") return { label: "失败", variant: "destructive" };
  return { label: status, variant: "secondary" };
}

export function keyStatusMeta(status: number): BadgeMeta {
  if (status === 1) return { label: "启用", variant: "success" };
  if (status === 0) return { label: "停用", variant: "destructive" };
  return { label: String(status), variant: "secondary" };
}

export function planModeMeta(mode: string): BadgeMeta {
  if (mode === "subscription") return { label: "订阅", variant: "outline" };
  if (mode === "pay_as_you_go") return { label: "按量", variant: "secondary" };
  return { label: mode, variant: "secondary" };
}

export function pricingModeMeta(mode: string): BadgeMeta {
  if (mode === "markup") return { label: "倍率加价", variant: "outline" };
  if (mode === "table") return { label: "模型单价", variant: "secondary" };
  return { label: mode, variant: "secondary" };
}

/** 分享渠道申请单 */
export function appStatusMeta(status: string): BadgeMeta {
  if (status === "pending") return { label: "待审核", variant: "warning" };
  if (status === "approved") return { label: "已通过", variant: "success" };
  if (status === "rejected") return { label: "已驳回", variant: "destructive" };
  return { label: status, variant: "secondary" };
}

/** 分享账号的探测/上架状态 */
export function shareStateMeta(state: string): BadgeMeta {
  switch (state) {
    case "online":
      return { label: "已上架", variant: "success" };
    case "probing":
      return { label: "探测中", variant: "warning" };
    case "failed":
      return { label: "探测失败", variant: "destructive" };
    case "offline":
      return { label: "未上架", variant: "secondary" };
    default:
      return { label: state, variant: "secondary" };
  }
}

/** 账号属主来源 */
export function accountOwnerMeta(owner: string): BadgeMeta {
  if (owner === "user") return { label: "用户", variant: "outline" };
  if (owner === "platform") return { label: "平台", variant: "secondary" };
  return { label: owner, variant: "secondary" };
}
