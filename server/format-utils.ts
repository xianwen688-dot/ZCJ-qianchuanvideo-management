// Server-side format utilities — always display full numbers
export function money(value: number | null | undefined): string {
  const n = value ?? 0;
  return `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function numberText(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString("zh-CN");
}
export function roi(value: number | null | undefined): string {
  return (value ?? 0).toFixed(2);
}
export function percent(value: number | null | undefined): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}
