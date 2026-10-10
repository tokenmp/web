import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";

import { db } from "~/lib/db";
import { json } from "~/lib/http";
import { systemConfig } from "~/lib/schema";

/**
 * GET /api/system/version
 *
 * 公开。前端拿它在页脚显示版本号。
 * 值存在 system_config 的 system_version 里，形如
 * {"version":"0.1.0","released_at":"2026-10-10","channel":"dev"}。
 */
export async function GET(_event: APIEvent) {
  const [row] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, "system_version"))
    .limit(1);

  if (!row) return json({ version: null, released_at: null, channel: null });

  const value = (row.value ?? {}) as Record<string, unknown>;
  return json({
    version: value.version ?? null,
    released_at: value.released_at ?? null,
    channel: value.channel ?? null,
  });
}
