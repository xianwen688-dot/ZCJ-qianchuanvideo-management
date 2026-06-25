import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { DATA_PATHS } from "./config";
import { detectFileType } from "./parser";
import { importReportFile, type ImportResult } from "./importer";

// ====== 全量同步 ======
export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  files: ImportResult[];
  totalRows: number;
  errors: string[];
}

function walkFiles(rootPath: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(rootPath)) return files;
  const stack = [rootPath];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && /\.(csv|xlsx)$/i.test(entry.name)) files.push(full);
    }
  }
  return files;
}

export async function runFullSync(): Promise<SyncResult> {
  const result: SyncResult = {
    startedAt: new Date().toISOString(),
    finishedAt: "",
    files: [],
    totalRows: 0,
    errors: [],
  };

  for (const rootPath of DATA_PATHS) {
    if (!fs.existsSync(rootPath)) {
      result.errors.push(`目录不可访问: ${rootPath}`);
      continue;
    }
    for (const filePath of walkFiles(rootPath)) {
      const fileType = detectFileType(filePath);
      if (!fileType) continue;
      try {
        const imported = await importReportFile(filePath);
        result.files.push(imported);
        result.totalRows += imported.inserted;
      } catch (err) {
        result.errors.push(`${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  result.finishedAt = new Date().toISOString();
  return result;
}

// ====== Dashboard 查询 ======

/** 商品维度 Dashboard 汇总 (来源: product_metrics) */
export function getProductSummary() {
  // 所有"全部"行求和
  const row = db.prepare(`
    SELECT
      SUM(spend) AS spend,
      SUM(gross_gmv) AS gross_gmv,
      SUM(net_gmv) AS net_gmv,
      SUM(net_orders) AS net_orders,
      SUM(gross_orders) AS gross_orders,
      SUM(refund_amount_1h) AS refund_amount_1h,
      SUM(actual_pay_amount) AS actual_pay_amount
    FROM product_metrics
    WHERE metric_date = '全部'
  `).get() as Record<string, number | null>;

  const spend = row.spend ?? 0;
  const grossGmv = row.gross_gmv ?? 0;
  const netGmv = row.net_gmv ?? 0;
  const netOrders = row.net_orders ?? 0;
  const grossOrders = row.gross_orders ?? 0;
  const refund1h = row.refund_amount_1h ?? 0;

  return {
    spend,
    gross_gmv: grossGmv,
    gross_roi: spend > 0 ? grossGmv / spend : 0,
    net_gmv: netGmv,
    net_roi: spend > 0 ? netGmv / spend : 0,
    net_orders: netOrders,
    gross_orders: grossOrders,
    refund_amount_1h: refund1h,
    // 减15%退货率净成交ROI
    conservative_roi: spend > 0 ? (netGmv * 0.85) / spend : 0,
  };
}

/** 祛痘类产品专项 (含"苦参"或"祛痘"的5个产品) */
export function getAcneStats() {
  const rows = db.prepare(`
    SELECT product_name, spend, net_gmv, net_roi, net_orders, refund_amount_1h
    FROM product_metrics
    WHERE metric_date = '全部'
      AND (product_name LIKE '%苦参%' OR product_name LIKE '%祛痘%')
    ORDER BY spend DESC
  `).all() as Array<Record<string, number>>;

  const totalSpend = rows.reduce((s, r) => s + (r.spend ?? 0), 0);
  const totalNet = rows.reduce((s, r) => s + (r.net_gmv ?? 0), 0);
  const totalOrders = rows.reduce((s, r) => s + (r.net_orders ?? 0), 0);
  const totalRefund = rows.reduce((s, r) => s + (r.refund_amount_1h ?? 0), 0);

  // 4个套装产品的净订单 (含精华霜)
  const targetProducts = ["苦参祛痘精华霜", "苦参祛痘2件套", "苦参祛痘4件套", "苦参祛痘组合"];
  const jinghuaOrders = rows
    .filter((r) => targetProducts.some((t) => String(r.product_name ?? "").includes(t)))
    .reduce((s, r) => s + (r.net_orders ?? 0), 0);

  // 总消耗占比
  const allSpend = (db.prepare(
    `SELECT SUM(spend) AS total FROM product_metrics WHERE metric_date = '全部'`
  ).get() as { total: number }).total ?? 1;

  return {
    spend: totalSpend,
    net_gmv: totalNet,
    net_roi: totalSpend > 0 ? totalNet / totalSpend : 0,
    net_orders: totalOrders,
    refund_amount_1h: totalRefund,
    spend_ratio: allSpend > 0 ? totalSpend / allSpend : 0,
    jinghua_net_orders: jinghuaOrders,
    products: rows.map((r) => ({
      name: r.product_name,
      spend: r.spend,
      net_gmv: r.net_gmv,
      net_roi: r.net_roi,
      net_orders: r.net_orders,
    })),
  };
}

/** 视频维度汇总 */
export function getVideoSummary() {
  const row = db.prepare(`
    SELECT
      SUM(spend) AS spend,
      SUM(gross_gmv) AS gross_gmv,
      SUM(net_gmv) AS net_gmv,
      SUM(net_orders) AS net_orders,
      SUM(plays) AS plays,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      COUNT(DISTINCT material_name) AS material_count
    FROM material_metrics
    WHERE metric_date = '全部'
  `).get() as Record<string, number | null>;

  const spend = row.spend ?? 0;
  const plays = row.plays ?? 0;

  return {
    spend,
    gross_gmv: row.gross_gmv ?? 0,
    gross_roi: spend > 0 ? (row.gross_gmv ?? 0) / spend : 0,
    net_gmv: row.net_gmv ?? 0,
    net_roi: spend > 0 ? (row.net_gmv ?? 0) / spend : 0,
    net_orders: row.net_orders ?? 0,
    plays,
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    material_count: row.material_count ?? 0,
    avg_click_rate: plays > 0 ? (row.clicks ?? 0) / plays : 0,
  };
}

/** TOP N 消耗素材 */
export function getTopMaterials(limit = 10, sortBy: "spend" | "gross_roi" | "gross_orders" = "spend") {
  const orderCol = sortBy === "gross_roi" ? "gross_roi" : sortBy === "gross_orders" ? "gross_orders" : "spend";
  return db.prepare(`
    SELECT material_name, spend, gross_gmv, gross_roi, gross_orders, plays, completion_rate, click_rate
    FROM material_metrics
    WHERE metric_date = '全部' AND material_name != 'AIGC动态创意视频素材集合'
    ORDER BY ${orderCol} DESC
    LIMIT ?
  `).all(limit);
}

/** 日维度趋势数据 */
export function getDailyTrends() {
  return db.prepare(`
    SELECT metric_date AS date,
      SUM(spend) AS spend,
      SUM(gross_gmv) AS gmv,
      SUM(net_gmv) AS net_gmv,
      SUM(net_orders) AS orders
    FROM product_metrics
    WHERE metric_date != '全部' AND metric_date != ''
    GROUP BY metric_date
    ORDER BY metric_date ASC
  `).all();
}

/** 素材来源分布（根据素材名称规则分类） */
export function getSourceDistribution() {
  const rows = db.prepare(`
    SELECT material_name, SUM(spend) AS spend
    FROM material_metrics
    WHERE metric_date = '全部' AND material_name != 'AIGC动态创意视频素材集合'
    GROUP BY material_name
  `).all() as Array<{ material_name: string; spend: number }>;

  let aigc = 0;
  let daren = 0;
  let local = 0;

  for (const row of rows) {
    const name = row.material_name;
    if (/AIGC|AI生成/i.test(name)) {
      aigc += row.spend;
    } else if (/达人/i.test(name)) {
      daren += row.spend;
    } else {
      local += row.spend;
    }
  }

  return [
    { label: "本地上传", value: local },
    { label: "AIGC", value: aigc },
    { label: "达人素材", value: daren },
  ].filter((d) => d.value > 0);
}

/** Dashboard 完整数据 */
export function getDashboardData() {
  return {
    summary: getProductSummary(),
    acne: getAcneStats(),
    video: getVideoSummary(),
    topMaterials: getTopMaterials(10, "spend"),
    trends: getDailyTrends(),
    topByRoi: getTopMaterials(10, "gross_roi"),
    topByOrders: getTopMaterials(10, "gross_orders"),
    sourceDist: getSourceDistribution(),
    planSummary: getPlanSummary(),
  };
}

/** 计划维度汇总 */
export function getPlanSummary() {
  return db.prepare(`
    SELECT plan_name, spend, gross_gmv, gross_roi, net_gmv, net_roi, net_orders
    FROM plan_metrics
    WHERE metric_date = '全部'
    ORDER BY spend DESC
  `).all();
}
