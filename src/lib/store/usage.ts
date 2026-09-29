import { getDb } from '../db';
import type { UsageRecord, UsageSummary } from '../types';

/** Token 用量统计。生成过程中的每次调用都会留下一条记录。 */

interface UsageRow {
  id: number;
  novel_id: string | null;
  provider_id: string;
  model: string;
  scene: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated: number;
  created_at: string;
}

function mapRow(row: UsageRow): UsageRecord {
  return {
    id: row.id,
    novelId: row.novel_id,
    providerId: row.provider_id,
    model: row.model,
    scene: row.scene as UsageRecord['scene'],
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    estimated: row.estimated === 1,
    createdAt: row.created_at,
  };
}

export function usageSummary(novelId?: string): UsageSummary {
  const db = getDb();
  const where = novelId ? 'WHERE novel_id = ?' : '';
  const params = novelId ? [novelId] : [];
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(prompt_tokens), 0) AS prompt,
              COALESCE(SUM(completion_tokens), 0) AS completion,
              COALESCE(SUM(total_tokens), 0) AS total,
              COUNT(*) AS calls
       FROM usage_log ${where}`,
    )
    .get(...params) as { prompt: number; completion: number; total: number; calls: number };

  const byModel = db
    .prepare(
      `SELECT model, SUM(total_tokens) AS tokens, COUNT(*) AS calls
       FROM usage_log ${where} GROUP BY model ORDER BY tokens DESC`,
    )
    .all(...params) as { model: string; tokens: number; calls: number }[];

  const byScene = db
    .prepare(
      `SELECT scene, SUM(total_tokens) AS tokens, COUNT(*) AS calls
       FROM usage_log ${where} GROUP BY scene ORDER BY tokens DESC`,
    )
    .all(...params) as { scene: string; tokens: number; calls: number }[];

  const recent = (
    db
      .prepare(`SELECT * FROM usage_log ${where} ORDER BY id DESC LIMIT 50`)
      .all(...params) as UsageRow[]
  ).map(mapRow);

  return {
    totalPrompt: totals.prompt,
    totalCompletion: totals.completion,
    totalTokens: totals.total,
    calls: totals.calls,
    byModel,
    byScene,
    recent,
  };
}

export function clearUsage(novelId?: string): void {
  const db = getDb();
  if (novelId) db.prepare(`DELETE FROM usage_log WHERE novel_id = ?`).run(novelId);
  else db.prepare(`DELETE FROM usage_log`).run();
}
