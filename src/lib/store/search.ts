import { getDb, isFtsEnabled } from '../db';
import { snippetAround } from '../format';
import type { SearchHit } from '../types';

/**
 * 章节检索。
 *
 * 优先使用 SQLite 的 FTS5 全文索引，命中失败或索引不可用时退回到
 * 逐章子串匹配，保证在任何环境下都能搜到结果。
 */

function escapeFtsQuery(query: string): string {
  // trigram 分词器下把整段当作一个短语即可，去掉会破坏语法的符号
  return query.replace(/["'*()^:]/g, ' ').trim();
}

function searchByFts(novelId: string, query: string, limit: number): SearchHit[] {
  const db = getDb();
  const escaped = escapeFtsQuery(query);
  if (!escaped) return [];
  try {
    const rows = db
      .prepare(
        `SELECT ref, title, content, bm25(chapter_fts) AS score
         FROM chapter_fts
         WHERE novel_id = ? AND chapter_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
      )
      .all(novelId, `"${escaped}"`, limit) as {
      ref: string;
      title: string;
      content: string;
      score: number;
    }[];
    return rows.map((row) => ({
      ref: row.ref,
      indexNo: Number(row.ref.split(':')[1] ?? 0),
      title: row.title,
      snippet: snippetAround(row.content, escaped),
      score: Math.abs(row.score),
      matched: row.title.includes(escaped) ? 'title' : 'content',
    }));
  } catch {
    return [];
  }
}

function searchByLike(novelId: string, query: string, limit: number): SearchHit[] {
  const rows = getDb()
    .prepare(
      `SELECT ref, index_no, title, content FROM chapter_index
       WHERE novel_id = ? AND (title LIKE ? OR content LIKE ?)
       ORDER BY index_no LIMIT ?`,
    )
    .all(novelId, `%${query}%`, `%${query}%`, limit) as {
    ref: string;
    index_no: number;
    title: string;
    content: string;
  }[];
  return rows.map((row) => ({
    ref: row.ref,
    indexNo: row.index_no,
    title: row.title,
    snippet: snippetAround(row.content, query),
    score: row.title.includes(query) ? 2 : 1,
    matched: row.title.includes(query) ? 'title' : 'content',
  }));
}

export function searchChapters(novelId: string, query: string, limit = 40): SearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (isFtsEnabled()) {
    const hits = searchByFts(novelId, trimmed, limit);
    if (hits.length > 0) return hits;
  }
  return searchByLike(novelId, trimmed, limit);
}

export interface ChapterListFilter {
  keyword?: string;
  tag?: string;
  bookmarked?: boolean;
}

export function searchTitles(novelId: string, keyword: string, limit = 60): SearchHit[] {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  const rows = getDb()
    .prepare(
      `SELECT ref, index_no, title FROM chapters
       WHERE novel_id = ? AND title LIKE ?
       ORDER BY index_no LIMIT ?`,
    )
    .all(novelId, `%${trimmed}%`, limit) as { ref: string; index_no: number; title: string }[];
  return rows.map((row) => ({
    ref: row.ref,
    indexNo: row.index_no,
    title: row.title,
    snippet: '',
    score: 3,
    matched: 'title' as const,
  }));
}

export function reindexNovel(novelId: string, sync: (ref: string) => void): number {
  const rows = getDb()
    .prepare(`SELECT ref FROM chapter_index WHERE novel_id = ?`)
    .all(novelId) as { ref: string }[];
  for (const row of rows) sync(row.ref);
  return rows.length;
}
