/**
 * 订阅剩余额度的折算。
 *
 * 两个地方共用这一处口径：#26 的取消/退款，与 #28 的套餐换档抵扣。
 * 各写各的公式迟早对不上账，所以做成纯函数，两个 handler 都调它。
 *
 * 公式（issue 定的口径）：
 *
 *   总天数   = period_end - period_start 的实际天数
 *   剩余天数 = max(0, period_end - now)
 *   剩余订阅额度 = quota_limit * 剩余天数 / 总天数
 *
 * 总天数取「实际区间」而不是套餐的 quota_period_days：套餐天数可以被管理员改，
 * 订阅行本身才是账面对应的区间。只有 period_start 缺失（线上导入的旧数据）时
 * 才回落到套餐的 quota_period_days。
 *
 * 注意按 quota_limit 折算，不扣 quota_used —— 已用掉的部分取消与换档都不回收，
 * 只按剩余时间把这段时间的订阅额度切出来。
 */

import { round8 } from "~/lib/ledger";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type QuotaWindow = {
  /** money = 订阅额度是钱，requests = 订阅额度是次数 */
  quotaKind: string;
  quotaLimit: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  /** period_start 缺失时回落到套餐的 quota_period_days */
  fallbackPeriodDays?: number;
};

/** 订阅周期的总天数。period_end 缺失或区间非法时回 0，表示没法折算 */
export function totalPeriodDays(
  window: Pick<QuotaWindow, "periodStart" | "periodEnd" | "fallbackPeriodDays">,
): number {
  const { periodStart, periodEnd, fallbackPeriodDays = 0 } = window;
  if (!periodEnd) return 0;
  if (periodStart) {
    const days = (periodEnd.getTime() - periodStart.getTime()) / DAY_MS;
    if (days > 0) return days;
  }
  return fallbackPeriodDays > 0 ? fallbackPeriodDays : 0;
}

/** 剩余天数，period_end 已过或缺失都归 0 */
export function remainingDays(periodEnd: Date | null, now: Date = new Date()): number {
  if (!periodEnd) return 0;
  return Math.max(0, (periodEnd.getTime() - now.getTime()) / DAY_MS);
}

/**
 * 折算后的剩余订阅额度，单位与 quota_kind 一致（money 是元，requests 是次数）。
 *
 * 剩余天数封顶到总天数：周期还没开始时（时钟漂移、手工改过 period_start）也能退/抵超过全款。
 * 已过期、订阅额度为 0、周期缺失都回 0。
 */
export function proratedRemainingQuota(window: QuotaWindow, now: Date = new Date()): number {
  const total = totalPeriodDays(window);
  if (total <= 0) return 0;

  const limit = window.quotaLimit;
  if (!Number.isFinite(limit) || limit <= 0) return 0;

  const remaining = Math.min(remainingDays(window.periodEnd, now), total);
  if (remaining <= 0) return 0;

  return round8((limit * remaining) / total);
}

/**
 * 可退金额。退款只认钱：
 *
 *   money    按剩余订阅额度折算退款
 *   requests 订阅额度是次数不是钱，次数退不回现金，一律按 0 处理
 *
 * 「requests 不退钱」这条要在调用处也判住，调用方拿它算换档抵扣时，
 * 结果同样是 0 —— 即按次套餐换到别的套餐不抵扣。
 */
export function refundableAmount(window: QuotaWindow, now: Date = new Date()): number {
  if (window.quotaKind === "requests") return 0;
  return proratedRemainingQuota(window, now);
}
