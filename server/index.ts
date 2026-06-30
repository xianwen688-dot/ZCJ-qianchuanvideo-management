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
  generateDailyReportText,
  generateWeeklyReport,
  generateMonthlyReport,
  saveReport,
  getReportLogs,
} from "./reports";
import {
  pushReport,
  sendFeishuMessage,
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
app.post("/api/sync/run", requireAdmin, async (_req, res) => {
  const jobId = createJob({ type: "sync", targetType: "workspace" });
  startJob(jobId);
  try {
    // runFullSync 自带互斥锁和校验, 不需要额外 syncRunning
    const result = await runFullSync();
    finishJob(jobId, result);
    res.json(result);
  } catch (err) {
    failJob(jobId, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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
  res.json({ ...saved, pushed: pushResult.ok });
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

// ====== Shared: send daily report (default: yesterday) ======
async function sendDailyReport(dateStr?: string) {
  // 默认汇报昨天数据（每日9:30触发的日报）
  const targetDate = dateStr || (() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().slice(0, 10);
  })();
  console.log(`[cron] 开始生成日报 (${targetDate})...`);
  try {
    const report = generateDailyReportText(targetDate);
    const saved = saveReport("daily", report.content, report.date, report.date);
    const ok = await sendFeishuMessage(report.content);
    console.log(`[cron] 日报: ${ok.ok ? "已推送" : "失败"}`);
    return ok;
  } catch (err) {
    console.error("[cron] 日报生成失败:", err);
    return { ok: false };
  }
}

// ====== Cron: Daily Report 9:30 ======
cron.schedule("30 9 * * *", () => sendDailyReport());

// ====== Cron: Weekly Report every Monday 9:30 ======
cron.schedule("30 9 * * 1", async () => {
  console.log("[cron] 开始生成周报...");
  try {
    const report = generateWeeklyReport();
    const saved = saveReport("weekly", report.content, report.date, report.date);
    const result = await pushReport(`千川视频投放周报 - ${report.date}`, report.content, "weekly");
    console.log(`[cron] 周报: ${result.ok ? "已推送" : "失败"}`);
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
    console.log(`[cron] 月报: ${result.ok ? "已推送" : "失败"}`);
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
import { reimportAll } from "./importer";
import { db as dbForCheck } from "./db";

app.listen(PORT, "0.0.0.0", async () => {
  const hostname = os.hostname();
  console.log(`抖音视频投放管理系统`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  LAN:    http://${hostname}:${PORT}`);
  console.log("  定时任务: 日报(每日9:30) 周报(周一9:30) 月报(每月1日9:30)");

  // 启动时自动重导最新数据 (防翻倍: 清空→导入→验证, 带互斥锁)
  try { await reimportAll(); } catch (err) { console.error("[startup] 数据导入失败:", err); }

  // 启动时补发昨日未推送的日报 (服务器重启/错过9:30定时触发时)
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    // 检查今天是否已经为昨天生成过日报
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const lastReport = dbForCheck.prepare(
      "SELECT * FROM report_log WHERE report_type='daily' AND date_from=? AND date(created_at)=? ORDER BY created_at DESC LIMIT 1"
    ).get(yesterdayStr, todayStr) as any;
    if (!lastReport) {
      // 9:30以后启动才补发 (在此之前正常cron会触发)
      if (now.getHours() >= 9 && now.getMinutes() >= 30 || now.getHours() >= 10) {
        console.log(`[startup] 检测到昨日(${yesterdayStr})日报未推送，自动补发...`);
        await sendDailyReport(yesterdayStr);
      }
    }
  } catch (err) { console.error("[startup] 补发日报检查失败:", err); }

  // 启动时检查上次导入是否异常 (对比最近两个 post snapshot)
  try {
    const lastTwo = dbForCheck.prepare(
      "SELECT * FROM import_snapshots WHERE snapshot_type='post' ORDER BY id DESC LIMIT 2"
    ).all() as Array<{ spend: number; net_gmv: number; created_at: string }>;
    if (lastTwo.length === 2) {
      const [latest, prev] = lastTwo;
      const ratio = prev.spend > 10 ? latest.spend / prev.spend : 1;
      if (ratio > 1.7 && ratio < 2.3) {
        console.error(`[startup] ⚠️ 上次导入后数据疑似翻倍! spend ${prev.spend.toFixed(0)}→${latest.spend.toFixed(0)} (${ratio.toFixed(2)}x)`);
      } else if (ratio > 3 && prev.spend > 10) {
        console.error(`[startup] ⚠️ 数据异常增长 ${ratio.toFixed(1)}x`);
      } else {
        console.log(`[startup] ✅ 最近导入正常 spend=${latest.spend.toFixed(2)}`);
      }
    }
  } catch (err) { /* snapshot 表可能还不存在, 忽略 */ }

  // 启动定时扫描
  startWatching(
    (event) => { console.log(`[watcher] ${event.type}: ${event.filePath}`); },
    (msg) => { console.error(`[watcher] ${msg}`); }
  );
});
