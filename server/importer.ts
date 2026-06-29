import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "./db";
import { detectFileType, parseCsvRows, parseVideoRow, parseProductRow, parsePlanRow, detectDateRange } from "./parser";

// ====== 防重复铁律 ======
// 导入前先清空该类型的所有数据, 再导入最新文件。
// 永不累积, 永不依赖哈希去重。

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** 清空指定类型的所有数据 */
function purgeType(fileType: string) {
  if (fileType === "video") {
    db.prepare("DELETE FROM material_metrics").run();
    db.prepare("DELETE FROM report_files WHERE file_type = 'video'").run();
  } else if (fileType === "product") {
    db.prepare("DELETE FROM product_metrics").run();
    db.prepare("DELETE FROM report_files WHERE file_type = 'product'").run();
  } else if (fileType === "plan") {
    db.prepare("DELETE FROM plan_metrics").run();
    db.prepare("DELETE FROM report_files WHERE file_type = 'plan'").run();
  }
}

export interface ImportResult {
  fileType: string;
  fileName: string;
  rows: number;
  inserted: number;
  from: string;
  to: string;
}

/** 导入一个CSV文件 (会先清空该类型旧数据!) */
export async function importReportFile(filePath: string): Promise<ImportResult> {
  const fileType = detectFileType(filePath);
  if (!fileType) throw new Error(`无法识别文件类型: ${path.basename(filePath)}`);

  const fhash = sha256File(filePath);
  const stat = fs.statSync(filePath);
  const fname = path.basename(filePath);

  // 检查是否已经导入过这个哈希 (精确去重)
  const existingByHash = db.prepare("SELECT id FROM report_files WHERE hash = ?").get(fhash) as { id: number } | undefined;
  if (existingByHash) {
    return { fileType, fileName: fname, rows: 0, inserted: 0, from: "", to: "" };
  }

  // 🔴 铁律: 导入前清空该类型所有旧数据
  purgeType(fileType);

  // Parse
  const rows = parseCsvRows(filePath);
  const range = detectDateRange(fname);

  // Insert report_files record
  const cur = db.prepare(`INSERT INTO report_files (file_type, path, file_name, extension, hash, size, last_modified, imported_at, row_count, status, error)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    fileType, filePath, fname, path.extname(fname).toLowerCase(), fhash, stat.size,
    stat.mtime.toISOString(), new Date().toISOString(), rows.length, "imported", "");
  const fid = Number(cur.lastInsertRowid);

  const now = new Date().toISOString();
  let inserted = 0;

  if (fileType === "video") {
    const stmt = db.prepare(`INSERT INTO material_metrics (material_id,material_name,material_created_at,metric_date,
      impressions,clicks,click_rate,conversion_rate,spend,
      gross_orders,gross_gmv,gross_roi,order_cost,cpm,cpc,
      net_roi,net_gmv,net_orders,net_order_cost,net_settlement_rate,
      refund_rate_1h,refund_amount_1h,plays,completion_rate,avg_watch_seconds,rate_3s,rate_5s,
      report_file_id,raw_json,imported_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of rows) {
      const m = parseVideoRow(row);
      if (!m) continue;
      stmt.run(m.material_id, m.material_name, m.material_created_at, m.metric_date,
        m.impressions, m.clicks, m.click_rate, m.conversion_rate, m.spend,
        m.gross_orders, m.gross_gmv, m.gross_roi, m.order_cost, m.cpm, m.cpc,
        m.net_roi, m.net_gmv, m.net_orders, m.net_order_cost, m.net_settlement_rate,
        m.refund_rate_1h, m.refund_amount_1h, m.plays, m.completion_rate, m.avg_watch_seconds, m.rate_3s, m.rate_5s,
        fid, JSON.stringify(row), now);
      inserted++;
    }
  } else if (fileType === "product") {
    const stmt = db.prepare(`INSERT INTO product_metrics (product_id,product_name,metric_date,
      impressions,clicks,click_rate,conversion_rate,spend,gross_gmv,gross_roi,order_cost,gross_orders,
      actual_pay_amount,platform_subsidy,net_roi,net_gmv,net_orders,
      net_order_cost,net_settlement_rate,refund_rate_1h,refund_amount_1h,
      gmv_settlement_rate_7d,report_file_id,imported_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of rows) {
      const m = parseProductRow(row);
      if (!m) continue;
      stmt.run(m.product_id, m.product_name, m.metric_date,
        m.impressions, m.clicks, m.click_rate, m.conversion_rate,
        m.spend, m.gross_gmv, m.gross_roi, m.order_cost, m.gross_orders,
        m.actual_pay_amount, m.platform_subsidy, m.net_roi, m.net_gmv, m.net_orders,
        m.net_order_cost, m.net_settlement_rate, m.refund_rate_1h, m.refund_amount_1h,
        m.gmv_settlement_rate_7d, fid, now);
      inserted++;
    }
  } else if (fileType === "plan") {
    const stmt = db.prepare(`INSERT INTO plan_metrics (plan_name,plan_id,metric_date,
      spend,gross_orders,gross_gmv,gross_roi,order_cost,
      actual_pay_amount,platform_subsidy,net_roi,net_gmv,
      net_order_cost,net_orders,net_settlement_rate,
      refund_rate_1h,refund_amount_1h,gmv_settlement_rate_7d,
      settled_amount_7d,settled_amount_14d,report_file_id,imported_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of rows) {
      const m = parsePlanRow(row);
      if (!m) continue;
      stmt.run(m.plan_name, m.plan_id, m.metric_date,
        m.spend, m.gross_orders, m.gross_gmv, m.gross_roi, m.order_cost,
        m.actual_pay_amount, m.platform_subsidy, m.net_roi, m.net_gmv,
        m.net_order_cost, m.net_orders, m.net_settlement_rate,
        m.refund_rate_1h, m.refund_amount_1h, m.gmv_settlement_rate_7d,
        m.settled_amount_7d, m.settled_amount_14d, fid, now);
      inserted++;
    }
  }

  console.log(`[import] ${fileType}: ${inserted}/${rows.length} rows from ${fname}`);
  return { fileType, fileName: fname, rows: rows.length, inserted, from: range.from, to: range.to };
}

// ====== 全量导入 (取每类型最新文件，清旧数据后导入) ======
const DATA_DIRS = [
  String.raw`E:\视频数据\2026抖音\2026-06_千川视频`,
  String.raw`Z:\摄影部\10.抖音信息流&视频号\0视频投放数据\抖音\2026-06_千川视频`,
];

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && /\.csv$/i.test(e.name)) files.push(full);
    }
  }
  return files;
}

/** 按类型取每个类型的最新文件 */
export function findLatestFiles(): string[] {
  const byType = new Map<string, { path: string; mtime: number }>();
  for (const dir of DATA_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const fp of walkFiles(dir)) {
      const ft = detectFileType(fp);
      if (!ft) continue;
      const mt = fs.statSync(fp).mtimeMs;
      const old = byType.get(ft);
      if (!old || mt > old.mtime) byType.set(ft, { path: fp, mtime: mt });
    }
  }
  return Array.from(byType.values()).map(v => v.path);
}

/** 一键全部重导: 清空 → 导入最新3文件 → 验证 */
export async function reimportAll() {
  console.log("[reimport] 开始全量重导...");
  // 清空所有
  db.prepare("DELETE FROM material_metrics").run();
  db.prepare("DELETE FROM product_metrics").run();
  db.prepare("DELETE FROM plan_metrics").run();
  db.prepare("DELETE FROM report_files").run();

  const files = findLatestFiles();
  const results: ImportResult[] = [];
  for (const fp of files) {
    results.push(await importReportFile(fp));
  }

  // 验证
  const row = db.prepare("SELECT SUM(spend),SUM(net_gmv),SUM(net_orders) FROM product_metrics WHERE metric_date = '全部'").get() as any;
  console.log(`[reimport] 完成. 产品消耗=${row['SUM(spend)']?.toFixed(2)} 净成交=${row['SUM(net_gmv)']?.toFixed(2)} 净订单=${row['SUM(net_orders)']}`);

  // 自动验证: 商品消耗 必须 = 计划消耗
  const planRow = db.prepare("SELECT SUM(spend) FROM plan_metrics WHERE metric_date = '全部'").get() as any;
  const productSpend = row['SUM(spend)'] ?? 0;
  const planSpend = planRow['SUM(spend)'] ?? 0;
  if (Math.abs(productSpend - planSpend) > 1) {
    console.error(`[reimport] ⚠️ 数据不一致! 商品消耗=${productSpend.toFixed(2)} 计划消耗=${planSpend.toFixed(2)}`);
  } else {
    console.log(`[reimport] ✅ 商品消耗=计划消耗=${productSpend.toFixed(2)}`);
  }

  return { files: results.length, productSpend, planSpend };
}
