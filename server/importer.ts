import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "./db";
import { detectFileType, parseCsvRows, parseVideoRow, parseProductRow, parsePlanRow, detectDateRange } from "./parser";

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function toIso(date: Date | string): string {
  if (date instanceof Date) return date.toISOString();
  return new Date(date).toISOString();
}

// ====== 导入入口 ======
export interface ImportResult {
  fileType: string;
  fileName: string;
  rows: number;
  inserted: number;
  skipped: boolean;
  from: string;
  to: string;
}

export async function importReportFile(filePath: string): Promise<ImportResult> {
  const fileType = detectFileType(filePath);
  if (!fileType) throw new Error(`无法识别文件类型: ${path.basename(filePath)}`);

  const hash = sha256File(filePath);
  const stat = fs.statSync(filePath);
  const existing = db.prepare("SELECT id, hash, status FROM report_files WHERE path = ?").get(filePath) as
    | { id: number; hash: string; status: string }
    | undefined;

  if (existing?.hash === hash && existing.status === "imported") {
    return {
      fileType, fileName: path.basename(filePath), rows: 0, inserted: 0, skipped: true,
      from: "", to: "",
    };
  }

  // 删除旧数据后重新导入
  if (existing) {
    db.prepare("DELETE FROM material_metrics WHERE report_file_id = ?").run(existing.id);
    db.prepare("DELETE FROM product_metrics WHERE report_file_id = ?").run(existing.id);
    db.prepare("DELETE FROM plan_metrics WHERE report_file_id = ?").run(existing.id);
  }

  // 解析
  const rows = parseCsvRows(filePath);
  const range = detectDateRange(path.basename(filePath));

  // 创建/更新 report_file 记录
  const reportFileValues = [
    fileType,
    filePath,
    path.basename(filePath),
    path.extname(filePath).toLowerCase(),
    hash,
    stat.size,
    toIso(stat.mtime),
    new Date().toISOString(),
    rows.length,
    "imported",
    "",
  ];

  let reportFileId: number;
  if (existing) {
    db.prepare(
      `UPDATE report_files SET file_type=?, path=?, file_name=?, extension=?, hash=?, size=?,
       last_modified=?, imported_at=?, row_count=?, status=?, error=? WHERE id=?`
    ).run(...reportFileValues, existing.id);
    reportFileId = existing.id;
  } else {
    const result = db.prepare(
      `INSERT INTO report_files (file_type, path, file_name, extension, hash, size, last_modified,
       imported_at, row_count, status, error) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(...reportFileValues);
    reportFileId = Number(result.lastInsertRowid);
  }

  // 逐行解析并入库
  let inserted = 0;
  const now = new Date().toISOString();

  const insertVideo = db.prepare(
    `INSERT INTO material_metrics (material_id, material_name, material_created_at, metric_date,
     impressions, clicks, click_rate, conversion_rate, spend, gross_orders, gross_gmv, gross_roi,
     order_cost, cpm, cpc, net_roi, net_gmv, net_orders, net_order_cost, net_settlement_rate,
     refund_rate_1h, refund_amount_1h, plays, completion_rate, avg_watch_seconds, rate_3s, rate_5s,
     report_file_id, raw_json, imported_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  const insertProduct = db.prepare(
    `INSERT INTO product_metrics (product_id, product_name, metric_date,
     impressions, clicks, click_rate, conversion_rate, spend, gross_gmv, gross_roi,
     order_cost, gross_orders, actual_pay_amount, platform_subsidy, net_roi, net_gmv,
     net_orders, net_order_cost, net_settlement_rate, refund_rate_1h, refund_amount_1h,
     gmv_settlement_rate_7d, report_file_id, imported_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  const insertPlan = db.prepare(
    `INSERT INTO plan_metrics (plan_name, plan_id, metric_date, spend, gross_orders, gross_gmv,
     gross_roi, order_cost, actual_pay_amount, platform_subsidy, net_roi, net_gmv,
     net_order_cost, net_orders, net_settlement_rate, refund_rate_1h, refund_amount_1h,
     gmv_settlement_rate_7d, settled_amount_7d, settled_amount_14d, report_file_id, imported_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  if (fileType === "video") {
    for (const row of rows) {
      const parsed = parseVideoRow(row);
      if (!parsed) continue;
      insertVideo.run(
        parsed.material_id, parsed.material_name, parsed.material_created_at, parsed.metric_date,
        parsed.impressions, parsed.clicks, parsed.click_rate, parsed.conversion_rate,
        parsed.spend, parsed.gross_orders, parsed.gross_gmv, parsed.gross_roi,
        parsed.order_cost, parsed.cpm, parsed.cpc,
        parsed.net_roi, parsed.net_gmv, parsed.net_orders, parsed.net_order_cost, parsed.net_settlement_rate,
        parsed.refund_rate_1h, parsed.refund_amount_1h,
        parsed.plays, parsed.completion_rate, parsed.avg_watch_seconds, parsed.rate_3s, parsed.rate_5s,
        reportFileId, parsed.raw_json, now
      );
      inserted++;
    }
  } else if (fileType === "product") {
    for (const row of rows) {
      const parsed = parseProductRow(row);
      if (!parsed) continue;
      insertProduct.run(
        parsed.product_id, parsed.product_name, parsed.metric_date,
        parsed.impressions, parsed.clicks, parsed.click_rate, parsed.conversion_rate,
        parsed.spend, parsed.gross_gmv, parsed.gross_roi, parsed.order_cost, parsed.gross_orders,
        parsed.actual_pay_amount, parsed.platform_subsidy,
        parsed.net_roi, parsed.net_gmv, parsed.net_orders, parsed.net_order_cost, parsed.net_settlement_rate,
        parsed.refund_rate_1h, parsed.refund_amount_1h, parsed.gmv_settlement_rate_7d,
        reportFileId, now
      );
      inserted++;
    }
  } else if (fileType === "plan") {
    for (const row of rows) {
      const parsed = parsePlanRow(row);
      if (!parsed) continue;
      insertPlan.run(
        parsed.plan_name, parsed.plan_id, parsed.metric_date,
        parsed.spend, parsed.gross_orders, parsed.gross_gmv, parsed.gross_roi, parsed.order_cost,
        parsed.actual_pay_amount, parsed.platform_subsidy,
        parsed.net_roi, parsed.net_gmv, parsed.net_order_cost, parsed.net_orders, parsed.net_settlement_rate,
        parsed.refund_rate_1h, parsed.refund_amount_1h, parsed.gmv_settlement_rate_7d,
        parsed.settled_amount_7d, parsed.settled_amount_14d,
        reportFileId, now
      );
      inserted++;
    }
  }

  return {
    fileType, fileName: path.basename(filePath), rows: rows.length, inserted,
    skipped: false, from: range.from, to: range.to,
  };
}
