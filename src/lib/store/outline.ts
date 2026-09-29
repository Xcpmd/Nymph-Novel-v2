import { getDb, nowIso } from '../db';
import type { Chapter } from '../types';
import { parseOutlineText, titleFromOutline } from '../outline/parse';
import { recordChange } from './changelog';
import { createChapter, listChapters, updateChapter } from './chapters';

/**
 * 大纲。
 *
 * 每章的大纲占一行，行首写章节序号。数据库按章节序号存一行，
 * 界面上呈现为一张可以整段编辑的文本。
 */

export interface OutlineLine {
  indexNo: number;
  volIndex: number;
  content: string;
  updatedAt: string;
}

export function listOutline(novelId: string): OutlineLine[] {
  const rows = getDb()
    .prepare(`SELECT index_no, vol_index, content, updated_at FROM outline WHERE novel_id = ? ORDER BY index_no`)
    .all(novelId) as { index_no: number; vol_index: number; content: string; updated_at: string }[];
  return rows.map((row) => ({
    indexNo: row.index_no,
    volIndex: row.vol_index,
    content: row.content,
    updatedAt: row.updated_at,
  }));
}

export function setOutlineLine(
  novelId: string,
  indexNo: number,
  content: string,
  volIndex?: number,
  source: 'ai' | 'user' | 'system' = 'user',
): void {
  const existing = getDb()
    .prepare(`SELECT content FROM outline WHERE novel_id = ? AND index_no = ?`)
    .get(novelId, indexNo) as { content: string } | undefined;
  const resolvedVol = volIndex ?? resolveVolIndex(novelId, indexNo);
  if (content.trim() === '') {
    getDb().prepare(`DELETE FROM outline WHERE novel_id = ? AND index_no = ?`).run(novelId, indexNo);
  } else {
    getDb()
      .prepare(
        `INSERT INTO outline (novel_id, vol_index, index_no, content, updated_at)
         VALUES (@novelId, @volIndex, @indexNo, @content, @stamp)
         ON CONFLICT(novel_id, index_no) DO UPDATE SET content = @content, vol_index = @volIndex, updated_at = @stamp`,
      )
      .run({ novelId, volIndex: resolvedVol, indexNo, content, stamp: nowIso() });
  }
  if (existing?.content !== content) {
    recordChange({
      novelId,
      target: 'outline',
      targetId: String(indexNo),
      action: existing ? 'update' : 'create',
      before: existing?.content ?? null,
      after: content,
      source,
      note: `第 ${indexNo} 章大纲`,
    });
  }
}

function resolveVolIndex(novelId: string, indexNo: number): number {
  const row = getDb()
    .prepare(
      `SELECT vol_index AS volIndex FROM outline WHERE novel_id = ? AND index_no < ? ORDER BY index_no DESC LIMIT 1`,
    )
    .get(novelId, indexNo) as { volIndex: number } | undefined;
  return row?.volIndex ?? 1;
}

/** 行首允许写成「12 内容」「第12章 内容」「12. 内容」等形式。 */
export { parseOutlineText, titleFromOutline } from '../outline/parse';

/** 用整段文本替换大纲。未出现在文本中的章节会被清空。 */
export function replaceOutline(
  novelId: string,
  text: string,
  source: 'ai' | 'user' | 'system' = 'user',
): void {
  const parsed = parseOutlineText(text);
  const incoming = new Map(parsed.map((item) => [item.indexNo, item]));
  const existing = listOutline(novelId);
  for (const line of existing) {
    if (!incoming.has(line.indexNo)) setOutlineLine(novelId, line.indexNo, '', line.volIndex, source);
  }
  for (const item of parsed) setOutlineLine(novelId, item.indexNo, item.content, undefined, source);
}

/**
 * 把指定的若干条大纲拆分成对应章节。
 * 传入章节序号集合；不传或传空数组表示处理全部大纲行。
 * 缺少的章节会新建，已存在的只对齐标题，正文不受影响。
 */
export function splitOutlineToChapters(
  novelId: string,
  indexes?: number[],
): { created: number; updated: number; skipped: number } {
  const wanted = indexes && indexes.length > 0 ? new Set(indexes) : null;
  const lines = listOutline(novelId).filter((line) => (wanted ? wanted.has(line.indexNo) : true));
  const chapters = listChapters(novelId);
  const byIndex = new Map<number, Chapter>(chapters.map((chapter) => [chapter.indexNo, chapter]));
  let created = 0;
  let updated = 0;
  for (const line of lines) {
    const title = titleFromOutline(line.content, line.indexNo);
    const existing = byIndex.get(line.indexNo);
    if (!existing) {
      const chapter = createChapter(novelId, { indexNo: line.indexNo, volIndex: line.volIndex, title });
      // 章节摘要先带上大纲，方便工作台和列表一眼看出这章要写什么
      if (line.content.trim()) updateChapter(novelId, chapter.ref, { summary: line.content.trim() });
      created += 1;
      continue;
    }
    if (existing.title !== title && title) {
      updateChapter(novelId, existing.ref, { title });
      updated += 1;
    }
  }
  return { created, updated, skipped: Math.max(0, lines.length - created - updated) };
}

export function outlineForChapter(novelId: string, indexNo: number): string {
  const row = getDb()
    .prepare(`SELECT content FROM outline WHERE novel_id = ? AND index_no = ?`)
    .get(novelId, indexNo) as { content: string } | undefined;
  return row?.content ?? '';
}
