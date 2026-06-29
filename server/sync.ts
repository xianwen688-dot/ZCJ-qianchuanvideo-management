import path from "node:path";
import { db } from "./db";
import { findLatestFiles, importReportFile, type ImportResult } from "./importer";

// ====== 日期过滤辅助 ======
interface DateFilter {
  from?: string;
  to?: string;
}

function dateClause(table: string, df?: DateFilter): { where: string; params: string[] } {
  if (df?.from && df?.to) {
    return {
      where: `WHERE ${table}.metric_date BETWEEN ? AND ?`,
      params: [df.from, df.to],
    };
  }
  return { where: `WHERE ${table}.metric_date = '全部'`, params: [] };
}

function dateClauseAll(df?: DateFilter): { where: string; params: string[] } {
  if (df?.from && df?.to) {
    return {
      where: "WHERE metric_date BETWEEN ? AND ?",
      params: [df.from, df.to],
    };
  }
  return { where: "WHERE metric_date = '全部'", params: [] };
}

// ====== 全量同步 ======
export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  files: ImportResult[];
  totalRows: number;
  errors: string[];
}

export async function runFullSync(): Promise<SyncResult> {
  const result: SyncResult = { startedAt: new Date().toISOString(), finishedAt: "", files: [], totalRows: 0, errors: [] };

  for (const filePath of findLatestFiles()) {
    try {
      const imported = await importReportFile(filePath);
      result.files.push(imported);
      result.totalRows += imported.inserted;
    } catch (err) {
      result.errors.push(`${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  result.finishedAt = new Date().toISOString();
  return result;
}

// ====== Dashboard 查询 (支持日期范围) ======

/** 商品维度汇总 */
export function getProductSummary(df?: DateFilter) {
  const dc = dateClauseAll(df);
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
    ${dc.where}
  `).get(...dc.params) as Record<string, number | null>;

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
    conservative_roi: spend > 0 ? (netGmv * 0.85) / spend : 0,
  };
}

/** 祛痘类专项 */
export function getAcneStats(df?: DateFilter) {
  const dc = dateClauseAll(df);
  const rows = db.prepare(`
    SELECT product_name, SUM(spend) AS spend, SUM(net_gmv) AS net_gmv,
           SUM(net_orders) AS net_orders, SUM(refund_amount_1h) AS refund_amount_1h
    FROM product_metrics
    ${dc.where}
      AND (product_name LIKE '%苦参%' OR product_name LIKE '%祛痘%')
    GROUP BY product_name
    ORDER BY spend DESC
  `).all(...dc.params) as Array<Record<string, number>>;

  const totalSpend = rows.reduce((s, r) => s + (r.spend ?? 0), 0);
  const totalNet = rows.reduce((s, r) => s + (r.net_gmv ?? 0), 0);
  const totalOrders = rows.reduce((s, r) => s + (r.net_orders ?? 0), 0);
  const totalRefund = rows.reduce((s, r) => s + (r.refund_amount_1h ?? 0), 0);

  const targetProducts = ["苦参祛痘精华霜", "苦参祛痘2件套", "苦参祛痘4件套", "苦参祛痘组合"];
  const jinghuaOrders = rows
    .filter((r) => targetProducts.some((t) => String(r.product_name ?? "").includes(t)))
    .reduce((s, r) => s + (r.net_orders ?? 0), 0);

  const allSpend = (db.prepare(`SELECT SUM(spend) AS total FROM product_metrics ${dc.where}`).get(...dc.params) as { total: number }).total ?? 1;

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
      net_roi: r.spend > 0 ? (r.net_gmv ?? 0) / r.spend : 0,
      net_orders: r.net_orders,
    })),
  };
}

/** 视频维度汇总 */
export function getVideoSummary(df?: DateFilter) {
  const dc = dateClauseAll(df);
  const row = db.prepare(`
    SELECT
      SUM(spend) AS spend, SUM(gross_gmv) AS gross_gmv, SUM(net_gmv) AS net_gmv,
      SUM(net_orders) AS net_orders, SUM(plays) AS plays, SUM(clicks) AS clicks,
      SUM(impressions) AS impressions, COUNT(DISTINCT material_name) AS material_count
    FROM material_metrics
    ${dc.where}
  `).get(...dc.params) as Record<string, number | null>;

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

/** TOP N */
export function getTopMaterials(limit = 10, sortBy: "spend" | "gross_roi" | "gross_orders" = "spend", df?: DateFilter) {
  const dc = dateClauseAll(df);
  const orderCol = sortBy === "gross_roi" ? "gross_roi" : sortBy === "gross_orders" ? "gross_orders" : "spend";
  return db.prepare(`
    SELECT material_name, SUM(spend) AS spend, SUM(gross_gmv) AS gross_gmv,
           CASE WHEN SUM(spend) > 0 THEN SUM(gross_gmv)/SUM(spend) ELSE 0 END AS gross_roi,
           SUM(gross_orders) AS gross_orders, SUM(plays) AS plays,
           AVG(completion_rate) AS completion_rate, AVG(click_rate) AS click_rate
    FROM material_metrics
    ${dc.where} AND material_name != 'AIGC动态创意视频素材集合'
    GROUP BY material_name
    ORDER BY ${orderCol} DESC
    LIMIT ?
  `).all(...dc.params, limit);
}

/** 日趋势 */
export function getDailyTrends(df?: DateFilter) {
  if (df?.from && df?.to) {
    return db.prepare(`
      SELECT metric_date AS date, SUM(spend) AS spend, SUM(gross_gmv) AS gmv,
             SUM(net_gmv) AS net_gmv, SUM(net_orders) AS orders
      FROM product_metrics
      WHERE metric_date BETWEEN ? AND ?
      GROUP BY metric_date ORDER BY metric_date ASC
    `).all(df.from, df.to);
  }
  return db.prepare(`
    SELECT metric_date AS date, SUM(spend) AS spend, SUM(gross_gmv) AS gmv,
           SUM(net_gmv) AS net_gmv, SUM(net_orders) AS orders
    FROM product_metrics
    WHERE metric_date != '全部' AND metric_date != ''
    GROUP BY metric_date ORDER BY metric_date ASC
  `).all();
}

/** 来源分布 (消耗) */
function classifySource(name: string): string {
  if (/AIGC|AI生成|AI剪辑|ai剪辑|ai生成|半ai|纯AI|半AI/i.test(name)) return "AIGC/AI剪辑";
  if (/达人|素人/i.test(name)) return "达人素材";
  return "本地上传";
}

export function getSourceDistribution(df?: DateFilter) {
  const dc = dateClauseAll(df);
  const rows = db.prepare(`
    SELECT material_name, SUM(spend) AS spend, SUM(net_gmv) AS net_gmv
    FROM material_metrics
    ${dc.where} AND material_name != 'AIGC动态创意视频素材集合'
    GROUP BY material_name
  `).all(...dc.params) as Array<{ material_name: string; spend: number; net_gmv: number }>;

  const spendMap: Record<string, number> = {};
  const netMap: Record<string, number> = {};
  for (const row of rows) {
    const cat = classifySource(row.material_name);
    spendMap[cat] = (spendMap[cat] || 0) + (row.spend || 0);
    netMap[cat] = (netMap[cat] || 0) + (row.net_gmv || 0);
  }

  const toList = (m: Record<string, number>) =>
    Object.entries(m).map(([label, value]) => ({ label, value })).filter((d) => d.value > 0);

  return {
    bySpend: toList(spendMap),
    byNet: toList(netMap),
  };
}

/** 计划汇总 */
export function getPlanSummary(df?: DateFilter) {
  const dc = dateClauseAll(df);
  return db.prepare(`
    SELECT plan_name, SUM(spend) AS spend, SUM(gross_gmv) AS gross_gmv,
           CASE WHEN SUM(spend)>0 THEN SUM(gross_gmv)/SUM(spend) ELSE 0 END AS gross_roi,
           SUM(net_gmv) AS net_gmv,
           CASE WHEN SUM(spend)>0 THEN SUM(net_gmv)/SUM(spend) ELSE 0 END AS net_roi,
           SUM(net_orders) AS net_orders
    FROM plan_metrics
    ${dc.where}
    GROUP BY plan_name
    ORDER BY spend DESC
  `).all(...dc.params);
}

/** Dashboard 完整 */
export function getDashboardData(df?: DateFilter) {
  return {
    summary: getProductSummary(df),
    acne: getAcneStats(df),
    video: getVideoSummary(df),
    topMaterials: getTopMaterials(10, "spend", df),
    trends: getDailyTrends(df),
    topByRoi: getTopMaterials(10, "gross_roi", df),
    topByOrders: getTopMaterials(10, "gross_orders", df),
    sourceDist: getSourceDistribution(df),
    planSummary: getPlanSummary(df),
  };
}
