// Server-side format utilities (mirrors frontend src/lib/format.ts)

export function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "¥0";
  if (Math.abs(value) >= 10000) {
    return `¥${(value / 10000).toFixed(2)}万`;
  }
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function numberText(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0";
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN");
}

export function roi(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value <= 0) return "0.00";
  return value.toFixed(2);
}

export function percent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0%";
  return `${(Math.min(value, 1) * 100).toFixed(1)}%`;
}
