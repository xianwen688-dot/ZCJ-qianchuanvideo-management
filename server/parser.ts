import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { decodeText, cleanCell, parseNumber, parsePercent } from "./utils";
import { readXlsxRows } from "./xlsxReader";

// ====== CSV 文件类型检测 ======
export type CsvFileType = "video" | "product" | "plan";

export function detectFileType(filePath: string): CsvFileType | null {
  const name = path.basename(filePath);
  if (/全域推广数据-视频/i.test(name)) return "video";
  if (/全域推广数据_商品/i.test(name)) return "product";
  if (/全域推广数据_计划/i.test(name)) return "plan";
  return null;
}

// ====== 日期范围从文件名提取 ======
export function detectDateRange(fileName: string): { from: string; to: string } {
  const dates: string[] = [];
  const re = /20\d{2}-\d{2}-\d{2}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fileName)) !== null) {
    dates.push(match[0]);
  }
  if (dates.length >= 2) return { from: dates[0], to: dates[1] };
  if (dates.length === 1) return { from: dates[0], to: dates[0] };
  return { from: "", to: "" };
}

// ====== 解析 CSV ======
export function parseCsvRows(filePath: string): Record<string, string>[] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls") {
    return parseXlsxRows(filePath);
  }
  const buffer = fs.readFileSync(filePath);
  const text = decodeText(buffer);
  const rawRows = parse(text, {
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as string[][];

  if (rawRows.length < 2) return [];
  const headers = rawRows[0].map(cleanCell);

  // Build objects, truncating extra columns (some CSV rows have extra trailing data)
  return rawRows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i] || `col${i}`] = row[i]?.trim() ?? "";
    }
    return obj;
  });
}

function parseXlsxRows(filePath: string): Record<string, string>[] {
  const rawRows = readXlsxRowsSync(filePath);
  const headerIndex = rawRows.findIndex((row) => row.filter((cell) => cleanCell(cell)).length >= 2);
  if (headerIndex < 0) return [];
  const headers = rawRows[headerIndex].map(cleanCell);
  return rawRows.slice(headerIndex + 1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header || `col${index + 1}`, row[index] ?? ""]))
  );
}

// XLSX sync wrapper (原 xlsxReader.ts 是 async，这里提供一个同步版本)
function readXlsxRowsSync(filePath: string): string[][] {
  // 委托给 xlsxReader 的异步版本不行，直接用 csv 格式
  // 千川导出的都是 CSV，XLSX 路径暂时不实现
  throw new Error("XLSX files are not supported yet. Please export as CSV from Qiangchuan.");
}

// ====== 字段映射 ======

function getField(row: Record<string, string>, candidates: string[]): string {
  const keys = Object.keys(row);
  // IMPORTANT: prefer EXACT or shortest match to avoid 净成交金额→净成交金额结算率 trap
  for (const candidate of candidates) {
    // First pass: exact match
    const exact = keys.find((k) => k === candidate);
    if (exact) return cleanCell(row[exact]);
  }
  for (const candidate of candidates) {
    // Second pass: shortest partial match (shorter header = more likely correct)
    let best = "";
    let bestLen = 999;
    for (const k of keys) {
      if (k.includes(candidate) && k.length < bestLen) {
        best = k; bestLen = k.length;
      }
    }
    if (best) return cleanCell(row[best]);
  }
  return "";
}

/** 解析视频 CSV 的一行 */
export function parseVideoRow(row: Record<string, string>) {
  const materialName = getField(row, ["素材视频名称", "素材名称", "视频名称", "内容标题"]);
  if (!materialName || materialName === "全部") return null;

  const spend = parseNumber(getField(row, ["整体消耗", "消耗"])) ?? 0;
  const netGmv = parseNumber(getField(row, ["净成交金额"])) ?? 0;
  const grossGmv = parseNumber(getField(row, ["整体成交金额"])) ?? 0;
  const netOrders = Math.round(parseNumber(getField(row, ["净成交订单数"])) ?? 0);
  const grossOrders = Math.round(parseNumber(getField(row, ["整体成交订单数"])) ?? 0);

  return {
    material_id: getField(row, ["素材ID"]),
    material_name: materialName,
    material_created_at: getField(row, ["素材创建时间"]),
    metric_date: getField(row, ["日期"]),
    impressions: Math.round(parseNumber(getField(row, ["整体展示次数"])) ?? 0),
    clicks: Math.round(parseNumber(getField(row, ["整体点击次数"])) ?? 0),
    click_rate: parsePercent(getField(row, ["整体点击率"])) ?? 0,
    conversion_rate: parsePercent(getField(row, ["整体转化率"])) ?? 0,
    spend,
    gross_orders: grossOrders,
    gross_gmv: grossGmv,
    gross_roi: spend > 0 ? grossGmv / spend : 0,
    order_cost: parseNumber(getField(row, ["整体成交订单成本"])) ?? 0,
    cpm: parseNumber(getField(row, ["整体千次展现费用"])) ?? 0,
    cpc: parseNumber(getField(row, ["整体点击单价"])) ?? 0,
    net_roi: spend > 0 ? netGmv / spend : 0,
    net_gmv: netGmv,
    net_orders: netOrders,
    net_order_cost: parseNumber(getField(row, ["净成交订单成本"])) ?? 0,
    net_settlement_rate: parsePercent(getField(row, ["净成交金额结算率"])) ?? 0,
    refund_rate_1h: parsePercent(getField(row, ["1小时内退款率"])) ?? 0,
    refund_amount_1h: parseNumber(getField(row, ["1小时内退款金额"])) ?? 0,
    plays: Math.round(parseNumber(getField(row, ["视频播放数"])) ?? 0),
    completion_rate: parsePercent(getField(row, ["视频完播率"])) ?? 0,
    avg_watch_seconds: parseNumber(getField(row, ["平均观看时长"])) ?? 0,
    rate_3s: parsePercent(getField(row, ["3秒播放率"])) ?? 0,
    rate_5s: parsePercent(getField(row, ["5秒播放率"])) ?? 0,
    raw_json: JSON.stringify(row),
  };
}

/** 解析商品 CSV 的一行 */
export function parseProductRow(row: Record<string, string>) {
  const productId = getField(row, ["商品ID"]);
  const productName = getField(row, ["商品名称"]);
  if (!productName || productName === "全部") return null;

  const spend = parseNumber(getField(row, ["整体消耗", "消耗"])) ?? 0;
  const netGmv = parseNumber(getField(row, ["净成交金额"])) ?? 0;
  const grossGmv = parseNumber(getField(row, ["整体成交金额"])) ?? 0;

  return {
    product_id: productId,
    product_name: productName,
    metric_date: getField(row, ["日期"]),
    impressions: Math.round(parseNumber(getField(row, ["整体展示次数"])) ?? 0),
    clicks: Math.round(parseNumber(getField(row, ["整体点击次数"])) ?? 0),
    click_rate: parsePercent(getField(row, ["整体点击率"])) ?? 0,
    conversion_rate: parsePercent(getField(row, ["整体转化率"])) ?? 0,
    spend,
    gross_gmv: grossGmv,
    gross_roi: spend > 0 ? grossGmv / spend : 0,
    order_cost: parseNumber(getField(row, ["整体成交订单成本"])) ?? 0,
    gross_orders: Math.round(parseNumber(getField(row, ["整体成交订单数"])) ?? 0),
    actual_pay_amount: parseNumber(getField(row, ["用户实际支付金额"])) ?? 0,
    platform_subsidy: parseNumber(getField(row, ["电商平台补贴金额"])) ?? 0,
    net_roi: spend > 0 ? netGmv / spend : 0,
    net_gmv: netGmv,
    net_orders: Math.round(parseNumber(getField(row, ["净成交订单数"])) ?? 0),
    net_order_cost: parseNumber(getField(row, ["净成交订单成本"])) ?? 0,
    net_settlement_rate: parsePercent(getField(row, ["净成交金额结算率"])) ?? 0,
    refund_rate_1h: parsePercent(getField(row, ["1小时内退款率"])) ?? 0,
    refund_amount_1h: parseNumber(getField(row, ["1小时内退款金额"])) ?? 0,
    gmv_settlement_rate_7d: parsePercent(getField(row, ["7日GMV结算率"])) ?? 0,
  };
}

/** 解析计划 CSV 的一行 */
export function parsePlanRow(row: Record<string, string>) {
  const planId = getField(row, ["计划ID"]);
  if (!planId) return null;

  const spend = parseNumber(getField(row, ["整体消耗", "消耗"])) ?? 0;
  const netGmv = parseNumber(getField(row, ["净成交金额"])) ?? 0;
  const grossGmv = parseNumber(getField(row, ["整体成交金额"])) ?? 0;

  return {
    plan_name: getField(row, ["计划名称"]),
    plan_id: planId,
    metric_date: getField(row, ["日期"]),
    spend,
    gross_orders: Math.round(parseNumber(getField(row, ["整体成交订单数"])) ?? 0),
    gross_gmv: grossGmv,
    gross_roi: spend > 0 ? grossGmv / spend : 0,
    order_cost: parseNumber(getField(row, ["整体成交订单成本"])) ?? 0,
    actual_pay_amount: parseNumber(getField(row, ["用户实际支付金额"])) ?? 0,
    platform_subsidy: parseNumber(getField(row, ["电商平台补贴金额"])) ?? 0,
    net_roi: spend > 0 ? netGmv / spend : 0,
    net_gmv: netGmv,
    net_order_cost: parseNumber(getField(row, ["净成交订单成本"])) ?? 0,
    net_orders: Math.round(parseNumber(getField(row, ["净成交订单数"])) ?? 0),
    net_settlement_rate: parsePercent(getField(row, ["净成交金额结算率"])) ?? 0,
    refund_rate_1h: parsePercent(getField(row, ["1小时内退款率"])) ?? 0,
    refund_amount_1h: parseNumber(getField(row, ["1小时内退款金额"])) ?? 0,
    gmv_settlement_rate_7d: parsePercent(getField(row, ["7日GMV结算率"])) ?? 0,
    settled_amount_7d: parseNumber(getField(row, ["7日结算金额"])) ?? 0,
    settled_amount_14d: parseNumber(getField(row, ["14日结算金额"])) ?? 0,
  };
}
