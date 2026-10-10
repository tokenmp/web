/**
 * 模型分块配色。
 *
 * 概览页与套餐页的堆叠柱状图共用一份，同一个模型在两处颜色一致。
 * 这组色是线上那套（分类色，循环使用），没有走设计令牌 —— 十种颜色塞进令牌
 * 反而更难维护，而且图表分块只需要彼此可区分。
 */
export const MODEL_COLORS = [
  "#2563eb",
  "#0d9488",
  "#7c3aed",
  "#d97706",
  "#059669",
  "#e11d48",
  "#0891b2",
  "#ca8a04",
  "#dc2626",
  "#4f46e5",
];

/** 同一个模型在多个图表里取到同一个颜色：按下标取模 */
export function modelColor(index: number) {
  return MODEL_COLORS[index % MODEL_COLORS.length];
}
