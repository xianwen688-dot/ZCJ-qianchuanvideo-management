import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { TrendPoint, DateMode } from "../types";
import { money, roi } from "../lib/format";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface Props {
  trends: TrendPoint[];
  dateMode: DateMode;
}

export function TrendChart({ trends, dateMode }: Props) {
  const data = useMemo(() => {
    const labels = trends.map((t) => t.date.slice(5)); // MM-DD
    return {
      labels,
      datasets: [
        {
          label: "消耗",
          data: trends.map((t) => t.spend),
          borderColor: "#5b6eec",
          backgroundColor: "rgba(91,110,236,0.08)",
          yAxisID: "y",
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: "#5b6eec",
          borderWidth: 2,
        },
        {
          label: "成交金额",
          data: trends.map((t) => t.gmv),
          borderColor: "#10b981",
          backgroundColor: "rgba(16,185,129,0.06)",
          yAxisID: "y",
          fill: false,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: "#10b981",
          borderWidth: 2,
          borderDash: [5, 3],
        },
      ],
    };
  }, [trends]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index" as const,
        intersect: false,
      },
      plugins: {
        legend: {
          position: "top" as const,
          align: "end" as const,
          labels: {
            usePointStyle: true,
            padding: 16,
            font: { size: 12 },
            color: "#475569",
          },
        },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.9)",
          titleFont: { size: 13 },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: (ctx: any) => {
              if (ctx.dataset.label === "消耗") return `消耗: ${money(ctx.raw)}`;
              return `成交: ${money(ctx.raw)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, color: "#94a3b8", maxTicksLimit: dateMode === "month" ? 31 : 14 },
        },
        y: {
          type: "linear" as const,
          position: "left" as const,
          title: {
            display: true,
            text: "金额 (¥)",
            font: { size: 11 },
            color: "#94a3b8",
          },
          grid: { color: "rgba(148,163,184,0.12)" },
          ticks: {
            font: { size: 11 },
            color: "#94a3b8",
            callback: (v: any) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v),
          },
        },
      },
    }),
    [dateMode]
  );

  if (!trends.length) {
    return (
      <div className="chart-placeholder">
        <span>暂无趋势数据</span>
      </div>
    );
  }

  return (
    <div style={{ height: 260 }}>
      <Line data={data} options={options} />
    </div>
  );
}
