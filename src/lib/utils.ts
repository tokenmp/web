import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind 类名：clsx 处理条件，twMerge 消解冲突 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 金额、用量这类数字统一按千分位显示 */
export function formatNumber(value: number, digits = 0) {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 美元金额，控制台里的余额与消耗都用它 */
export function formatCurrency(value: number, digits = 2) {
  return `$${value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** YYYY-MM-DD */
export function formatDate(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** YYYY-MM-DD HH:mm，按浏览器所在时区。接口给的是 UTC 的 ISO 串 */
export function formatDateTime(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) return "";
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 通知这类时间戳按「刚刚 / 12 分钟前 / 3 天前」显示，超过一周回落到日期。
 * 一周以内相对时间更好读：用户关心的是「多久以前」，不是具体几点。
 */
export function formatRelativeTime(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) return "";

  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;

  return formatDate(date);
}

/** ISO 时间转 <input type="datetime-local"> 要的 YYYY-MM-DDTHH:mm，按本地时区 */
export function toDateTimeLocal(value: string | Date | null | undefined) {
  const date = toDate(value);
  if (!date) return "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/* ------------------------------------------------------------------ 积分 */

/**
 * 积分口径：1 元 = 10000 积分。存储与结算仍是元，只有展示层换算。
 *
 * 用户面板里的余额、消耗、单价一律显示积分 —— 线上就是这么给用户看的，
 * 元金额对按量计费来说太小（一次调用几分钱），积分读起来直观得多。
 * 控制台那边另外用 formatCurrency，两边的口径统一等接上真实数据时再说。
 */
export const POINTS_PER_YUAN = 10000;

/** 预算周期标签 */
export const BUDGET_PERIOD_LABEL: Record<string, string> = {
  day: "每日",
  week: "每周",
  month: "每月",
};

/** 元 → 积分字符串（千分位）。小数保留到 8 位，覆盖后端 DECIMAL(14,8)，免得小额被抹成 0 */
export function formatPoints(yuan: number) {
  if (!Number.isFinite(yuan)) return "0";
  const points = yuan * POINTS_PER_YUAN;
  if (points === 0) return "0";
  // ×1e4 再取整：消除 0.1+0.2 那类浮点噪声
  const clean = Math.round(points * 1e4) / 1e4;
  return clean.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/** 元金额，不换算成积分。预算限额这类整钱用得多 */
export function formatYuan(value: number) {
  if (!Number.isFinite(value)) return "¥0";
  return `¥${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Token 大数：≥100 万按 M、≥1000 按 K，再小的原样 */
export function formatTokens(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/** 0~1 转百分比（0.9756 → 97.6%） */
export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

/** 耗时：超过 1 秒的按秒（1 位小数），其余按毫秒 */
export function formatLatency(ms: number) {
  if (!Number.isFinite(ms)) return "-";
  return ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** 是否已过期。没给时间就当不过期 */
export function isExpired(value: string | Date | null | undefined) {
  const date = toDate(value);
  return date !== null && date.getTime() < Date.now();
}

/**
 * 邮箱形状检查，返回错误文案或 null。空串当没填。
 *
 * 只回答「看起来是不是一个邮箱」：有没有 `@`、域名里有没有点、各部分有没有空白。
 * 域名存不存在、有没有 MX、收不收得到信都查不了 —— 那是投递路径上的事，
 * 浏览器里做不了也不该做。后端那道（`src/routes/api/admin/users.ts` 的长度与查重）
 * 才是真正的闸，这道只是省用户一次白跑。
 *
 * 放在 utils 而不是某个页面里：用户表单与将来的邀请、注册入口都要这一道。
 */
export function checkEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return null;

  if (/\s/.test(email)) return "邮箱里不能有空格";

  const at = email.indexOf("@");
  if (at === -1) return "邮箱里少了 @，要写成「名@域名」";
  if (at !== email.lastIndexOf("@")) return "邮箱里只能有一个 @";
  if (at === 0) return "邮箱的 @ 前面要有内容";
  if (at === email.length - 1) return "邮箱的 @ 后面要跟域名";

  const domain = email.slice(at + 1);
  if (!domain.includes(".")) return "邮箱的域名要点一下，例如 example.com";
  // 空段同时盖住开头结尾的点与连着的两个点：.a.com、a.com.、a..com 都不合法
  if (domain.split(".").some(part => part === "")) {
    return "邮箱的域名每一段都不能是空的（开头结尾的点、连着两个点都不行）";
  }
  return null;
}
