import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import express from "express";
import { PORT } from "./config";
import { db, getSettings, setSetting } from "./db";
import { createJob, failJob, finishJob, getJob, listJobs, startJob } from "./jobs";
import { login, optionalAuth, requireAdmin } from "./auth";
import { getDashboardData, runFullSync } from "./sync";
import { startWatching } from "./watcher";

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
app.get("/api/dashboard", optionalAuth, (_req, res) => {
  res.json(getDashboardData());
});

// ====== Materials API ======
import { db as database } from "./db";

app.get("/api/materials", optionalAuth, (req, res) => {
  const search = req.query.search ? String(req.query.search) : "";
  const sortBy = ["spend", "gross_roi", "gross_orders", "plays"].includes(String(req.query.sortBy ?? ""))
    ? String(req.query.sortBy)
    : "spend";
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  let where = "WHERE 1=1";
  const params: (string | number)[] = [];
  if (search) { where += " AND material_name LIKE ?"; params.push(`%${search}%`); }

  const total = (database.prepare(`SELECT COUNT(*) AS c FROM material_metrics ${where}`).get(...params) as { c: number }).c;
  const items = database.prepare(
    `SELECT * FROM material_metrics ${where} ORDER BY ${sortBy} DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ items, total, limit, offset });
});

app.get("/api/materials/:id", optionalAuth, (req, res) => {
  const material = database.prepare("SELECT * FROM material_metrics WHERE id = ?").get(Number(req.params.id));
  if (!material) { res.status(404).json({ error: "素材不存在" }); return; }
  // 获取该素材的每日趋势
  const name = (material as any).material_name;
  const trends = database.prepare(
    "SELECT * FROM material_metrics WHERE material_name = ? AND metric_date != '全部' ORDER BY metric_date ASC"
  ).all(name);
  res.json({ material, trends });
});

app.delete("/api/materials/:id", requireAdmin, (req, res) => {
  database.prepare("DELETE FROM material_metrics WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
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

// ====== Start ======
app.listen(PORT, "0.0.0.0", () => {
  const hostname = os.hostname();
  console.log(`抖音视频投放管理系统`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  LAN:    http://${hostname}:${PORT}`);

  // 启动文件监控
  startWatching(
    (event) => { console.log(`[watch] ${event.type}: ${event.filePath}`); },
    (msg) => { console.error(`[watch] ${msg}`); }
  );
});
