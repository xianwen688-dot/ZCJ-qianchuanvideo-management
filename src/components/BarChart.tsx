import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { money } from "../lib/format";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Props {
  labels: string[];
  values: number[];
  title?: string;
  color?: string;
}

export function BarChart({ labels, values, title, color = "#5b6eec" }: Props) {
  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: title ?? "消耗",
          data: values,
          backgroundColor: values.map((_, i) =>
            i === 0 ? color : `rgba(91,110,236,${0.85 - i * 0.06})`
          ),
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    }),
    [labels, values, title, color]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y" as const,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.9)",
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: (ctx: any) => `消耗: ${money(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(148,163,184,0.12)" },
          ticks: {
            font: { size: 11 },
            color: "#94a3b8",
            callback: (v: any) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v),
          },
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 11 }, color: "#475569" },
        },
      },
    }),
    []
  );

  if (!labels.length) {
    return <div className="chart-placeholder"><span>暂无数据</span></div>;
  }

  return (
    <div style={{ height: labels.length * 34 + 20, minHeight: 160, maxHeight: 300 }}>
      <Bar data={data} options={options} />
    </div>
  );
}
