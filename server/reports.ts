import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { getProductSummary, getAcneStats, getVideoSummary, getTopMaterials, getDailyTrends, getPlanSummary } from "./sync";
import { money, numberText, percent, roi } from "./format-utils";

// ====== Plain-text Daily Report (新格式) ======
export function generateDailyReportText(dateStr?: string) {
  const today = dateStr || new Date().toISOString().slice(0, 10);
  // 格式化中文日期 (如 "6月29日")
  const d = new Date(today);
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日`;

  // 当日数据 (按 metric_date 过滤)
  const daySummary = getProductSummary({ from: today, to: today });
  const dayAcne = getAcneStats({ from: today, to: today });

  // 当月累计 (使用 '全部' 汇总行)
  const mtdSummary = getProductSummary();
  const mtdAcne = getAcneStats();

  const lines: string[] = [];
  lines.push(`${dateLabel}千川视频投放汇报:`);

  // === 当日数据 ===
  lines.push(`当日整体成交：${Math.round(daySummary.gross_gmv)}`);
  lines.push(`当日净成交：${Math.round(daySummary.net_gmv)}`);
  lines.push(`当日整体消耗：${daySummary.spend.toFixed(2)}`);
  lines.push(`当日净成交ROI: ${daySummary.net_roi.toFixed(2)}`);
  lines.push(`1小时内退款金额：${Math.round(daySummary.refund_amount_1h)}`);
  lines.push("");

  // === 当月累计 ===
  lines.push(`当月净成交：${mtdSummary.net_gmv.toFixed(2)}`);
  lines.push(`当月推广消耗：${mtdSummary.spend.toFixed(2)}`);
  lines.push(`当月净成交ROI：${mtdSummary.net_roi.toFixed(2)}`);
  lines.push(`减15%退货率净ROI：${mtdSummary.conservative_roi.toFixed(2)}`);
  lines.push("");

  // === 祛痘专项 (当日) ===
  lines.push(`祛痘推广净成交：${Math.round(dayAcne.net_gmv)}`);
  lines.push(`祛痘当日推广消耗：${dayAcne.spend.toFixed(2)}`);
  lines.push(`祛痘当日推广ROI：${dayAcne.net_roi.toFixed(2)}`);
  lines.push(`祛痘推广净订单数：${dayAcne.jinghua_net_orders}`);
  lines.push(`祛痘精华霜净成交数:${dayAcne.jinghua_net_orders}`);

  return { content: lines.join("\n"), type: "daily" as const, date: today, dateLabel };
}

const REPORTS_DIR = path.resolve(process.cwd(), "reports");

// Ensure output dirs exist
function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

// ====== Markdown Render Helpers ======
function h1(text: string) { return `# ${text}\n`; }
function h2(text: string) { return `## ${text}\n`; }
function h3(text: string) { return `### ${text}\n`; }
function bold(text: string) { return `**${text}**`; }
function table(headers: string[], rows: string[][]) {
  const header = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |`;
  return `${header}\n${rows.map(r => `| ${r.join(" | ")} |`).join("\n")}\n`;
}

// ====== Daily Report ======
export function generateDailyReport(dateStr?: string) {
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const summary = getProductSummary();
  const acne = getAcneStats();
  const video = getVideoSummary();
  const top5 = getTopMaterials(5, "spend") as any[];
  const trends = getDailyTrends() as any[];
  const plans = getPlanSummary() as any[];

  const lines: string[] = [];
  lines.push(h1(`📊 千川视频投放日报 — ${today}`));
  lines.push(`> 自动生成时间: ${new Date().toLocaleString("zh-CN")}\n`);

  // 数据概况
  lines.push(h2("一、数据概况"));
  const overallRows = [
    ["指标", "数值"],
    ["整体消耗", money(summary.spend)],
    ["整体成交金额", money(summary.gross_gmv)],
    ["整体支付ROI", roi(summary.gross_roi)],
    ["净成交金额", money(summary.net_gmv)],
    ["净成交ROI", roi(summary.net_roi)],
    ["净成交订单数", numberText(summary.net_orders)],
    ["1小时退款金额", money(summary.refund_amount_1h)],
    ["⭐ 减15%退货率净ROI", roi(summary.conservative_roi)],
  ];
  lines.push(table(overallRows[0], overallRows.slice(1)));

  // 祛痘专项
  lines.push(h2("二、祛痘类投放专项"));
  const acneRows = [
    ["指标", "数值"],
    ["祛痘类整体消耗", money(acne.spend)],
    ["祛痘类净成交金额", money(acne.net_gmv)],
    ["祛痘类净成交ROI", roi(acne.net_roi)],
    ["净订单数", numberText(acne.net_orders)],
    ["消耗占比", `${(acne.spend_ratio * 100).toFixed(1)}%`],
    ["精华霜净成交订单(4个套装)", numberText(acne.jinghua_net_orders)],
  ];
  lines.push(table(acneRows[0], acneRows.slice(1)));
  lines.push("");

  // 产品明细
  lines.push(h3("祛痘产品明细"));
  const prodRows = [["产品", "消耗", "净成交", "净ROI", "净订单"]];
  for (const p of acne.products) {
    prodRows.push([String(p.name).slice(0, 30), money(p.spend), money(p.net_gmv), roi(p.net_roi), numberText(p.net_orders)]);
  }
  lines.push(table(prodRows[0], prodRows.slice(1)));

  // 消耗 TOP5
  lines.push(h2("三、消耗 TOP5 视频素材"));
  const topRows = [["素材", "消耗", "成交", "ROI", "播放"]];
  for (const m of top5) {
    topRows.push([
      String(m.material_name).slice(0, 40),
      money(m.spend),
      money(m.gross_gmv),
      roi(m.gross_roi),
      numberText(m.plays ?? 0),
    ]);
  }
  lines.push(table(topRows[0], topRows.slice(1)));

  // 视频维度
  lines.push(h2("四、视频维度汇总"));
  const vidRows = [
    ["指标", "数值"],
    ["视频整体消耗", money(video.spend)],
    ["视频整体成交", money(video.gross_gmv)],
    ["视频支付ROI", roi(video.gross_roi)],
    ["视频净成交ROI", roi(video.net_roi)],
    ["视频播放数", numberText(video.plays)],
    ["素材数量", numberText(video.material_count)],
  ];
  lines.push(table(vidRows[0], vidRows.slice(1)));

  // 计划消耗
  lines.push(h2("五、投放计划消耗"));
  const planRows = [["计划", "消耗", "净成交", "净ROI"]];
  for (const p of plans.slice(0, 6)) {
    planRows.push([String(p.plan_name).slice(0, 30), money(p.spend), money(p.net_gmv), roi(p.net_roi)]);
  }
  lines.push(table(planRows[0], planRows.slice(1)));

  lines.push("");
  lines.push("---");
  lines.push(`> 🤖 本报告由抖音视频投放管理系统自动生成`);

  return { content: lines.join("\n"), type: "daily" as const, date: today };
}

// ====== Weekly Report ======
export function generateWeeklyReport() {
  const summary = getProductSummary();
  const acne = getAcneStats();
  const video = getVideoSummary();
  const top10 = getTopMaterials(10, "spend") as any[];
  const topRoi = getTopMaterials(10, "gross_roi") as any[];

  const lines: string[] = [];
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekLabel = `${monday.toISOString().slice(0, 10)} ~ ${sunday.toISOString().slice(0, 10)}`;

  lines.push(h1(`📊 千川视频投放周报 — ${weekLabel}`));
  lines.push(`> 自动生成时间: ${now.toLocaleString("zh-CN")}\n`);

  lines.push(h2("一、本周KPI概览"));
  const kpiRows = [
    ["指标", "累计值"],
    ["整体消耗", money(summary.spend)],
    ["整体成交金额", money(summary.gross_gmv)],
    ["整体支付ROI", roi(summary.gross_roi)],
    ["净成交ROI", roi(summary.net_roi)],
    ["净成交订单数", numberText(summary.net_orders)],
    ["保守预估ROI(减15%退货)", roi(summary.conservative_roi)],
  ];
  lines.push(table(kpiRows[0], kpiRows.slice(1)));

  lines.push(h2("二、祛痘类表现"));
  const acneData = [
    ["消耗", money(acne.spend), `占比 ${(acne.spend_ratio * 100).toFixed(1)}%`],
    ["净成交金额", money(acne.net_gmv), ""],
    ["净成交ROI", roi(acne.net_roi), ""],
    ["净订单数", numberText(acne.net_orders), ""],
    ["精华霜净成交", numberText(acne.jinghua_net_orders), "4个套装产品合计"],
  ];
  lines.push(table(["指标", "数值", "备注"], acneData));

  lines.push(h2("三、消耗 TOP10 素材"));
  const t10 = [["#", "素材", "消耗", "成交", "ROI"]];
  top10.forEach((m, i) => {
    t10.push([String(i + 1), String(m.material_name).slice(0, 35), money(m.spend), money(m.gross_gmv), roi(m.gross_roi)]);
  });
  lines.push(table(t10[0], t10.slice(1)));

  lines.push(h2("四、ROI TOP10 素材"));
  const r10 = [["#", "素材", "ROI", "消耗", "成交"]];
  topRoi.forEach((m, i) => {
    r10.push([String(i + 1), String(m.material_name).slice(0, 35), roi(m.gross_roi), money(m.spend), money(m.gross_gmv)]);
  });
  lines.push(table(r10[0], r10.slice(1)));

  lines.push(h2("五、视频维度汇总"));
  lines.push(`- 视频整体消耗: ${money(video.spend)}`);
  lines.push(`- 视频整体成交: ${money(video.gross_gmv)}`);
  lines.push(`- 视频支付ROI: ${roi(video.gross_roi)}`);
  lines.push(`- 视频播放数: ${numberText(video.plays)}`);
  lines.push(`- 素材总数: ${video.material_count}`);

  // 优化建议
  lines.push(h2("六、优化建议"));
  lines.push(`1. 祛痘类消耗占比 ${(acne.spend_ratio * 100).toFixed(1)}%，建议持续关注ROI变化`);
  if (acne.net_roi < 1.5) {
    lines.push("2. ⚠️ 祛痘类ROI偏低，建议优化素材内容或调整出价策略");
  } else {
    lines.push("2. ✅ 祛痘类ROI表现良好，可考虑追加预算");
  }
  lines.push("3. 关注播放量高但ROI低的素材，分析3s/5s播放率和完播率数据");
  lines.push("4. 建议A/B测试不同视频时长（15s vs 30s vs 60s）对转化率的影响");

  lines.push("");
  lines.push("---");
  lines.push(`> 🤖 本报告由抖音视频投放管理系统自动生成`);

  return { content: lines.join("\n"), type: "weekly" as const, date: weekLabel };
}

// ====== Monthly Report ======
export function generateMonthlyReport() {
  const summary = getProductSummary();
  const acne = getAcneStats();
  const video = getVideoSummary();
  const plans = getPlanSummary() as any[];

  const lines: string[] = [];
  const now = new Date();
  const monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;

  lines.push(h1(`📊 千川视频投放月报 — ${monthLabel}`));
  lines.push(`> 自动生成时间: ${now.toLocaleString("zh-CN")}\n`);

  lines.push(h2("一、月度KPI"));
  const kpiRows = [
    ["指标", "本月累计"],
    ["整体消耗", money(summary.spend)],
    ["整体成交金额", money(summary.gross_gmv)],
    ["整体支付ROI", roi(summary.gross_roi)],
    ["净成交金额", money(summary.net_gmv)],
    ["净成交ROI", roi(summary.net_roi)],
    ["净成交订单数", numberText(summary.net_orders)],
    ["1小时退款金额", money(summary.refund_amount_1h)],
    ["⭐ 保守预估ROI(减15%退货)", roi(summary.conservative_roi)],
  ];
  lines.push(table(kpiRows[0], kpiRows.slice(1)));

  lines.push(h2("二、祛痘类月度分析"));
  lines.push(`- 祛痘类整体消耗: ${money(acne.spend)} (占比 ${(acne.spend_ratio * 100).toFixed(1)}%)`);
  lines.push(`- 祛痘类净成交: ${money(acne.net_gmv)}`);
  lines.push(`- 祛痘类净ROI: ${roi(acne.net_roi)}`);
  lines.push(`- 祛痘类净订单数: ${numberText(acne.net_orders)}`);
  lines.push(`- 精华霜净成交订单: ${numberText(acne.jinghua_net_orders)} (4个套装产品合计)`);

  lines.push(h2("三、视频素材月度表现"));
  lines.push(`- 视频整体消耗: ${money(video.spend)}`);
  lines.push(`- 视频整体成交: ${money(video.gross_gmv)}`);
  lines.push(`- 视频支付ROI: ${roi(video.gross_roi)}`);
  lines.push(`- 视频播放数: ${numberText(video.plays)}`);
  lines.push(`- 总素材数: ${video.material_count}`);

  lines.push(h2("四、投放计划月度汇总"));
  const planRows = [["计划", "消耗", "净成交", "净ROI", "净订单"]];
  for (const p of plans) {
    planRows.push([String(p.plan_name).slice(0, 25), money(p.spend), money(p.net_gmv), roi(p.net_roi), numberText(p.net_orders)]);
  }
  lines.push(table(planRows[0], planRows.slice(1)));

  // 预算建议
  lines.push(h2("五、下月投放建议"));
  const totalSpend = summary.spend;
  const bestPlan = plans.length > 0 ? plans[0] : null;
  if (bestPlan) {
    lines.push(`1. 主力计划 "${String(bestPlan.plan_name)}" 消耗 ${money(bestPlan.spend)}，净ROI ${roi(bestPlan.net_roi)}，建议作为下月核心`);
  }
  lines.push(`2. 祛痘类消耗 ${money(acne.spend)}，占比 ${(acne.spend_ratio * 100).toFixed(1)}%，建议下月预算 ${money(totalSpend * 0.7)} （维持70%占比）`);
  if (acne.net_roi < 1.3) {
    lines.push("3. ⚠️ 祛痘类ROI偏低，建议压缩无效素材，重点保留ROI>1.5的素材");
  }
  lines.push("4. 关注618后续数据走势，预计7月进入淡季，适当降低出价");

  lines.push("");
  lines.push("---");
  lines.push(`> 🤖 本报告由抖音视频投放管理系统自动生成`);

  return { content: lines.join("\n"), type: "monthly" as const, date: monthLabel };
}

// ====== Save Report ======
export function saveReport(type: "daily" | "weekly" | "monthly" | "manual", content: string, dateFrom: string, dateTo: string) {
  ensureDir(REPORTS_DIR);
  ensureDir(path.join(REPORTS_DIR, type));

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `${type}_${dateFrom}_to_${dateTo}_${timestamp}.md`;
  const filePath = path.join(REPORTS_DIR, type, fileName);
  fs.writeFileSync(filePath, content, "utf-8");

  // Log to DB
  const result = db.prepare(
    `INSERT INTO report_log (report_type, date_from, date_to, content_path, status, created_at)
     VALUES (?, ?, ?, ?, 'generated', ?)`
  ).run(type, dateFrom, dateTo, filePath, new Date().toISOString());

  return { id: Number(result.lastInsertRowid), path: filePath, type, fileName };
}

// ====== Get Report Logs ======
export function getReportLogs(type?: string, limit = 20) {
  let where = "";
  const params: any[] = [];
  if (type) { where = "WHERE report_type = ?"; params.push(type); }
  return db.prepare(
    `SELECT * FROM report_log ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, limit);
}
