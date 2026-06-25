import { db } from "./db";
import { sendFeishuMessage } from "./feishu-client";
import { money } from "./format-utils";

// ====== Alert Types ======
type AlertLevel = "high" | "medium" | "low" | "positive";

interface Alert {
  id?: number;
  level: AlertLevel;
  type: string;
  entity_name: string;
  message: string;
  checked_at: string;
}

// Ensure alerts table
db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK(level IN ('high','medium','low','positive')),
    type TEXT NOT NULL,
    entity_name TEXT NOT NULL,
    message TEXT NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
`);

// ====== Check Zero-Order Alert (High) ======
function checkZeroOrders(thresholdSpend = 100): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  // Materials with spend >= threshold but 0 orders on the latest 3 days
  // We look at yesterday, day before yesterday, day before that
  const materials = db.prepare(`
    SELECT material_name,
           SUM(CASE WHEN metric_date = date('now','-1 day') THEN spend ELSE 0 END) AS d1_spend,
           SUM(CASE WHEN metric_date = date('now','-1 day') THEN gross_orders ELSE 0 END) AS d1_orders,
           SUM(CASE WHEN metric_date = date('now','-2 day') THEN spend ELSE 0 END) AS d2_spend,
           SUM(CASE WHEN metric_date = date('now','-2 day') THEN gross_orders ELSE 0 END) AS d2_orders,
           SUM(CASE WHEN metric_date = date('now','-3 day') THEN spend ELSE 0 END) AS d3_spend,
           SUM(CASE WHEN metric_date = date('now','-3 day') THEN gross_orders ELSE 0 END) AS d3_orders
    FROM material_metrics
    WHERE metric_date >= date('now','-3 day')
    GROUP BY material_name
    HAVING d1_spend >= ${thresholdSpend} AND d1_orders = 0
       AND d2_spend >= ${thresholdSpend} AND d2_orders = 0
       AND d3_spend >= ${thresholdSpend} AND d3_orders = 0
  `).all() as Array<Record<string, number>>;

  for (const m of materials) {
    alerts.push({
      level: "high",
      type: "zero_orders",
      entity_name: String(m.material_name),
      message: `🔴 零成交预警: "${String(m.material_name).slice(0, 30)}" 连续3天消耗≥¥${thresholdSpend}但零订单，建议暂停或优化`,
      checked_at: now,
    });
  }
  return alerts;
}

// ====== Check ROI Drop Alert (Medium) ======
function checkRoiDrop(threshold = 0.5): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  // Get yesterday's ROI vs 7-day average ROI
  const materials = db.prepare(`
    SELECT material_name,
           SUM(CASE WHEN metric_date = date('now','-1 day') THEN spend ELSE 0 END) AS yesterday_spend,
           SUM(CASE WHEN metric_date = date('now','-1 day') THEN net_gmv ELSE 0 END) AS yesterday_net,
           AVG(CASE WHEN metric_date BETWEEN date('now','-8 day') AND date('now','-2 day') THEN
             CASE WHEN spend > 0 THEN net_gmv / spend ELSE NULL END
           END) AS avg_7d_roi
    FROM material_metrics
    WHERE metric_date >= date('now','-8 day')
    GROUP BY material_name
    HAVING yesterday_spend > 0
  `).all() as Array<Record<string, number>>;

  for (const m of materials) {
    const yesterdayRoi = m.yesterday_spend > 0 ? m.yesterday_net / m.yesterday_spend : 0;
    const avgRoi = m.avg_7d_roi ?? 1;
    if (avgRoi > 0.01 && yesterdayRoi > 0 && yesterdayRoi < avgRoi * threshold) {
      const drop = ((1 - yesterdayRoi / avgRoi) * 100).toFixed(0);
      alerts.push({
        level: "medium",
        type: "roi_drop",
        entity_name: String(m.material_name),
        message: `🟠 ROI骤降: "${String(m.material_name).slice(0, 30)}" 昨日ROI ${yesterdayRoi.toFixed(2)} 较7日均值 ${avgRoi.toFixed(2)} 下降${drop}% (>50%)`,
        checked_at: now,
      });
    }
  }
  return alerts;
}

// ====== Check Spend Spike (Low) ======
function checkSpendSpike(threshold = 2.0): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  const materials = db.prepare(`
    SELECT material_name,
           SUM(CASE WHEN metric_date = date('now','-1 day') THEN spend ELSE 0 END) AS yesterday_spend,
           AVG(CASE WHEN metric_date BETWEEN date('now','-8 day') AND date('now','-2 day') THEN spend END) AS avg_7d_spend
    FROM material_metrics
    WHERE metric_date >= date('now','-8 day')
    GROUP BY material_name
    HAVING yesterday_spend > avg_7d_spend * ${threshold} AND avg_7d_spend > 100
  `).all() as Array<Record<string, number>>;

  for (const m of materials) {
    alerts.push({
      level: "low",
      type: "spend_spike",
      entity_name: String(m.material_name),
      message: `🟡 消耗异常: "${String(m.material_name).slice(0, 30)}" 昨日消耗 ${money(m.yesterday_spend)} 是7日均值 ${money(m.avg_7d_spend)} 的 ${(m.yesterday_spend / Math.max(m.avg_7d_spend, 1)).toFixed(1)}x`,
      checked_at: now,
    });
  }
  return alerts;
}

// ====== Check Rising Star (Positive) ======
function checkRisingStar(minSpend = 500, minRoi = 2.0): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  // New materials (first appeared in last 3 days) with high spend and ROI
  const materials = db.prepare(`
    SELECT material_name,
           SUM(spend) AS total_spend,
           SUM(net_gmv) AS total_net,
           MIN(metric_date) AS first_seen
    FROM material_metrics
    WHERE metric_date != '全部' AND material_name != 'AIGC动态创意视频素材集合'
    GROUP BY material_name
    HAVING first_seen >= date('now','-3 day')
       AND total_spend > ${minSpend}
       AND total_spend > 0
  `).all() as Array<Record<string, number | string>>;

  for (const m of materials) {
    const roi = (m.total_net as number) / (m.total_spend as number);
    if (roi > minRoi) {
      alerts.push({
        level: "positive",
        type: "rising_star",
        entity_name: String(m.material_name),
        message: `🟢 爆款发现: "${String(m.material_name).slice(0, 30)}" 3天消耗 ${money(m.total_spend as number)} ROI ${roi.toFixed(2)}，建议追投`,
        checked_at: now,
      });
    }
  }
  return alerts;
}

// ====== Run All Checks ======
export function runAllChecks(config?: {
  zeroOrderThreshold?: number;
  roiDropThreshold?: number;
  spendSpikeThreshold?: number;
  risingStarMinSpend?: number;
  risingStarMinRoi?: number;
}) {
  const allAlerts = [
    ...checkZeroOrders(config?.zeroOrderThreshold ?? 100),
    ...checkRoiDrop(config?.roiDropThreshold ?? 0.5),
    ...checkSpendSpike(config?.spendSpikeThreshold ?? 2.0),
    ...checkRisingStar(config?.risingStarMinSpend ?? 500, config?.risingStarMinRoi ?? 2.0),
  ];

  const now = new Date().toISOString();

  // Dedup: same type + same entity within last 24h
  const recentAlerts = db.prepare(
    `SELECT type, entity_name, notified FROM alerts WHERE created_at >= datetime('now','-1 day')`
  ).all() as Array<{ type: string; entity_name: string; notified: number }>;

  const recentKeyMap = new Set(recentAlerts.filter(a => a.notified).map(a => `${a.type}:${a.entity_name}`));

  const freshAlerts = allAlerts.filter(a => !recentKeyMap.has(`${a.type}:${a.entity_name}`));
  const newIds: number[] = [];

  for (const alert of freshAlerts) {
    const result = db.prepare(
      `INSERT INTO alerts (level, type, entity_name, message, notified, created_at)
       VALUES (?,?,?,?,0,?)`
    ).run(alert.level, alert.type, alert.entity_name, alert.message, now);
    newIds.push(Number(result.lastInsertRowid));
  }

  return { checkedAt: now, total: allAlerts.length, fresh: freshAlerts.length, high: allAlerts.filter(a => a.level === "high").length, medium: allAlerts.filter(a => a.level === "medium").length, ids: newIds };
}

// ====== Notify high-severity alerts ======
export async function notifyHighAlerts() {
  const highAlerts = db.prepare(
    `SELECT * FROM alerts WHERE level IN ('high','medium') AND notified = 0 ORDER BY created_at DESC LIMIT 10`
  ).all() as unknown as Alert[];

  if (!highAlerts.length) return { notified: 0 };

  const lines = highAlerts.map(a => a.message);
  const text = `⚠️ 千川视频投放预警 (${new Date().toLocaleString("zh-CN")})\n\n${lines.join("\n")}`;

  const result = await sendFeishuMessage(text);

  if (result.ok) {
    for (const a of highAlerts) {
      db.prepare("UPDATE alerts SET notified = 1 WHERE id = ?").run(a.id!);
    }
  }

  return { notified: highAlerts.length, imSent: result.ok };
}

// ====== Get alerts history ======
export function getAlerts(level?: string, limit = 50) {
  let where = "";
  const params: any[] = [];
  if (level) { where = "WHERE level = ?"; params.push(level); }
  return db.prepare(
    `SELECT * FROM alerts ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, limit);
}

// ====== Resolve alert ======
export function resolveAlert(id: number) {
  db.prepare("UPDATE alerts SET resolved_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  return { ok: true };
}
