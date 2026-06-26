import fs from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import cron from "node-cron";
import { DATA_PATHS } from "./config";
import { detectFileType } from "./parser";
import { importReportFile } from "./importer";

const WATCH_EXTENSIONS = new Set([".csv"]);
let watcher: FSWatcher | null = null;
let scanTask: cron.ScheduledTask | null = null;

export type WatchEvent = {
  type: "added" | "changed";
  filePath: string;
  fileType: string;
  timestamp: string;
};

type WatchCallback = (event: WatchEvent) => void;

function findCsvFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && /\.csv$/i.test(entry.name)) files.push(full);
    }
  }
  return files;
}

async function scanAll(onImport: WatchCallback, onError: (msg: string) => void) {
  // Only scan the first accessible directory, and only the latest file per type
  const dir = DATA_PATHS.find((d) => fs.existsSync(d));
  if (!dir) return;
  const byType: Map<string, string> = new Map();
  for (const fp of findCsvFiles(dir)) {
    const ft = detectFileType(fp);
    if (!ft) continue;
    const mt = fs.statSync(fp).mtimeMs;
    const existing = byType.get(ft);
    if (!existing || mt > fs.statSync(existing).mtimeMs) {
      byType.set(ft, fp);
    }
  }
  for (const fp of byType.values()) {
    const ft = detectFileType(fp)!;
    try {
      const result = await importReportFile(fp);
      if (!result.skipped) {
        onImport({ type: "added", filePath: fp, fileType: ft, timestamp: new Date().toISOString() });
        console.log(`[scan] 导入: ${result.fileName} (${result.inserted}行)`);
      }
    } catch (err) {
      onError(`扫描导入失败 ${path.basename(fp)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function startWatching(onImport: WatchCallback, onError: (msg: string) => void) {
  if (watcher) return;

  // 每半小时整点扫描 (0分和30分) — 兜底机制
  scanTask = cron.schedule("0,30 * * * *", () => {
    console.log("[watcher] 定时扫描 (整点/半点)...");
    scanAll(onImport, onError).catch((err) =>
      onError(`定时扫描异常: ${err instanceof Error ? err.message : String(err)}`)
    );
  });

  const watchDirs = DATA_PATHS.filter((dir) => {
    try { return fs.existsSync(dir); } catch { return false; }
  });

  if (!watchDirs.length) {
    console.log("[watcher] 无可监控目录, 仅使用定时扫描");
    return;
  }

  // 逐目录尝试监控 (Windows网络盘可能失败, 用polling兜底)
  for (const dir of watchDirs) {
    const pattern = path.join(dir, "**", "*.csv");
    try {
      const w = watch(pattern, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        usePolling: true,       // Windows网络盘需要polling模式
        interval: 5000,         // 5秒轮询间隔
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
      });

      w.on("add", async (filePath: string) => {
        if (!WATCH_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;
        const ft = detectFileType(filePath);
        if (!ft) return;
        try {
          const result = await importReportFile(filePath);
          if (!result.skipped) {
            onImport({ type: "added", filePath, fileType: ft, timestamp: new Date().toISOString() });
            console.log(`[watch] 导入: ${result.fileName} (${result.inserted}行)`);
          }
        } catch (err) {
          onError(`导入失败 ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      w.on("change", async (filePath: string) => {
        if (!WATCH_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;
        const ft = detectFileType(filePath);
        if (!ft) return;
        try {
          const result = await importReportFile(filePath);
          if (!result.skipped) {
            onImport({ type: "changed", filePath, fileType: ft, timestamp: new Date().toISOString() });
            console.log(`[watch] 更新: ${result.fileName} (${result.inserted}行)`);
          }
        } catch (err) {
          onError(`更新失败 ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      w.on("error", (err: unknown) => {
        onError(`[watch] ${dir}: ${err instanceof Error ? err.message : String(err)} (已降级为定时扫描)`);
      });

      console.log(`[watcher] 监控: ${dir}`);
    } catch (err) {
      onError(`[watcher] 无法监控 ${dir}: ${err instanceof Error ? err.message : String(err)} (降级为定时扫描)`);
    }
  }

  console.log("[watcher] 就绪, " + watchDirs.length + "目录 + 定时扫描(每半小时整点)");
}

export function stopWatching() {
  if (watcher) { watcher.close(); watcher = null; }
  if (scanTask) { scanTask.stop(); scanTask = null; }
}
