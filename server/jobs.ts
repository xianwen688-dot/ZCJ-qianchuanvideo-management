import { db } from "./db";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export function createJob(input: { type: string; targetType?: string; targetId?: string; total?: number }) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO jobs
       (type, status, target_type, target_id, progress_current, progress_total, result_json, error, created_at)
       VALUES (?, 'queued', ?, ?, 0, ?, '', '', ?)`
    )
    .run(input.type, input.targetType ?? "", input.targetId ?? "", input.total ?? 0, now);
  return Number(result.lastInsertRowid);
}

export function startJob(id: number, total?: number) {
  db.prepare(
    `UPDATE jobs
     SET status = 'running',
         started_at = COALESCE(started_at, ?),
         progress_total = CASE WHEN ? >= 0 THEN ? ELSE progress_total END
     WHERE id = ?`
  ).run(new Date().toISOString(), total ?? -1, total ?? -1, id);
}

export function updateJobProgress(id: number, current: number, total?: number) {
  db.prepare(
    `UPDATE jobs
     SET progress_current = ?,
         progress_total = CASE WHEN ? >= 0 THEN ? ELSE progress_total END
     WHERE id = ?`
  ).run(current, total ?? -1, total ?? -1, id);
}

export function finishJob(id: number, result: unknown) {
  db.prepare(
    `UPDATE jobs
     SET status = 'succeeded',
         progress_current = CASE WHEN progress_total > 0 THEN progress_total ELSE progress_current END,
         result_json = ?,
         error = '',
         finished_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(result ?? null), new Date().toISOString(), id);
}

export function failJob(id: number, error: unknown, result?: unknown) {
  db.prepare(
    `UPDATE jobs
     SET status = 'failed',
         result_json = ?,
         error = ?,
         finished_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(result ?? null), error instanceof Error ? error.message : String(error), new Date().toISOString(), id);
}

export function getJob(id: number) {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
}

export function listJobs(limit = 50) {
  return db
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 200));
}
