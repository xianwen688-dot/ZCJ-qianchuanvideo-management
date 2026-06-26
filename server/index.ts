import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import express from "express";
import cron from "node-cron";
import { PORT } from "./config";
import { db, getSettings, setSetting } from "./db";
import { createJob, failJob, finishJob, getJob, listJobs, startJob } from "./jobs";
import { login, optionalAuth, requireAdmin } from "./auth";
import { getDashboardData, runFullSync } from "./sync";
import { startWatching } from "./watcher";
import {
  generateDailyReport,
  generateWeeklyReport,
  generateMonthlyReport,
  saveReport,
  getReportLogs,
} from "./reports";
import {
  pushReport,
  getFeishuConfig,
  setFeishuChatId,
} from "./feishu-client";
import { runAllChecks, notifyHighAlerts, getAlerts, resolveAlert } from "./alerts";
import { listMatchingVideos } from "./video-finder";

const app = express();
app.use(express.json({ limit: "30mb" }));

// ====== Health ======
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ====== Auth ======
app.post("/api/auth/login", (req, res) => {
  const result = login(String(req.body.username ?? ""), String(req.body.password ?? ""));
  if (!result) { res.status(401).json({ error: "账号或密码错误" }); return; }
  res.json(result);
});

app.get("/api/auth/me", optionalAuth, (req, res) => {
  res.json({ user: req.user ?? { id: 0, username: "访客", role: "viewer" } });
});

// ====== Settings ======
app.get("/api/settings", (_req, res) => {
  const settings = getSettings();
  res.json({ ...settings, aiApiKey: settings.aiApiKey ? "********" : "" });
});

app.post("/api/settings", requireAdmin, (req, res) => {
  const allowed = ["reportInboxPath", "scriptRootPath", "dailySyncTime", "roiAlertThreshold", "feishuChatId"];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      setSetting(key, String(req.body[key] ?? ""));
    }
  }
  const settings = getSettings();
  res.json({ ...settings, aiApiKey: settings.aiApiKey ? "********" : "" });
});

// ====== Sync ======
let syncRunning = false;

app.post("/api/sync/run", requireAdmin, async (_req, res) => {
  if (syncRunning) { res.status(409).json({ error: "同步正在运行" }); return; }
  syncRunning = true;
  const jobId = createJob({ type: "sync", targetType: "workspace" });
  startJob(jobId);
  try {
    const result = await runFullSync();
    finishJob(jobId, result);
    res.json(result);
  } catch (err) {
    failJob(jobId, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    syncRunning = false;
  }
});

app.get("/api/sync/diagnostics", requireAdmin, (_req, res) => {
  const settings = getSettings();
  res.json({
    hostname: os.hostname(),
    serviceUser: os.userInfo().username,
    reportPath: settings.reportInboxPath,
    reportAccessible: fs.existsSync(settings.reportInboxPath),
    dailySyncTime: settings.dailySyncTime,
  });
});

// ====== Dashboard API ======
app.get("/api/dashboard", optionalAuth, (req, res) => {
  const from = req.query.from ? String(req.query.from) : undefined;
  const to = req.query.to ? String(req.query.to) : undefined;
  const dateFilter = from && to ? { from, to } : undefined;
  res.json(getDashboardData(dateFilter));
});

// ====== Video Stream ======
app.get("/api/video/stream", optionalAuth, (req, res) => {
  const filePath = req.query.path ? String(req.query.path) : "";
  if (!filePath || !fs.existsSync(filePath)) { res.status(404).send("not found"); return; }
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".avi": "video/x-msvideo" };
  res.setHeader("Content-Type", mime[ext] || "video/mp4");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Accept-Ranges", "bytes");
  // Handle range requests for video seeking
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", chunkSize);
    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    fs.createReadStream(filePath).pipe(res);
  }
});

// ====== Materials API ======
app.get("/api/materials", optionalAuth, (req, res) => {
  const search = req.query.search ? String(req.query.search) : "";
  const sortBy = ["spend", "gross_roi", "gross_orders", "plays", "net_gmv", "completion_rate", "click_rate"].includes(String(req.query.sortBy ?? ""))
    ? String(req.query.sortBy)
    : "spend";
  const sortDir = req.query.sortDir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  let where = "WHERE 1=1";
  const params: (string | number)[] = [];
  if (search) { where += " AND material_name LIKE ?"; params.push(`%${search}%`); }

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM material_metrics ${where}`).get(...params) as { c: number }).c;
  const items = db.prepare(
    `SELECT * FROM material_metrics ${where} ORDER BY ${sortBy} ${sortDir} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ items, total, limit, offset });
});

// ====== Video Finder API ======
app.get("/api/video/find", optionalAuth, (req, res) => {
  const name = req.query.name ? String(req.query.name) : "";
  if (!name) { res.json({ found: false }); return; }
  const paths = listMatchingVideos(name);
  res.json({ found: paths.length > 0, paths: paths.slice(0, 5) });
});

app.get("/api/materials/:id", optionalAuth, (req, res) => {
  const material = db.prepare("SELECT * FROM material_metrics WHERE id = ?").get(Number(req.params.id));
  if (!material) { res.status(404).json({ error: "素材不存在" }); return; }
  const mn = (material as Record<string, unknown>).material_name as string;
  const trends = db.prepare(
    "SELECT * FROM material_metrics WHERE material_name = ? AND metric_date != '全部' ORDER BY metric_date ASC"
  ).all(mn);
  res.json({ material, trends });
});

app.delete("/api/materials/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM material_metrics WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

// ====== Reports API ======
app.get("/api/reports", optionalAuth, (req, res) => {
  const type = req.query.type ? String(req.query.type) : undefined;
  res.json({ items: getReportLogs(type, 50) });
});

app.post("/api/reports/generate", requireAdmin, (req, res) => {
  const reportType = String(req.body.reportType ?? "daily");
  let result: { content: string; type: string; date: string };

  if (reportType === "daily") {
    const dateStr = req.body.date || undefined;
    result = generateDailyReport(dateStr);
  } else if (reportType === "weekly") {
    result = generateWeeklyReport();
  } else if (reportType === "monthly") {
    result = generateMonthlyReport();
  } else if (reportType === "manual") {
    result = { ...generateDailyReport(), type: "manual" };
  } else {
    res.status(400).json({ error: "无效的报告类型" }); return;
  }

  const saved = saveReport(result.type as any, result.content, result.date, result.date);
  res.json({ ...saved, type: result.type, date: result.date });
});

app.post("/api/reports/:type/push", requireAdmin, async (req, res) => {
  const type = String(req.params.type);
  let report;

  if (type === "daily") report = generateDailyReport();
  else if (type === "weekly") report = generateWeeklyReport();
  else if (type === "monthly") report = generateMonthlyReport();
  else { res.status(400).json({ error: "无效的报告类型" }); return; }

  const saved = saveReport(report.type, report.content, report.date, report.date);

  const title = type === "daily"
    ? `千川视频投放日报 - ${report.date}`
    : type === "weekly"
    ? `千川视频投放周报 - ${report.date}`
    : `千川视频投放月报 - ${report.date}`;

  const pushResult = await pushReport(title, report.content, report.type);

  // Update report log with feishu URL
  if (pushResult.url) {
    db.prepare("UPDATE report_log SET feishu_url = ? WHERE id = ?").run(pushResult.url, saved.id);
  }

  res.json({ ...saved, pushed: pushResult.ok, feishuUrl: pushResult.url ?? null });
});

// ====== Feishu Config API ======
app.get("/api/feishu/config", requireAdmin, (_req, res) => {
  res.json(getFeishuConfig());
});

app.post("/api/feishu/config", requireAdmin, (req, res) => {
  if (!req.body.chatId) { res.status(400).json({ error: "缺少 chatId" }); return; }
  res.json(setFeishuChatId(String(req.body.chatId)));
});

// ====== Alerts API ======
app.get("/api/alerts", optionalAuth, (req, res) => {
  const level = req.query.level ? String(req.query.level) : undefined;
  res.json({ items: getAlerts(level, 100) });
});

app.post("/api/alerts/check", requireAdmin, async (_req, res) => {
  try {
    const result = runAllChecks();
    await notifyHighAlerts();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/alerts/:id/resolve", requireAdmin, (req, res) => {
  res.json(resolveAlert(Number(req.params.id)));
});

// ====== Jobs API ======
app.get("/api/jobs", requireAdmin, (req, res) => {
  res.json({ items: listJobs(req.query.limit ? Number(req.query.limit) : 50) });
});

app.get("/api/jobs/:id", requireAdmin, (req, res) => {
  const job = getJob(Number(req.params.id));
  if (!job) { res.status(404).json({ error: "任务不存在" }); return; }
  res.json(job);
});

// ====== Static (production) ======
const distPath = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) { next(); return; }
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// ====== Cron: Daily Report 9:30 ======
cron.schedule("30 9 * * *", async () => {
  console.log("[cron] 开始生成日报...");
  try {
    const report = generateDailyReport();
    const saved = saveReport("daily", report.content, report.date, report.date);
    const result = await pushReport(`千川视频投放日报 - ${report.date}`, report.content, "daily");
    if (result.ok) {
      db.prepare("UPDATE report_log SET feishu_url = ? WHERE id = ?").run(result.url ?? null, saved.id);
    }
    console.log(`[cron] 日报完成: ${saved.path}${result.url ? ` → ${result.url}` : ""}`);
  } catch (err) {
    console.error("[cron] 日报生成失败:", err);
  }
});

// ====== Cron: Weekly Report every Monday 9:30 ======
cron.schedule("30 9 * * 1", async () => {
  console.log("[cron] 开始生成周报...");
  try {
    const report = generateWeeklyReport();
    const saved = saveReport("weekly", report.content, report.date, report.date);
    const result = await pushReport(`千川视频投放周报 - ${report.date}`, report.content, "weekly");
    if (result.ok) {
      db.prepare("UPDATE report_log SET feishu_url = ? WHERE id = ?").run(result.url ?? null, saved.id);
    }
    console.log(`[cron] 周报完成: ${saved.path}`);
  } catch (err) {
    console.error("[cron] 周报生成失败:", err);
  }
});

// ====== Cron: Monthly Report 1st of month 9:30 ======
cron.schedule("30 9 1 * *", async () => {
  console.log("[cron] 开始生成月报...");
  try {
    const report = generateMonthlyReport();
    const saved = saveReport("monthly", report.content, report.date, report.date);
    const result = await pushReport(`千川视频投放月报 - ${report.date}`, report.content, "monthly");
    if (result.ok) {
      db.prepare("UPDATE report_log SET feishu_url = ? WHERE id = ?").run(result.url ?? null, saved.id);
    }
    console.log(`[cron] 月报完成: ${saved.path}`);
  } catch (err) {
    console.error("[cron] 月报生成失败:", err);
  }
});

// ====== Cron: Hourly alert check ======
cron.schedule("0 * * * *", async () => {
  console.log("[cron] 预警检查...");
  // Phase 5 - placeholder for now
});

// ====== Start ======
app.listen(PORT, "0.0.0.0", () => {
  const hostname = os.hostname();
  console.log(`抖音视频投放管理系统`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  LAN:    http://${hostname}:${PORT}`);
  console.log(`  定时任务: 日报(每日9:30) 周报(周一9:30) 月报(每月1日9:30)`);
  console.log("  数据刷新: 文件变更实时监控 + 每半小时整点全量扫描(9:00/9:30/10:00...)");

  // 启动文件监控
  startWatching(
    (event) => { console.log(`[watch] ${event.type}: ${event.filePath}`); },
    (msg) => { console.error(`[watch] ${msg}`); }
  );
});
