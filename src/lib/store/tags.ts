import { getDb, nowIso } from '../db';
import { chapterLabel } from '../format';
import type { Bookmark, Tag } from '../types';
import { recordChange } from './changelog';
import { requireChapter } from './chapters';

/**
 * 标签与书签。
 * 作用范围都是单部小说，不跨作品共享。
 */

export function listTags(novelId: string): Tag[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, name, color FROM tags WHERE novel_id = ? ORDER BY name`)
    .all(novelId) as { id: number; name: string; color: string }[];
  const refRows = db
    .prepare(`SELECT tag_id, ref FROM chapter_tags WHERE novel_id = ?`)
    .all(novelId) as { tag_id: number; ref: string }[];
  const map = new Map<number, string[]>();
  for (const row of refRows) {
    const list = map.get(row.tag_id) ?? [];
    list.push(row.ref);
    map.set(row.tag_id, list);
  }
  return rows.map((row) => ({
    id: row.id,
    novelId,
    name: row.name,
    color: row.color,
    refs: map.get(row.id) ?? [],
  }));
}

export function createTag(novelId: string, name: string, color = ''): Tag {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('标签名不能为空');
  const existing = getDb()
    .prepare(`SELECT id FROM tags WHERE novel_id = ? AND name = ?`)
    .get(novelId, trimmed) as { id: number } | undefined;
  if (existing) {
    return listTags(novelId).find((tag) => tag.id === existing.id) as Tag;
  }
  getDb()
    .prepare(`INSERT INTO tags (novel_id, name, color) VALUES (?, ?, ?)`)
    .run(novelId, trimmed, color);
  recordChange({
    novelId,
    target: 'tag',
    targetId: trimmed,
    action: 'create',
    after: { name: trimmed },
    source: 'user',
    note: `新增标签 ${trimmed}`,
  });
  return listTags(novelId).find((tag) => tag.name === trimmed) as Tag;
}

export function ensureTag(novelId: string, name: string, source: 'ai' | 'user' | 'system' = 'user'): Tag {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('标签名不能为空');
  const existing = getDb()
    .prepare(`SELECT id FROM tags WHERE novel_id = ? AND name = ?`)
    .get(novelId, trimmed) as { id: number } | undefined;
  if (existing) return listTags(novelId).find((tag) => tag.id === existing.id) as Tag;
  getDb().prepare(`INSERT INTO tags (novel_id, name, color) VALUES (?, ?, '')`).run(novelId, trimmed);
  recordChange({
    novelId,
    target: 'tag',
    targetId: trimmed,
    action: 'create',
    after: { name: trimmed },
    source,
    note: `新增标签 ${trimmed}`,
  });
  return listTags(novelId).find((tag) => tag.name === trimmed) as Tag;
}

export function removeTag(novelId: string, name: string): void {
  const tag = listTags(novelId).find((item) => item.name === name);
  if (!tag) return;
  getDb().prepare(`DELETE FROM chapter_tags WHERE novel_id = ? AND tag_id = ?`).run(novelId, tag.id);
  getDb().prepare(`DELETE FROM tags WHERE novel_id = ? AND id = ?`).run(novelId, tag.id);
  recordChange({
    novelId,
    target: 'tag',
    targetId: name,
    action: 'delete',
    before: tag,
    source: 'user',
    note: `删除标签 ${name}`,
  });
}

export function addTagToChapter(
  novelId: string,
  ref: string,
  name: string,
  source: 'ai' | 'user' | 'system' = 'user',
): void {
  const tag = ensureTag(novelId, name, source);
  getDb()
    .prepare(`INSERT OR IGNORE INTO chapter_tags (novel_id, ref, tag_id) VALUES (?, ?, ?)`)
    .run(novelId, ref, tag.id);
}

export function removeTagFromChapter(novelId: string, ref: string, name: string): void {
  const tag = listTags(novelId).find((item) => item.name === name);
  if (!tag) return;
  getDb()
    .prepare(`DELETE FROM chapter_tags WHERE novel_id = ? AND tag_id = ? AND ref = ?`)
    .run(novelId, tag.id, ref);
}

export function tagsOfChapter(novelId: string, ref: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT t.name FROM chapter_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE ct.novel_id = ? AND ct.ref = ? ORDER BY t.name`,
    )
    .all(novelId, ref) as { name: string }[];
  return rows.map((row) => row.name);
}

export function listBookmarks(novelId: string): Bookmark[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, ref, note, created_at FROM bookmarks WHERE novel_id = ? ORDER BY id DESC`)
    .all(novelId) as { id: number; ref: string; note: string; created_at: string }[];
  return rows.map((row) => {
    const [volPart, indexPart] = row.ref.split(':');
    let title = `第 ${indexPart ?? '?'} 章`;
    try {
      const chapter = requireChapter(novelId, row.ref);
      title = chapterLabel(chapter.indexNo, chapter.title);
    } catch {
      // 章节已被删除时保留原有引用信息
    }
    void volPart;
    return {
      id: row.id,
      novelId,
      ref: row.ref,
      chapterTitle: title,
      note: row.note,
      createdAt: row.created_at,
    };
  });
}

export function addBookmark(novelId: string, ref: string, note = ''): Bookmark {
  requireChapter(novelId, ref);
  getDb()
    .prepare(`INSERT INTO bookmarks (novel_id, ref, note, created_at) VALUES (?, ?, ?, ?)`)
    .run(novelId, ref, note, nowIso());
  const list = listBookmarks(novelId);
  return list[0] as Bookmark;
}

export function removeBookmark(novelId: string, id: number): void {
  getDb().prepare(`DELETE FROM bookmarks WHERE novel_id = ? AND id = ?`).run(novelId, id);
}

export function isBookmarked(novelId: string, ref: string): boolean {
  const row = getDb()
    .prepare(`SELECT id FROM bookmarks WHERE novel_id = ? AND ref = ? LIMIT 1`)
    .get(novelId, ref) as { id: number } | undefined;
  return Boolean(row);
}
