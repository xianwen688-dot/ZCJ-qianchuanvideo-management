export type DateMode = "day" | "week" | "month";

function pad(n: number) { return String(n).padStart(2, "0"); }

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 获取日期范围的起止日期 */
export function getDateRange(selected: string, mode: DateMode): { from: string; to: string } {
  if (!selected || !/^\d{4}-\d{2}-\d{2}$/.test(selected)) {
    const t = today();
    return { from: t, to: t };
  }
  if (mode === "day") return { from: selected, to: selected };
  if (mode === "month") {
    const [y, m] = selected.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
  }
  // week: 选中日期所在自然周 (周一~周日)
  const d = new Date(selected + "T00:00:00");
  const day = d.getDay() || 7;
  const mon = new Date(d); mon.setDate(d.getDate() - day + 1);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return {
    from: mon.toISOString().slice(0, 10),
    to: sun.toISOString().slice(0, 10),
  };
}

/** 周标签: 第X自然周 (月/日-月/日) */
export function weekLabel(selected: string): string {
  if (!selected) return "";
  const d = new Date(selected + "T00:00:00");
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const firstMonday = new Date(yearStart);
  firstMonday.setDate(yearStart.getDate() - (yearStart.getDay() || 7) + 1);
  let weekNum = 0;
  if (d >= firstMonday) {
    weekNum = Math.floor((d.getTime() - firstMonday.getTime()) / (7 * 86400000)) + 1;
  }
  const r = getDateRange(selected, "week");
  return `第${weekNum}周 ${r.from.slice(5)}-${r.to.slice(5)}`;
}

export function rangeLabel(range: { from: string; to: string } | null): string {
  if (!range?.from || !range?.to) return "全部数据";
  if (range.from === range.to) return range.from;
  return `${range.from} — ${range.to}`;
}
