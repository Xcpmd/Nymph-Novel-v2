import { getDb, nowIso } from '../db';
import type { ChangeAction, ChangeLogEntry, ChangeSource } from '../types';

/**
 * 永久修改日志。
 *
 * 小说内的数据每次新增、修改、删除都会留下一条记录，保留修改前后的内容，
 * 记录只追加不覆盖，可以据此把任意一条数据还原回修改之前的样子。
 */

export interface ChangeInput {
  novelId: string;
  target: string;
  targetId: string;
  action: ChangeAction;
  before?: unknown;
  after?: unknown;
  source: ChangeSource;
  note?: string;
}

function serialize(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deserialize(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function recordChange(input: ChangeInput): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO changelog (novel_id, target, target_id, action, before, after, source, note, restored, created_at)
       VALUES (@novelId, @target, @targetId, @action, @before, @after, @source, @note, 0, @createdAt)`,
    )
    .run({
      novelId: input.novelId,
      target: input.target,
      targetId: input.targetId,
      action: input.action,
      before: serialize(input.before),
      after: serialize(input.after),
      source: input.source,
      note: input.note ?? '',
      createdAt: nowIso(),
    });
  return Number(info.lastInsertRowid);
}

interface ChangeRow {
  id: number;
  novel_id: string;
  target: string;
  target_id: string;
  action: string;
  before: string;
  after: string;
  source: string;
  note: string;
  restored: number;
  created_at: string;
}

function mapRow(row: ChangeRow): ChangeLogEntry {
  return {
    id: row.id,
    novelId: row.novel_id,
    target: row.target,
    targetId: row.target_id,
    action: row.action as ChangeAction,
    before: deserialize(row.before),
    after: deserialize(row.after),
    source: row.source as ChangeSource,
    note: row.note,
    restored: row.restored === 1,
    createdAt: row.created_at,
  };
}

export function listChanges(novelId: string, limit = 200, offset = 0): ChangeLogEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM changelog WHERE novel_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(novelId, limit, offset) as ChangeRow[];
  return rows.map(mapRow);
}

export function getChange(id: number): ChangeLogEntry | null {
  const row = getDb().prepare(`SELECT * FROM changelog WHERE id = ?`).get(id) as
    | ChangeRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function markRestored(id: number, note?: string): void {
  getDb()
    .prepare(`UPDATE changelog SET restored = 1, note = CASE WHEN ? = '' THEN note ELSE ? END WHERE id = ?`)
    .run(note ?? '', note ?? '', id);
}

export function countChanges(novelId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM changelog WHERE novel_id = ?`)
    .get(novelId) as { n: number };
  return row.n;
}

export function clearChanges(novelId: string): void {
  getDb().prepare(`DELETE FROM changelog WHERE novel_id = ?`).run(novelId);
}
