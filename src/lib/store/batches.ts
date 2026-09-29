import { novelIdFromTitle } from '../crypto';
import { getDb, nowIso, parseJsonColumn } from '../db';
import type { BatchItemStatus, BatchJob, BatchJobDetail, BatchJobKind, BatchJobStatus } from '../types';

/**
 * 批量推理任务的持久化。
 *
 * 任务与逐条进度都落库，因此刷新页面、重启服务都不会丢；取消与重试只是改状态，
 * 真正干活的调度在 lib/ai/batch.ts 里。
 */

export interface BatchOptions {
  /** 自动：供应商支持原生批量就用原生，否则退回本地队列 */
  mode: 'auto' | 'provider' | 'local';
  direction?: string;
  concurrency?: number;
  thinking?: boolean;
  maxTokens?: number;
}

export const DEFAULT_BATCH_OPTIONS: BatchOptions = { mode: 'auto' };

interface JobRow {
  id: string;
  novel_id: string;
  kind: string;
  protocol: string;
  provider_id: string;
  model: string;
  scene: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  remote_id: string;
  results_url: string;
  options: string;
  error: string;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  job_id: string;
  ref: string;
  custom_id: string;
  status: string;
  attempts: number;
  message: string;
  tokens: number;
  updated_at: string;
}

function mapJob(row: JobRow): BatchJob {
  return {
    id: row.id,
    novelId: row.novel_id,
    kind: row.kind as BatchJobKind,
    protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
    providerId: row.provider_id,
    model: row.model,
    scene: row.scene,
    status: row.status as BatchJobStatus,
    total: row.total,
    completed: row.completed,
    failed: row.failed,
    remoteId: row.remote_id,
    resultsUrl: row.results_url,
    options: parseJsonColumn<BatchOptions>(row.options, { ...DEFAULT_BATCH_OPTIONS }),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: ItemRow) {
  return {
    jobId: row.job_id,
    ref: row.ref,
    customId: row.custom_id,
    status: row.status as BatchItemStatus,
    attempts: row.attempts,
    message: row.message,
    tokens: row.tokens,
    updatedAt: row.updated_at,
  };
}

export function createJob(input: {
  novelId: string;
  kind: BatchJobKind;
  protocol: 'openai' | 'anthropic';
  providerId: string;
  model: string;
  scene: string;
  refs: string[];
  options: BatchOptions;
}): BatchJob {
  const db = getDb();
  const id = novelIdFromTitle('batch');
  const stamp = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO batch_jobs (id, novel_id, kind, protocol, provider_id, model, scene, status,
        total, completed, failed, remote_id, results_url, options, error, created_at, updated_at)
       VALUES (@id, @novelId, @kind, @protocol, @providerId, @model, @scene, 'pending',
        @total, 0, 0, '', '', @options, '', @stamp, @stamp)`,
    ).run({
      id,
      novelId: input.novelId,
      kind: input.kind,
      protocol: input.protocol,
      providerId: input.providerId,
      model: input.model,
      scene: input.scene,
      total: input.refs.length,
      options: JSON.stringify(input.options),
      stamp,
    });
    const insertItem = db.prepare(
      `INSERT INTO batch_items (job_id, ref, custom_id, status, attempts, message, tokens, updated_at)
       VALUES (?, ?, ?, 'pending', 0, '', 0, ?)`,
    );
    for (const ref of input.refs) {
      // custom_id 用章节引用，供应商回传时可以直接对应回章节
      insertItem.run(id, ref, `ch-${ref.replace(':', '-')}`, stamp);
    }
  })();
  return getJob(id) as BatchJob;
}

export function listJobs(novelId: string, limit = 20): BatchJob[] {
  const rows = getDb()
    .prepare(`SELECT * FROM batch_jobs WHERE novel_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(novelId, limit) as JobRow[];
  return rows.map(mapJob);
}

export function getJob(id: string): BatchJob | null {
  const row = getDb().prepare(`SELECT * FROM batch_jobs WHERE id = ?`).get(id) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export function getJobDetail(id: string): BatchJobDetail | null {
  const job = getJob(id);
  if (!job) return null;
  const items = getDb()
    .prepare(`SELECT * FROM batch_items WHERE job_id = ? ORDER BY rowid`)
    .all(id) as ItemRow[];
  return { ...job, items: items.map(mapItem) };
}

/** 可更新字段，用驼峰写法，内部再映射到数据库列名。 */
export type BatchJobPatch = Partial<{
  kind: BatchJobKind;
  protocol: 'openai' | 'anthropic';
  providerId: string;
  model: string;
  scene: string;
  status: BatchJobStatus;
  total: number;
  completed: number;
  failed: number;
  remoteId: string;
  resultsUrl: string;
  options: BatchOptions;
  error: string;
}>;

export function patchJob(id: string, patch: BatchJobPatch): void {
  const columnOf: Record<string, string> = {
    kind: 'kind',
    protocol: 'protocol',
    providerId: 'provider_id',
    model: 'model',
    scene: 'scene',
    status: 'status',
    total: 'total',
    completed: 'completed',
    failed: 'failed',
    remoteId: 'remote_id',
    resultsUrl: 'results_url',
    options: 'options',
    error: 'error',
  };
  const values: Record<string, unknown> = { id, stamp: nowIso() };
  const columns: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = columnOf[key];
    if (!column) continue;
    columns.push(`${column} = @${column}`);
    values[column] = key === 'options' ? JSON.stringify(value) : value;
  }
  if (columns.length === 0) return;
  getDb()
    .prepare(`UPDATE batch_jobs SET ${columns.join(', ')}, updated_at = @stamp WHERE id = @id`)
    .run(values);
}

export function patchItem(
  jobId: string,
  ref: string,
  patch: { status?: BatchItemStatus; message?: string; tokens?: number; attempts?: number },
): void {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const columns = entries.map(([key]) => `${key} = @${key}`).join(', ');
  getDb()
    .prepare(`UPDATE batch_items SET ${columns}, updated_at = @stamp WHERE job_id = @jobId AND ref = @ref`)
    .run({ ...patch, jobId, ref, stamp: nowIso() });
}

/** 重算完成与失败计数，避免各处重复统计。 */
export function refreshCounters(jobId: string): void {
  const row = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM batch_items WHERE job_id = ?`,
    )
    .get(jobId) as { done: number | null; failed: number | null };
  patchJob(jobId, { completed: row.done ?? 0, failed: row.failed ?? 0 });
}

export function listPendingItems(jobId: string) {
  const rows = getDb()
    .prepare(`SELECT * FROM batch_items WHERE job_id = ? AND status IN ('pending', 'running') ORDER BY rowid`)
    .all(jobId) as ItemRow[];
  return rows.map(mapItem);
}

export function listFailedItems(jobId: string) {
  const rows = getDb()
    .prepare(`SELECT * FROM batch_items WHERE job_id = ? AND status = 'failed' ORDER BY rowid`)
    .all(jobId) as ItemRow[];
  return rows.map(mapItem);
}

/** 把失败项重置为待处理，用于「重试失败」。 */
export function resetFailedItems(jobId: string): number {
  const result = getDb()
    .prepare(`UPDATE batch_items SET status = 'pending', message = '', updated_at = ? WHERE job_id = ? AND status = 'failed'`)
    .run(nowIso(), jobId);
  return result.changes;
}

export function deleteJob(jobId: string): void {
  getDb().transaction(() => {
    getDb().prepare(`DELETE FROM batch_items WHERE job_id = ?`).run(jobId);
    getDb().prepare(`DELETE FROM batch_jobs WHERE id = ?`).run(jobId);
  })();
}

/** 服务重启后把停留在 running 的任务标成可继续，避免卡死。 */
export function recoverStaleJobs(): number {
  const result = getDb()
    .prepare(
      `UPDATE batch_jobs SET status = 'pending', updated_at = ?
       WHERE status = 'running' AND kind = 'local'`,
    )
    .run(nowIso());
  return result.changes;
}

export function listActiveJobs(novelId?: string): BatchJob[] {
  const rows = novelId
    ? (getDb()
        .prepare(
          `SELECT * FROM batch_jobs WHERE novel_id = ? AND status IN ('pending', 'running') ORDER BY created_at`,
        )
        .all(novelId) as JobRow[])
    : (getDb()
        .prepare(`SELECT * FROM batch_jobs WHERE status IN ('pending', 'running') ORDER BY created_at`)
        .all() as JobRow[]);
  return rows.map(mapJob);
}
