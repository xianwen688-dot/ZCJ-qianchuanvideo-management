import { useMemo } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { money } from "../lib/format";

ChartJS.register(ArcElement, Tooltip, Legend);

interface Props {
  data: { label: string; value: number }[];
}

const COLORS = ["#5b6eec", "#10b981", "#f59e0b", "#ef4444", "#818cf8"];

export function PieChart({ data }: Props) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  const chartData = useMemo(
    () => ({
      labels: data.map((d) => d.label),
      datasets: [
        {
          data: data.map((d) => d.value),
          backgroundColor: data.map((_, i) => COLORS[i % COLORS.length]),
          borderColor: "rgba(255,255,255,0.6)",
          borderWidth: 2,
          hoverBorderWidth: 3,
        },
      ],
    }),
    [data]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: "55%",
      plugins: {
        legend: {
          position: "bottom" as const,
          labels: {
            usePointStyle: true,
            padding: 14,
            font: { size: 11 },
            color: "#475569",
            generateLabels: (chart: any) => {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((label: string, i: number) => ({
                text: `${label}: ${money(ds.data[i])} (${total > 0 ? ((ds.data[i] / total) * 100).toFixed(1) : 0}%)`,
                fillStyle: ds.backgroundColor[i],
                strokeStyle: ds.backgroundColor[i],
                lineWidth: 0,
                hidden: false,
                index: i,
                pointStyle: "circle",
                rotation: 0,
              }));
            },
          },
        },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.9)",
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: (ctx: any) => {
              const v = ctx.raw as number;
              return ` 消耗: ${money(v)}  (${total > 0 ? ((v / total) * 100).toFixed(1) : 0}%)`;
            },
          },
        },
      },
    }),
    [data, total]
  );

  if (!data.length) {
    return <div className="chart-placeholder"><span>暂无来源数据</span></div>;
  }

  return (
    <div style={{ height: 260 }}>
      <Doughnut data={chartData} options={options} />
    </div>
  );
}
