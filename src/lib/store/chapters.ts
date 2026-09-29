import fs from 'node:fs';

import { getDb, isFtsEnabled, nowIso } from '../db';
import { renumberTitle } from '../chapters/order';
import { defaultChapterTitle, defaultVolumeTitle, estimateTokens } from '../format';
import {
  DRAFT_INDEX_BASE,
  DRAFT_VOLUME_INDEX,
  chapterFile,
  chapterRef,
  isDraftIndex,
  parseChapterRef,
  volDir,
  volsDir,
} from '../paths';
import type { Chapter, ChapterDetail, ChapterStatus, Volume } from '../types';
import { recordChange } from './changelog';
import { countWords, ensureDirectory, listDirs, listFiles, readText, removeFile, writeText } from './files';

/**
 * 章节仓库。
 *
 * 正文以 Markdown 文件保存在 novel/{novelId}/vols/vol-XXX/{序号}.md，
 * 数据库保存章节元信息与检索索引。废稿章节使用负数序号区段，与正式章节隔离。
 */

interface VolumeRow {
  vol_index: number;
  title: string;
  summary: string;
}

interface ChapterRow {
  novel_id: string;
  vol_index: number;
  index_no: number;
  title: string;
  summary: string;
  status: string;
  word_count: number;
  created_at: string;
  updated_at: string;
}

function mapChapter(row: ChapterRow): Chapter {
  return {
    novelId: row.novel_id,
    ref: chapterRef(row.vol_index, row.index_no),
    volIndex: row.vol_index,
    indexNo: row.index_no,
    title: row.title,
    summary: row.summary,
    status: row.status as ChapterStatus,
    wordCount: row.word_count,
    isDraft: isDraftIndex(row.index_no),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listVolumes(novelId: string): Volume[] {
  const rows = getDb()
    .prepare(`SELECT vol_index, title, summary FROM volumes WHERE novel_id = ? ORDER BY vol_index`)
    .all(novelId) as VolumeRow[];
  if (rows.length === 0) {
    return [{ index: 1, title: defaultVolumeTitle(1), summary: '' }];
  }
  return rows.map((row) => ({
    index: row.vol_index,
    title: row.title || defaultVolumeTitle(row.vol_index),
    summary: row.summary,
  }));
}

export function upsertVolume(novelId: string, volIndex: number, title?: string, summary?: string): void {
  const existing = getDb()
    .prepare(`SELECT title, summary FROM volumes WHERE novel_id = ? AND vol_index = ?`)
    .get(novelId, volIndex) as { title: string; summary: string } | undefined;
  getDb()
    .prepare(
      `INSERT INTO volumes (novel_id, vol_index, title, summary) VALUES (@novelId, @volIndex, @title, @summary)
       ON CONFLICT(novel_id, vol_index) DO UPDATE SET title = @title, summary = @summary`,
    )
    .run({
      novelId,
      volIndex,
      title: title ?? existing?.title ?? defaultVolumeTitle(volIndex),
      summary: summary ?? existing?.summary ?? '',
    });
  ensureDirectory(volDir(novelId, volIndex));
}

export function listChapters(novelId: string): Chapter[] {
  const rows = getDb()
    .prepare(`SELECT * FROM chapters WHERE novel_id = ? ORDER BY index_no`)
    .all(novelId) as ChapterRow[];
  return rows.map(mapChapter);
}

export function getChapterByRef(novelId: string, ref: string): ChapterDetail | null {
  const { volIndex, indexNo } = parseChapterRef(ref);
  const row = getDb()
    .prepare(`SELECT * FROM chapters WHERE novel_id = ? AND vol_index = ? AND index_no = ?`)
    .get(novelId, volIndex, indexNo) as ChapterRow | undefined;
  if (!row) return null;
  const content = readText(chapterFile(novelId, volIndex, indexNo), '');
  return { ...mapChapter(row), content };
}

export function nextChapterIndex(novelId: string): number {
  const row = getDb()
    .prepare(
      `SELECT MAX(index_no) AS maxIndex FROM chapters WHERE novel_id = ? AND index_no > ?`,
    )
    .get(novelId, DRAFT_INDEX_BASE) as { maxIndex: number | null };
  return (row.maxIndex ?? 0) + 1;
}

export function nextDraftIndexNo(novelId: string): number {
  const row = getDb()
    .prepare(`SELECT MIN(index_no) AS minIndex FROM chapters WHERE novel_id = ? AND index_no <= ?`)
    .get(novelId, DRAFT_INDEX_BASE) as { minIndex: number | null };
  return (row.minIndex ?? DRAFT_INDEX_BASE) - 1;
}

export interface CreateChapterInput {
  volIndex?: number;
  indexNo?: number;
  title?: string;
  summary?: string;
  draft?: boolean;
}

export function createChapter(novelId: string, input: CreateChapterInput = {}): Chapter {
  const draft = input.draft === true;
  const indexNo = input.indexNo ?? (draft ? nextDraftIndexNo(novelId) : nextChapterIndex(novelId));
  const volIndex = draft ? DRAFT_VOLUME_INDEX : (input.volIndex ?? resolveVolumeForIndex(novelId, indexNo));
  const stamp = nowIso();
  ensureDirectory(volDir(novelId, volIndex));
  getDb()
    .prepare(
      `INSERT INTO chapters (novel_id, vol_index, index_no, title, summary, status, word_count, created_at, updated_at)
       VALUES (@novelId, @volIndex, @indexNo, @title, @summary, 'idle', 0, @stamp, @stamp)
       ON CONFLICT(novel_id, vol_index, index_no) DO NOTHING`,
    )
    .run({
      novelId,
      volIndex,
      indexNo,
      title: input.title ?? (draft ? '未命名废稿' : defaultChapterTitle(indexNo)),
      summary: input.summary ?? '',
      stamp,
    });
  const file = chapterFile(novelId, volIndex, indexNo);
  if (!fs.existsSync(file)) writeText(file, '');
  syncIndex(novelId, chapterRef(volIndex, indexNo));
  return requireChapter(novelId, chapterRef(volIndex, indexNo));
}

function resolveVolumeForIndex(novelId: string, indexNo: number): number {
  const row = getDb()
    .prepare(
      `SELECT vol_index AS volIndex FROM chapters WHERE novel_id = ? AND index_no < ? AND index_no > ?
       ORDER BY index_no DESC LIMIT 1`,
    )
    .get(novelId, indexNo, DRAFT_INDEX_BASE) as { volIndex: number } | undefined;
  if (row) return row.volIndex;
  const volumes = listVolumes(novelId);
  return volumes[volumes.length - 1]?.index ?? 1;
}

export function requireChapter(novelId: string, ref: string): Chapter {
  const { volIndex, indexNo } = parseChapterRef(ref);
  const row = getDb()
    .prepare(`SELECT * FROM chapters WHERE novel_id = ? AND vol_index = ? AND index_no = ?`)
    .get(novelId, volIndex, indexNo) as ChapterRow | undefined;
  if (!row) throw new Error('章节不存在');
  return mapChapter(row);
}

export interface ChapterPatch {
  title?: string;
  summary?: string;
  status?: ChapterStatus;
  volIndex?: number;
}

export function updateChapter(novelId: string, ref: string, patch: ChapterPatch): Chapter {
  const before = requireChapter(novelId, ref);
  const { volIndex, indexNo } = parseChapterRef(ref);
  const targetVol = patch.volIndex ?? volIndex;
  const fields: string[] = [];
  const params: Record<string, unknown> = { novelId, volIndex, indexNo, updatedAt: nowIso() };
  if (patch.title !== undefined) {
    fields.push('title = @title');
    params.title = patch.title;
  }
  if (patch.summary !== undefined) {
    fields.push('summary = @summary');
    params.summary = patch.summary;
  }
  if (patch.status !== undefined) {
    fields.push('status = @status');
    params.status = patch.status;
  }
  if (patch.volIndex !== undefined && patch.volIndex !== volIndex) {
    fields.push('vol_index = @newVolIndex');
    params.newVolIndex = patch.volIndex;
    ensureDirectory(volDir(novelId, patch.volIndex));
  }
  if (fields.length > 0) {
    fields.push('updated_at = @updatedAt');
    getDb()
      .prepare(
        `UPDATE chapters SET ${fields.join(', ')} WHERE novel_id = @novelId AND vol_index = @volIndex AND index_no = @indexNo`,
      )
      .run(params);
  }
  if (patch.volIndex !== undefined && patch.volIndex !== volIndex) {
    const from = chapterFile(novelId, volIndex, indexNo);
    const to = chapterFile(novelId, patch.volIndex, indexNo);
    if (fs.existsSync(from)) {
      ensureDirectory(volDir(novelId, patch.volIndex));
      fs.renameSync(from, to);
    }
    syncIndex(novelId, chapterRef(patch.volIndex, indexNo));
    removeIndex(novelId, ref);
  }
  if (patch.title !== undefined && patch.title !== before.title) {
    recordChange({
      novelId,
      target: 'chapter',
      targetId: ref,
      action: 'update',
      before: { title: before.title },
      after: { title: patch.title },
      source: 'user',
      note: '修改章节标题',
    });
  }
  return requireChapter(novelId, chapterRef(targetVol, indexNo));
}

/** 写入正文。同时刷新字数、检索索引与修改时间。 */
export function saveChapterContent(
  novelId: string,
  ref: string,
  content: string,
  options: { status?: ChapterStatus; source?: 'ai' | 'user' | 'system'; silent?: boolean } = {},
): Chapter {
  const chapter = requireChapter(novelId, ref);
  const { volIndex, indexNo } = parseChapterRef(ref);
  const file = chapterFile(novelId, volIndex, indexNo);
  const previous = readText(file, '');
  writeText(file, content);
  const words = countWords(content);
  getDb()
    .prepare(
      `UPDATE chapters SET word_count = @words, updated_at = @stamp${
        options.status ? ', status = @status' : ''
      } WHERE novel_id = @novelId AND vol_index = @volIndex AND index_no = @indexNo`,
    )
    .run({
      words,
      stamp: nowIso(),
      novelId,
      volIndex,
      indexNo,
      status: options.status,
    });
  syncIndex(novelId, ref);
  if (!options.silent && previous !== content) {
    recordChange({
      novelId,
      target: 'chapter-content',
      targetId: ref,
      action: 'update',
      before: { words: countWords(previous), preview: previous.slice(0, 200) },
      after: { words, preview: content.slice(0, 200) },
      source: options.source ?? 'user',
      note: `更新${chapter.title}正文`,
    });
  }
  return requireChapter(novelId, ref);
}

export function deleteChapter(novelId: string, ref: string): void {
  const chapter = requireChapter(novelId, ref);
  const { volIndex, indexNo } = parseChapterRef(ref);
  removeFile(chapterFile(novelId, volIndex, indexNo));
  getDb()
    .prepare(`DELETE FROM chapters WHERE novel_id = ? AND vol_index = ? AND index_no = ?`)
    .run(novelId, volIndex, indexNo);
  getDb().prepare(`DELETE FROM chapter_tags WHERE novel_id = ? AND ref = ?`).run(novelId, ref);
  getDb().prepare(`DELETE FROM bookmarks WHERE novel_id = ? AND ref = ?`).run(novelId, ref);
  removeIndex(novelId, ref);
  recordChange({
    novelId,
    target: 'chapter',
    targetId: ref,
    action: 'delete',
    before: chapter,
    source: 'user',
    note: '删除章节',
  });
}

/** 把章节移入废稿区，正文文件一并搬到 vol-000。 */
export function moveToDraft(novelId: string, ref: string): Chapter {
  const chapter = requireChapter(novelId, ref);
  if (chapter.isDraft) return chapter;
  const { volIndex, indexNo } = parseChapterRef(ref);
  const newIndex = nextDraftIndexNo(novelId);
  const from = chapterFile(novelId, volIndex, indexNo);
  const to = chapterFile(novelId, DRAFT_VOLUME_INDEX, newIndex);
  ensureDirectory(volDir(novelId, DRAFT_VOLUME_INDEX));
  const content = readText(from, '');
  writeText(to, content);
  removeFile(from);
  getDb()
    .prepare(`DELETE FROM chapters WHERE novel_id = ? AND vol_index = ? AND index_no = ?`)
    .run(novelId, volIndex, indexNo);
  getDb()
    .prepare(
      `INSERT INTO chapters (novel_id, vol_index, index_no, title, summary, status, word_count, created_at, updated_at)
       VALUES (@novelId, @volIndex, @indexNo, @title, @summary, @status, @words, @createdAt, @updatedAt)`,
    )
    .run({
      novelId,
      volIndex: DRAFT_VOLUME_INDEX,
      indexNo: newIndex,
      title: chapter.title,
      summary: chapter.summary,
      status: chapter.status,
      words: chapter.wordCount,
      createdAt: chapter.createdAt,
      updatedAt: nowIso(),
    });
  removeIndex(novelId, ref);
  syncIndex(novelId, chapterRef(DRAFT_VOLUME_INDEX, newIndex));
  recordChange({
    novelId,
    target: 'chapter',
    targetId: ref,
    action: 'update',
    before: { ref },
    after: { ref: chapterRef(DRAFT_VOLUME_INDEX, newIndex) },
    source: 'user',
    note: '移入废稿区',
  });
  return requireChapter(novelId, chapterRef(DRAFT_VOLUME_INDEX, newIndex));
}

export function restoreFromDraft(novelId: string, ref: string): Chapter {
  const chapter = requireChapter(novelId, ref);
  if (!chapter.isDraft) return chapter;
  const { volIndex, indexNo } = parseChapterRef(ref);
  const newIndex = nextChapterIndex(novelId);
  const targetVol = resolveVolumeForIndex(novelId, newIndex);
  const from = chapterFile(novelId, volIndex, indexNo);
  const to = chapterFile(novelId, targetVol, newIndex);
  ensureDirectory(volDir(novelId, targetVol));
  const content = readText(from, '');
  writeText(to, content);
  removeFile(from);
  getDb()
    .prepare(`DELETE FROM chapters WHERE novel_id = ? AND vol_index = ? AND index_no = ?`)
    .run(novelId, volIndex, indexNo);
  getDb()
    .prepare(
      `INSERT INTO chapters (novel_id, vol_index, index_no, title, summary, status, word_count, created_at, updated_at)
       VALUES (@novelId, @volIndex, @indexNo, @title, @summary, @status, @words, @createdAt, @updatedAt)`,
    )
    .run({
      novelId,
      volIndex: targetVol,
      indexNo: newIndex,
      title: chapter.title.replace(/^废稿\s*/, '').trim() || defaultChapterTitle(newIndex),
      summary: chapter.summary,
      status: chapter.status,
      words: chapter.wordCount,
      createdAt: chapter.createdAt,
      updatedAt: nowIso(),
    });
  removeIndex(novelId, ref);
  syncIndex(novelId, chapterRef(targetVol, newIndex));
  return requireChapter(novelId, chapterRef(targetVol, newIndex));
}

/* ---------------------------------- 手动排序 ---------------------------------- */

export interface ReorderEntry {
  ref: string;
  volIndex: number;
}

/**
 * 按给定顺序重排全部正式章节。
 *
 * 章节跟着位置走：正文文件、标题与摘要、标签、书签、检索索引以及对应的大纲行
 * 都会一起搬到新的序号上，因此拖动之后引用不会错位。
 * 废稿章节不参与排序，序号也保持不变。
 */
export function reorderChapters(
  novelId: string,
  order: ReorderEntry[],
): { mapping: { from: string; to: string }[] } {
  const formal = listChapters(novelId).filter((chapter) => !chapter.isDraft);
  const byRef = new Map(formal.map((chapter) => [chapter.ref, chapter]));

  if (order.length !== formal.length) {
    throw new Error('排序数据与章节数量不一致');
  }
  const seen = new Set<string>();
  for (const entry of order) {
    if (!byRef.has(entry.ref)) throw new Error(`排序里包含不存在的章节：${entry.ref}`);
    if (seen.has(entry.ref)) throw new Error(`排序里有重复的章节：${entry.ref}`);
    seen.add(entry.ref);
  }

  // 先把正文全部读进内存，再统一落盘，避免重命名过程中互相覆盖
  const contents = new Map<string, string>();
  for (const chapter of formal) {
    const { volIndex, indexNo } = parseChapterRef(chapter.ref);
    contents.set(chapter.ref, readText(chapterFile(novelId, volIndex, indexNo), ''));
  }

  const mapping = order.map((entry, position) => {
    const chapter = byRef.get(entry.ref) as Chapter;
    const indexNo = position + 1;
    return {
      from: entry.ref,
      to: chapterRef(entry.volIndex, indexNo),
      chapter,
      // 序号就是位置，标题里的章节号也要跟着对齐
      title: renumberTitle(chapter.title, indexNo),
      oldIndexNo: parseChapterRef(entry.ref).indexNo,
      volIndex: entry.volIndex,
      indexNo,
    };
  });

  for (const chapter of formal) {
    const { volIndex, indexNo } = parseChapterRef(chapter.ref);
    removeFile(chapterFile(novelId, volIndex, indexNo));
  }
  for (const item of mapping) {
    ensureDirectory(volDir(novelId, item.volIndex));
    writeText(chapterFile(novelId, item.volIndex, item.indexNo), contents.get(item.from) ?? '');
  }

  const db = getDb();
  const stamp = nowIso();
  db.transaction(() => {
    db.prepare(`DELETE FROM chapters WHERE novel_id = ? AND index_no > ?`).run(novelId, DRAFT_INDEX_BASE);
    const insert = db.prepare(
      `INSERT INTO chapters (novel_id, vol_index, index_no, title, summary, status, word_count, created_at, updated_at)
       VALUES (@novelId, @volIndex, @indexNo, @title, @summary, @status, @words, @createdAt, @updatedAt)`,
    );
    for (const item of mapping) {
      insert.run({
        novelId,
        volIndex: item.volIndex,
        indexNo: item.indexNo,
        title: item.title,
        summary: item.chapter.summary,
        status: item.chapter.status,
        words: item.chapter.wordCount,
        createdAt: item.chapter.createdAt,
        updatedAt: stamp,
      });
    }
    for (const volIndex of new Set(mapping.map((item) => item.volIndex))) {
      db.prepare(
        `INSERT OR IGNORE INTO volumes (novel_id, vol_index, title, summary) VALUES (?, ?, ?, '')`,
      ).run(novelId, volIndex, defaultVolumeTitle(volIndex));
    }

    // 标签与书签的引用跟着章节走。分两步改写，避免目标引用已被占用
    const toTemp = (table: string) =>
      db.prepare(`UPDATE ${table} SET ref = 'tmp-' || ref WHERE novel_id = ? AND ref = ?`);
    const toFinal = (table: string) =>
      db.prepare(`UPDATE ${table} SET ref = ? WHERE novel_id = ? AND ref = ?`);
    for (const table of ['chapter_tags', 'bookmarks']) {
      for (const item of mapping) toTemp(table).run(novelId, item.from);
      for (const item of mapping) toFinal(table).run(item.to, novelId, `tmp-${item.from}`);
    }

    db.prepare(`DELETE FROM chapter_index WHERE novel_id = ?`).run(novelId);
    if (isFtsEnabled()) db.prepare(`DELETE FROM chapter_fts WHERE novel_id = ?`).run(novelId);
  })();

  for (const item of mapping) syncIndex(novelId, item.to);
  remapOutlineIndexes(
    novelId,
    mapping.map((item) => ({ from: item.oldIndexNo, to: item.indexNo })),
  );

  recordChange({
    novelId,
    target: 'chapter-order',
    targetId: '',
    action: 'update',
    before: mapping.map((item) => ({ from: item.from, title: item.chapter.title })),
    after: mapping.map((item) => ({ to: item.to, title: item.title })),
    source: 'user',
    note: '手动调整章节顺序',
  });

  return { mapping: mapping.map((item) => ({ from: item.from, to: item.to })) };
}

/**
 * 大纲行跟着章节搬迁。
 * 没有对应章节的大纲行（例如还没写的规划行）如果和目标序号冲突，
 * 会顺延到末尾，不会丢失。
 */
function remapOutlineIndexes(novelId: string, mapping: { from: number; to: number }[]): void {
  if (mapping.length === 0) return;
  const db = getDb();
  const rows = db
    .prepare(`SELECT index_no, vol_index, content, updated_at FROM outline WHERE novel_id = ?`)
    .all(novelId) as { index_no: number; vol_index: number; content: string; updated_at: string }[];
  if (rows.length === 0) return;

  const followMap = new Map(mapping.map((item) => [item.from, item.to]));
  const sorted = [...rows].sort((a, b) => {
    const aFollows = followMap.has(a.index_no) ? 0 : 1;
    const bFollows = followMap.has(b.index_no) ? 0 : 1;
    return aFollows - bFollows || a.index_no - b.index_no;
  });

  const taken = new Set<number>();
  const finalRows: { indexNo: number; volIndex: number; content: string; updatedAt: string }[] = [];
  const displaced: typeof finalRows = [];
  for (const row of sorted) {
    const target = followMap.get(row.index_no) ?? row.index_no;
    const value = { indexNo: target, volIndex: row.vol_index, content: row.content, updatedAt: row.updated_at };
    if (taken.has(target)) {
      displaced.push(value);
      continue;
    }
    taken.add(target);
    finalRows.push(value);
  }
  let next = Math.max(0, ...rows.map((row) => row.index_no), ...finalRows.map((row) => row.indexNo)) + 1;
  for (const row of displaced) {
    while (taken.has(next)) next += 1;
    taken.add(next);
    finalRows.push({ ...row, indexNo: next });
  }

  db.transaction(() => {
    db.prepare(`DELETE FROM outline WHERE novel_id = ?`).run(novelId);
    const insert = db.prepare(
      `INSERT INTO outline (novel_id, vol_index, index_no, content, updated_at) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const row of finalRows) {
      insert.run(novelId, row.volIndex, row.indexNo, row.content, row.updatedAt);
    }
  })();
}

/* ---------------------------------- 检索索引 ---------------------------------- */

function removeIndex(novelId: string, ref: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM chapter_index WHERE novel_id = ? AND ref = ?`).run(novelId, ref);
  if (isFtsEnabled()) {
    db.prepare(`DELETE FROM chapter_fts WHERE novel_id = ? AND ref = ?`).run(novelId, ref);
  }
}

/** 把一章的标题与正文同步进检索索引。 */
export function syncIndex(novelId: string, ref: string): void {
  const { volIndex, indexNo } = parseChapterRef(ref);
  const row = getDb()
    .prepare(`SELECT title FROM chapters WHERE novel_id = ? AND vol_index = ? AND index_no = ?`)
    .get(novelId, volIndex, indexNo) as { title: string } | undefined;
  if (!row) {
    removeIndex(novelId, ref);
    return;
  }
  const content = readText(chapterFile(novelId, volIndex, indexNo), '');
  const db = getDb();
  db.prepare(
    `INSERT INTO chapter_index (novel_id, ref, index_no, title, content, updated_at)
     VALUES (@novelId, @ref, @indexNo, @title, @content, @stamp)
     ON CONFLICT(novel_id, ref) DO UPDATE SET
       index_no = @indexNo, title = @title, content = @content, updated_at = @stamp`,
  ).run({ novelId, ref, indexNo, title: row.title, content, stamp: nowIso() });
  if (isFtsEnabled()) {
    db.prepare(`DELETE FROM chapter_fts WHERE novel_id = ? AND ref = ?`).run(novelId, ref);
    db.prepare(
      `INSERT INTO chapter_fts (novel_id, ref, title, content) VALUES (?, ?, ?, ?)`,
    ).run(novelId, ref, row.title, content);
  }
}

/** 扫描卷目录，把磁盘上存在但数据库缺失的章节补录进来。 */
export function rescanChapters(novelId: string): number {
  const db = getDb();
  let added = 0;
  const dirs = listDirs(volsDir(novelId));
  for (const dirName of dirs) {
    const match = /^vol-(\d+)$/.exec(dirName);
    if (!match) continue;
    const volIndex = Number(match[1]);
    const dir = volDir(novelId, volIndex);
    for (const file of listFiles(dir, '.md')) {
      const indexNo = Number(file.replace(/\.md$/, ''));
      if (!Number.isFinite(indexNo)) continue;
      const exists = db
        .prepare(`SELECT 1 AS ok FROM chapters WHERE novel_id = ? AND vol_index = ? AND index_no = ?`)
        .get(novelId, volIndex, indexNo);
      if (exists) {
        syncIndex(novelId, chapterRef(volIndex, indexNo));
        continue;
      }
      const stamp = nowIso();
      db.prepare(
        `INSERT INTO chapters (novel_id, vol_index, index_no, title, summary, status, word_count, created_at, updated_at)
         VALUES (@novelId, @volIndex, @indexNo, @title, '', 'done', @words, @stamp, @stamp)`,
      ).run({
        novelId,
        volIndex,
        indexNo,
        title: indexNo <= DRAFT_INDEX_BASE ? '未命名废稿' : defaultChapterTitle(indexNo),
        words: countWords(readText(chapterFile(novelId, volIndex, indexNo), '')),
        stamp,
      });
      syncIndex(novelId, chapterRef(volIndex, indexNo));
      added += 1;
    }
  }
  return added;
}

/** 统计一部小说的字数与 token 估算，用于概览页。 */
export function chapterStats(novelId: string): {
  chapters: number;
  words: number;
  tokens: number;
  done: number;
  drafts: number;
} {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(word_count), 0) AS words,
              COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done,
              COALESCE(SUM(CASE WHEN index_no <= ? THEN 1 ELSE 0 END), 0) AS drafts
       FROM chapters WHERE novel_id = ?`,
    )
    .get(DRAFT_INDEX_BASE, novelId) as {
    total: number;
    words: number;
    done: number;
    drafts: number;
  };
  const tokens = Math.ceil(row.words * 1.1);
  return { chapters: row.total, words: row.words, tokens, done: row.done, drafts: row.drafts };
}

export { DRAFT_INDEX_BASE };
export { estimateTokens };
