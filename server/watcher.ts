import fs from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { DATA_PATHS } from "./config";
import { detectFileType } from "./parser";
import { importReportFile } from "./importer";

const WATCH_EXTENSIONS = new Set([".csv"]);
let watcher: FSWatcher | null = null;

export type WatchEvent = {
  type: "added" | "changed";
  filePath: string;
  fileType: string;
  timestamp: string;
};

type WatchCallback = (event: WatchEvent) => void;

export function startWatching(onImport: WatchCallback, onError: (msg: string) => void) {
  if (watcher) return;

  const watchDirs = DATA_PATHS.filter((dir) => {
    try {
      return fs.existsSync(dir);
    } catch {
      onError(`目录不可访问: ${dir}`);
      return false;
    }
  });

  if (!watchDirs.length) {
    onError("没有可监控的数据目录");
    return;
  }

  const patterns = watchDirs.map((dir) => path.join(dir, "**", "*.csv"));

  watcher = watch(patterns, {
    ignored: /(^|[\/\\])\../, // 忽略隐藏文件
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
  });

  watcher.on("add", async (filePath: string) => {
    if (!WATCH_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;
    const fileType = detectFileType(filePath);
    if (!fileType) return;
    try {
      const result = await importReportFile(filePath);
      if (!result.skipped) {
        onImport({ type: "added", filePath, fileType, timestamp: new Date().toISOString() });
        console.log(`[watcher] 导入: ${result.fileName} (${result.inserted}行)`);
      }
    } catch (err) {
      onError(`导入失败 ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  watcher.on("change", async (filePath: string) => {
    if (!WATCH_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;
    const fileType = detectFileType(filePath);
    if (!fileType) return;
    try {
      const result = await importReportFile(filePath);
      if (!result.skipped) {
        onImport({ type: "changed", filePath, fileType, timestamp: new Date().toISOString() });
        console.log(`[watcher] 更新: ${result.fileName} (${result.inserted}行)`);
      }
    } catch (err) {
      onError(`更新失败 ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  watcher.on("error", (err: unknown) => {
    onError(`监控错误: ${err instanceof Error ? err.message : String(err)}`);
  });

  console.log(`[watcher] 监控已启动, ${watchDirs.length}个目录`);
}

export function stopWatching() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
