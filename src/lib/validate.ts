/**
 * 入库前的取值范围校验。
 *
 * 变异测试发现：金额、天数、倍率这些字段直接 Number() 一下就写库，MySQL 开着 STRICT 模式，
 * 超出列定义时抛 ER_WARN_DATA_OUT_OF_RANGE，未捕获就变成 500。
 * 整数部分 6 位以上就能把一个调账请求打成 500，1e6 就够。
 *
 * 这里按列定义挡住：DECIMAL 查整数位，INT 查上限。挡在入库前，回 400 而不是 500。
 */

/** DECIMAL(precision, scale) 能表示的最大绝对值。14,8 → 999999.99999999 */
export function maxDecimal(precision: number, scale: number) {
  return 10 ** (precision - scale) - 10 ** -scale;
}

export function fitsDecimal(value: number, precision: number, scale: number) {
  return Number.isFinite(value) && Math.abs(value) <= maxDecimal(precision, scale);
}

/** 金额列：DECIMAL(14,8)，整数部分最多 6 位 */
export const MONEY = { precision: 14, scale: 8 } as const;
/** 单价列：DECIMAL(18,8)，整数部分最多 10 位 */
export const PRICE = { precision: 18, scale: 8 } as const;

/** mysql 的 INT 是有符号 32 位 */
export const INT32_MAX = 2_147_483_647;
export const INT32_MIN = -2_147_483_648;

export function fitsInt32(value: number) {
  return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX;
}

/**
 * 按列定义校验一个金额，返回错误文案或 null。
 *
 * 只接受真正的数字：字符串 "5"、布尔、对象都算不合法。
 * 变异测试里 `name: {}` 被 String() 强转成了 `[object Object]` 建出账号，
 * `credit_limit: "5"` 也被收下了，所以类型判断要严。
 */
export function checkMoney(value: unknown, label: string, spec: { precision: number; scale: number } = MONEY): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${label}必须是数字`;
  if (!fitsDecimal(value, spec.precision, spec.scale)) {
    return `${label}超出可表示范围（整数部分最多 ${spec.precision - spec.scale} 位）`;
  }
  return null;
}

/** 校验一个 int32 字段 */
export function checkInt32(value: unknown, label: string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${label}必须是数字`;
  if (!fitsInt32(value)) return `${label}超出 32 位整数范围`;
  return null;
}

/** 校验一个必填字符串字段：只认字符串，长度有上限 */
export function checkText(value: unknown, label: string, maxLength: number): string | null {
  if (typeof value !== "string") return `${label}必须是字符串`;
  const trimmed = value.trim();
  if (!trimmed) return `${label}不能为空`;
  if (trimmed.length > maxLength) return `${label}不能超过 ${maxLength} 个字符`;
  return null;
}
