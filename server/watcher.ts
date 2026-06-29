import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";
import { findLatestFiles, importReportFile } from "./importer";

let scanTask: cron.ScheduledTask | null = null;

export type WatchEvent = { type: "added" | "changed"; filePath: string; fileType: string; timestamp: string };
type WatchCallback = (event: WatchEvent) => void;

/** 定时全量重导最新3个文件 (每半小时) */
export function startWatching(onImport: WatchCallback, onError: (msg: string) => void) {
  scanTask = cron.schedule("0,30 * * * *", async () => {
    console.log("[watcher] 定时扫描 (整点/半点)...");
    for (const fp of findLatestFiles()) {
      try {
        const result = await importReportFile(fp);
        if (result.inserted > 0) {
          onImport({ type: "changed", filePath: fp, fileType: result.fileType, timestamp: new Date().toISOString() });
          console.log(`[watcher] 更新: ${result.fileName} (${result.inserted}行)`);
        }
      } catch (err) {
        onError(`导入失败 ${path.basename(fp)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
  console.log("[watcher] 就绪, 每半小时整点全量重导最新数据");
}

export function stopWatching() {
  if (scanTask) { scanTask.stop(); scanTask = null; }
}
