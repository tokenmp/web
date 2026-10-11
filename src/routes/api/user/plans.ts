import type { APIEvent } from "@solidjs/start/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { requireUser } from "~/lib/api-auth";
import { db } from "~/lib/db";
import { errorJson, json, num } from "~/lib/http";
import { plans, planPrices, subscriptions, type PlanRow } from "~/lib/schema";

type PlanStats = { modelCount: number; weightMin: number; weightMax: number };

/**
 * PanelPlan 序列化。比 PlanCore 少，多了 model_count 与 request_weight 的区间 ——
 * 用户端要展示「这个套餐覆盖多少模型、按次计费的权重范围」。
 * 没有模型价时区间记为 0。
 */
function panelPlan(row: PlanRow, stats?: PlanStats) {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    quota_kind: row.quotaKind,
    pricing_mode: row.pricingMode,
    markup_multiplier: num(row.markupMultiplier),
    price: num(row.price),
    quota_amount: num(row.quotaAmount),
    quota_period_days: row.quotaPeriodDays,
    overage_mode: row.overageMode,
    currency: row.currency,
    model_count: stats?.modelCount ?? 0,
    weight_min: stats?.weightMin ?? 0,
    weight_max: stats?.weightMax ?? 0,
    updated_at: row.updatedAt,
  };
}

/**
 * GET /api/user/plans
 *
 * 用户端可订阅套餐列表 + 当前订阅 + 默认选中项。只回 status=1 的套餐。
 *
 * default_plan_id 的取法：用户 users.plan_id 指向的套餐若还在售就用它，
 * 否则退到按量付费那档（mode=pay_as_you_go，列表已按 sort_order 排序，取第一个），
 * 都没有给 null。这样用户打开订阅页时总有一个合理的默认选中项。
 */
export async function GET({ request }: APIEvent) {
  const user = await requireUser(request);
  if (!user) return errorJson("请先登录", 401);

  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.status, 1))
    .orderBy(asc(plans.sortOrder), asc(plans.id));

  const statRows = await db
    .select({
      planId: planPrices.planId,
      modelCount: sql<number>`count(*)`,
      weightMin: sql<string | null>`min(${planPrices.requestWeight})`,
      weightMax: sql<string | null>`max(${planPrices.requestWeight})`,
    })
    .from(planPrices)
    .groupBy(planPrices.planId);

  const statsByPlan = new Map<number, PlanStats>(
    statRows.map(row => [
      row.planId,
      {
        modelCount: Number(row.modelCount),
        weightMin: num(row.weightMin),
        weightMax: num(row.weightMax),
      },
    ]),
  );

  const [currentRow] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.status, "active")))
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);

  let current: {
    plan: ReturnType<typeof panelPlan>;
    quota_limit: number;
    quota_used: number;
    period_start: Date | null;
    period_end: Date | null;
  } | null = null;

  if (currentRow) {
    // 当前订阅的套餐可能已经下架，仍然要能展示「你现在订的是什么」，所以不带 status 过滤
    const [planRow] = await db
      .select()
      .from(plans)
      .where(eq(plans.id, currentRow.planId))
      .limit(1);
    if (planRow) {
      current = {
        plan: panelPlan(planRow, statsByPlan.get(planRow.id)),
        quota_limit: num(currentRow.quotaLimit),
        quota_used: num(currentRow.quotaUsed),
        period_start: currentRow.periodStart,
        period_end: currentRow.periodEnd,
      };
    }
  }

  let defaultPlanId: number | null = null;
  if (user.planId !== null) {
    const owned = rows.find(row => row.id === user.planId);
    if (owned) defaultPlanId = owned.id;
  }
  if (defaultPlanId === null) {
    defaultPlanId = rows.find(row => row.mode === "pay_as_you_go")?.id ?? null;
  }

  return json({
    data: {
      plans: rows.map(row => panelPlan(row, statsByPlan.get(row.id))),
      current,
      default_plan_id: defaultPlanId,
    },
  });
}
