import { getDb, nowIso } from '../db';
import type { AiEncyclopediaDraft, EncyclopediaCategory, EncyclopediaEntry } from '../types';
import { recordChange } from './changelog';

/**
 * 百科全书。
 *
 * 条目全部存放在本地数据库中，界面里可以查看与编辑。
 * 目录按分类分组，并把条目正文里的二级标题作为子项展开。
 */

interface EncyclopediaRow {
  id: number;
  novel_id: string;
  title: string;
  category: string;
  tags: string;
  summary: string;
  content: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapEntry(row: EncyclopediaRow): EncyclopediaEntry {
  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    category: row.category as EncyclopediaCategory,
    tags: row.tags
      .split(/[,，、]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    summary: row.summary,
    content: row.content,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listEntries(novelId: string, category?: EncyclopediaCategory): EncyclopediaEntry[] {
  const db = getDb();
  const rows = (
    category
      ? db
          .prepare(
            `SELECT * FROM encyclopedia WHERE novel_id = ? AND category = ? ORDER BY sort_order, title`,
          )
          .all(novelId, category)
      : db
          .prepare(`SELECT * FROM encyclopedia WHERE novel_id = ? ORDER BY category, sort_order, title`)
          .all(novelId)
  ) as EncyclopediaRow[];
  return rows.map(mapEntry);
}

export function getEntry(novelId: string, title: string): EncyclopediaEntry | null {
  const row = getDb()
    .prepare(`SELECT * FROM encyclopedia WHERE novel_id = ? AND title = ?`)
    .get(novelId, title) as EncyclopediaRow | undefined;
  return row ? mapEntry(row) : null;
}

export interface EncyclopediaInput {
  title: string;
  category?: EncyclopediaCategory;
  tags?: string[];
  summary?: string;
  content?: string;
  sortOrder?: number;
}

export function upsertEntry(
  novelId: string,
  input: EncyclopediaInput,
  source: 'ai' | 'user' | 'system' = 'user',
): { entry: EncyclopediaEntry; created: boolean } {
  const title = input.title.trim();
  if (!title) throw new Error('条目名不能为空');
  const existing = getEntry(novelId, title);
  const stamp = nowIso();
  if (!existing) {
    getDb()
      .prepare(
        `INSERT INTO encyclopedia (novel_id, title, category, tags, summary, content, sort_order, created_at, updated_at)
         VALUES (@novelId, @title, @category, @tags, @summary, @content, @sortOrder, @stamp, @stamp)`,
      )
      .run({
        novelId,
        title,
        category: input.category ?? 'other',
        tags: (input.tags ?? []).join(', '),
        summary: input.summary ?? '',
        content: input.content ?? '',
        sortOrder: input.sortOrder ?? 0,
        stamp,
      });
    const created = getEntry(novelId, title) as EncyclopediaEntry;
    recordChange({
      novelId,
      target: 'encyclopedia',
      targetId: title,
      action: 'create',
      after: created,
      source,
      note: `新增百科条目 ${title}`,
    });
    return { entry: created, created: true };
  }
  const merged = {
    category: input.category ?? existing.category,
    tags: Array.from(new Set([...existing.tags, ...(input.tags ?? [])])),
    summary: input.summary ?? existing.summary,
    content: input.content ?? existing.content,
    sortOrder: input.sortOrder ?? existing.sortOrder,
  };
  getDb()
    .prepare(
      `UPDATE encyclopedia SET category = @category, tags = @tags, summary = @summary,
        content = @content, sort_order = @sortOrder, updated_at = @stamp
       WHERE novel_id = @novelId AND title = @title`,
    )
    .run({
      novelId,
      title,
      category: merged.category,
      tags: merged.tags.join(', '),
      summary: merged.summary,
      content: merged.content,
      sortOrder: merged.sortOrder,
      stamp,
    });
  const updated = getEntry(novelId, title) as EncyclopediaEntry;
  recordChange({
    novelId,
    target: 'encyclopedia',
    targetId: title,
    action: 'update',
    before: existing,
    after: updated,
    source,
    note: `更新百科条目 ${title}`,
  });
  return { entry: updated, created: false };
}

export function removeEntry(
  novelId: string,
  title: string,
  source: 'ai' | 'user' | 'system' = 'user',
): void {
  const existing = getEntry(novelId, title);
  if (!existing) return;
  getDb().prepare(`DELETE FROM encyclopedia WHERE novel_id = ? AND title = ?`).run(novelId, title);
  recordChange({
    novelId,
    target: 'encyclopedia',
    targetId: title,
    action: 'delete',
    before: existing,
    source,
    note: `删除百科条目 ${title}`,
  });
}

export function applyEntryDrafts(
  novelId: string,
  drafts: AiEncyclopediaDraft[],
  source: 'ai' | 'user' | 'system' = 'ai',
): string[] {
  const touched: string[] = [];
  for (const draft of drafts.slice(0, 30)) {
    if (!draft?.title?.trim()) continue;
    upsertEntry(novelId, draft, source);
    touched.push(draft.title.trim());
  }
  return touched;
}

export interface TocNode {
  title: string;
  id: number;
  children: { title: string; anchor: string }[];
}

export interface TocGroup {
  category: EncyclopediaCategory;
  label: string;
  nodes: TocNode[];
}

/** 从条目正文里抽取二级标题，作为目录的子项。 */
function headingsOf(content: string): string[] {
  const result: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (match?.[1]) result.push(match[1]);
  }
  return result;
}

export function buildToc(novelId: string): TocGroup[] {
  const entries = listEntries(novelId);
  const groups = new Map<EncyclopediaCategory, TocNode[]>();
  for (const entry of entries) {
    const node: TocNode = {
      title: entry.title,
      id: entry.id,
      children: headingsOf(entry.content).map((title) => ({
        title,
        anchor: `${entry.id}-${title}`,
      })),
    };
    const list = groups.get(entry.category) ?? [];
    list.push(node);
    groups.set(entry.category, list);
  }
  return Array.from(groups.entries()).map(([category, nodes]) => ({
    category,
    label: category,
    nodes,
  }));
}

export function countEntries(novelId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM encyclopedia WHERE novel_id = ?`)
    .get(novelId) as { n: number };
  return row.n;
}
