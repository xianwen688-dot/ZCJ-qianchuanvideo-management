import cron from "node-cron";
import { runFullSync } from "./sync";

let scanTask: cron.ScheduledTask | null = null;

export type WatchEvent = { type: "added" | "changed"; filePath: string; fileType: string; timestamp: string };
type WatchCallback = (event: WatchEvent) => void;

/** 定时全量重导最新3个文件 (每半小时, 自动互斥锁+校验) */
export function startWatching(onImport: WatchCallback, onError: (msg: string) => void) {
  scanTask = cron.schedule("0,30 * * * *", async () => {
    console.log("[watcher] 定时扫描 (整点/半点)...");
    try {
      const result = await runFullSync();
      for (const f of result.files) {
        if (f.inserted > 0) {
          onImport({ type: "changed", filePath: f.fileName, fileType: f.fileType, timestamp: new Date().toISOString() });
        }
      }
      for (const err of result.errors) {
        onError(err);
      }
      // 记录校验结果
      if (result.verification && !result.verification.pass) {
        onError(`数据校验告警: ${result.verification.message}`);
        console.error(`[watcher] ${result.verification.message}`);
      }
      console.log(`[watcher] 完成: ${result.totalRows}行, 校验=${result.verification?.message}`);
    } catch (err) {
      onError(`定时同步异常: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  console.log("[watcher] 就绪, 每半小时整点全量重导最新数据");
}

export function stopWatching() {
  if (scanTask) { scanTask.stop(); scanTask = null; }
}
