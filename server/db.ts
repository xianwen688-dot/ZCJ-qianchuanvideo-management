import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { DEFAULT_REPORT_INBOX_PATH, DEFAULT_SCRIPT_ROOT_PATH } from "./config";

const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "app.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  -- ====== 辅助表 ======

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'viewer')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS report_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_type TEXT NOT NULL CHECK(file_type IN ('video', 'product', 'plan')),
    path TEXT UNIQUE NOT NULL,
    file_name TEXT NOT NULL,
    extension TEXT NOT NULL,
    hash TEXT,
    size INTEGER NOT NULL,
    last_modified TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS report_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL CHECK(report_type IN ('daily', 'weekly', 'monthly', 'manual')),
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    feishu_url TEXT,
    content_path TEXT,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed')),
    target_type TEXT,
    target_id TEXT,
    progress_current INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );

  -- ====== 核心表 1: 素材视频指标 (来源: 视频 CSV 27列) ======
  CREATE TABLE IF NOT EXISTS material_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id TEXT,
    material_name TEXT NOT NULL,
    material_created_at TEXT,
    metric_date TEXT NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    click_rate REAL NOT NULL DEFAULT 0,
    conversion_rate REAL NOT NULL DEFAULT 0,
    spend REAL NOT NULL DEFAULT 0,
    gross_orders INTEGER NOT NULL DEFAULT 0,
    gross_gmv REAL NOT NULL DEFAULT 0,
    gross_roi REAL NOT NULL DEFAULT 0,
    order_cost REAL NOT NULL DEFAULT 0,
    cpm REAL NOT NULL DEFAULT 0,
    cpc REAL NOT NULL DEFAULT 0,
    net_roi REAL NOT NULL DEFAULT 0,
    net_gmv REAL NOT NULL DEFAULT 0,
    net_orders INTEGER NOT NULL DEFAULT 0,
    net_order_cost REAL NOT NULL DEFAULT 0,
    net_settlement_rate REAL NOT NULL DEFAULT 0,
    refund_rate_1h REAL NOT NULL DEFAULT 0,
    refund_amount_1h REAL NOT NULL DEFAULT 0,
    plays INTEGER NOT NULL DEFAULT 0,
    completion_rate REAL NOT NULL DEFAULT 0,
    avg_watch_seconds REAL NOT NULL DEFAULT 0,
    rate_3s REAL NOT NULL DEFAULT 0,
    rate_5s REAL NOT NULL DEFAULT 0,
    report_file_id INTEGER NOT NULL REFERENCES report_files(id) ON DELETE CASCADE,
    raw_json TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL
  );

  -- ====== 核心表 2: 商品指标 (来源: 商品 CSV 22列) ======
  CREATE TABLE IF NOT EXISTS product_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    metric_date TEXT NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    click_rate REAL NOT NULL DEFAULT 0,
    conversion_rate REAL NOT NULL DEFAULT 0,
    spend REAL NOT NULL DEFAULT 0,
    gross_gmv REAL NOT NULL DEFAULT 0,
    gross_roi REAL NOT NULL DEFAULT 0,
    order_cost REAL NOT NULL DEFAULT 0,
    gross_orders INTEGER NOT NULL DEFAULT 0,
    actual_pay_amount REAL NOT NULL DEFAULT 0,
    platform_subsidy REAL NOT NULL DEFAULT 0,
    net_roi REAL NOT NULL DEFAULT 0,
    net_gmv REAL NOT NULL DEFAULT 0,
    net_orders INTEGER NOT NULL DEFAULT 0,
    net_order_cost REAL NOT NULL DEFAULT 0,
    net_settlement_rate REAL NOT NULL DEFAULT 0,
    refund_rate_1h REAL NOT NULL DEFAULT 0,
    refund_amount_1h REAL NOT NULL DEFAULT 0,
    gmv_settlement_rate_7d REAL NOT NULL DEFAULT 0,
    report_file_id INTEGER NOT NULL REFERENCES report_files(id) ON DELETE CASCADE,
    imported_at TEXT NOT NULL
  );

  -- ====== 核心表 3: 计划指标 (来源: 计划 CSV 20列) ======
  CREATE TABLE IF NOT EXISTS plan_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_name TEXT,
    plan_id TEXT NOT NULL,
    metric_date TEXT NOT NULL,
    spend REAL NOT NULL DEFAULT 0,
    gross_orders INTEGER NOT NULL DEFAULT 0,
    gross_gmv REAL NOT NULL DEFAULT 0,
    gross_roi REAL NOT NULL DEFAULT 0,
    order_cost REAL NOT NULL DEFAULT 0,
    actual_pay_amount REAL NOT NULL DEFAULT 0,
    platform_subsidy REAL NOT NULL DEFAULT 0,
    net_roi REAL NOT NULL DEFAULT 0,
    net_gmv REAL NOT NULL DEFAULT 0,
    net_order_cost REAL NOT NULL DEFAULT 0,
    net_orders INTEGER NOT NULL DEFAULT 0,
    net_settlement_rate REAL NOT NULL DEFAULT 0,
    refund_rate_1h REAL NOT NULL DEFAULT 0,
    refund_amount_1h REAL NOT NULL DEFAULT 0,
    gmv_settlement_rate_7d REAL NOT NULL DEFAULT 0,
    settled_amount_7d REAL NOT NULL DEFAULT 0,
    settled_amount_14d REAL NOT NULL DEFAULT 0,
    report_file_id INTEGER NOT NULL REFERENCES report_files(id) ON DELETE CASCADE,
    imported_at TEXT NOT NULL
  );

  -- ====== 索引 ======
  -- 素材表索引
  CREATE INDEX IF NOT EXISTS idx_material_date ON material_metrics(metric_date);
  CREATE INDEX IF NOT EXISTS idx_material_name ON material_metrics(material_name);
  CREATE INDEX IF NOT EXISTS idx_material_file ON material_metrics(report_file_id);
  CREATE INDEX IF NOT EXISTS idx_material_spend ON material_metrics(spend DESC);

  -- 商品表索引
  CREATE INDEX IF NOT EXISTS idx_product_date ON product_metrics(metric_date);
  CREATE INDEX IF NOT EXISTS idx_product_id ON product_metrics(product_id);
  CREATE INDEX IF NOT EXISTS idx_product_file ON product_metrics(report_file_id);

  -- 计划表索引
  CREATE INDEX IF NOT EXISTS idx_plan_date ON plan_metrics(metric_date);
  CREATE INDEX IF NOT EXISTS idx_plan_id ON plan_metrics(plan_id);
  CREATE INDEX IF NOT EXISTS idx_plan_file ON plan_metrics(report_file_id);

  -- 辅助表索引
  CREATE INDEX IF NOT EXISTS idx_report_files_hash ON report_files(hash);
  CREATE INDEX IF NOT EXISTS idx_report_log_type ON report_log(report_type, created_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, type, created_at);

  -- ====== 防重复 UNIQUE 索引 ======
  -- 先清理可能存在的重复行 (取每组最小的 id)
  DELETE FROM material_metrics WHERE id NOT IN (
    SELECT MIN(id) FROM material_metrics GROUP BY report_file_id, material_name, metric_date
  );
  DELETE FROM product_metrics WHERE id NOT IN (
    SELECT MIN(id) FROM product_metrics GROUP BY report_file_id, product_id, metric_date
  );
  DELETE FROM plan_metrics WHERE id NOT IN (
    SELECT MIN(id) FROM plan_metrics GROUP BY report_file_id, plan_id, metric_date
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_material_unique
    ON material_metrics(report_file_id, material_name, metric_date);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_product_unique
    ON product_metrics(report_file_id, product_id, metric_date);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_unique
    ON plan_metrics(report_file_id, plan_id, metric_date);

  -- ====== 导入快照表 (每次导入前后记录 KPI, 用于翻倍检测) ======
  CREATE TABLE IF NOT EXISTS import_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_type TEXT NOT NULL CHECK(snapshot_type IN ('pre','post')),
    spend REAL NOT NULL DEFAULT 0,
    net_gmv REAL NOT NULL DEFAULT 0,
    net_orders REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

// ====== 默认设置 ======
const defaultSettings: Record<string, string> = {
  reportInboxPath: DEFAULT_REPORT_INBOX_PATH,
  scriptRootPath: DEFAULT_SCRIPT_ROOT_PATH,
  aiBaseUrl: "https://api.minimaxi.com/v1",
  aiApiKey: "",
  aiTextModel: "MiniMax-M3",
  aiVisionModel: "MiniMax-M3",
  openClawProfile: "zcjvideo",
  dailySyncTime: "09:30",
  roiAlertThreshold: "0.5",
  jwtSecret: crypto.randomBytes(32).toString("hex"),
  feishuChatId: "PLACEHOLDER",
};

for (const [key, value] of Object.entries(defaultSettings)) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

// ====== 默认管理员 ======
const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
if (!userCount.count) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)"
  ).run("admin", bcrypt.hashSync("ZCJ@2026", 10), "admin", now);
}
// 始终确保admin存在且密码正确
db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE username = 'admin'").run(bcrypt.hashSync("ZCJ@2026", 10));

// ====== Settings CRUD ======
export function getSetting(key: string) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? "";
}

export function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, string>;
}
