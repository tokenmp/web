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
