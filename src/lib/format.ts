/** 金额格式化 — 始终显示完整数字 */
export function money(value: number | null | undefined): string {
  const n = value ?? 0;
  return `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 数字格式化 — 始终显示完整数字 */
export function numberText(value: number | null | undefined): string {
  const n = value ?? 0;
  return n.toLocaleString("zh-CN");
}

/** 百分比 */
export function percent(value: number | null | undefined): string {
  return `${((value ?? 0) * 100).toFixed(2)}%`;
}

/** ROI 格式化 */
export function roi(value: number | null | undefined): string {
  return (value ?? 0).toFixed(2);
}

/** 时长(秒) */
export function seconds(value: number | null | undefined): string {
  const s = value ?? 0;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}
