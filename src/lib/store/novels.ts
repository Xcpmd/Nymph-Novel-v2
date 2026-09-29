import fs from 'node:fs';

import { novelIdFromTitle } from '../crypto';
import { getDb, nowIso, toBool } from '../db';
import { defaultVolumeTitle } from '../format';
import {
  baseDir,
  charaDir,
  coverFile,
  novelDir,
  settingDir,
  volsDir,
  volDir,
} from '../paths';
import type { ContextStrategy, Novel, NovelInput, ReadingMode } from '../types';
import { removeDir } from './files';
import { recordChange } from './changelog';

/**
 * 小说仓库。
 * 每部小说在 novel/ 下拥有独立目录，创建时一次性铺好全部子目录。
 */

interface NovelRow {
  id: string;
  title: string;
  author: string;
  description: string;
  genre: string;
  pov: string;
  tone: string;
  font_size: number;
  line_height: number;
  dialogue_highlight: number;
  reading_mode: string;
  context_strategy: string;
  token_budget: number;
  cover_version: number;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
}

function mapRow(row: NovelRow): Novel {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    genre: row.genre,
    pov: row.pov,
    tone: row.tone,
    fontSize: row.font_size,
    lineHeight: row.line_height,
    dialogueHighlight: toBool(row.dialogue_highlight),
    readingMode: row.reading_mode as ReadingMode,
    contextStrategy: row.context_strategy as ContextStrategy,
    tokenBudget: row.token_budget,
    hasCover: fs.existsSync(coverFile(row.id)),
    coverVersion: row.cover_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  };
}

/** 铺好一部小说的全部目录，重复调用是安全的。 */
export function scaffoldNovelDirs(novelId: string): void {
  fs.mkdirSync(volDir(novelId, 1), { recursive: true });
  fs.mkdirSync(settingDir(novelId), { recursive: true });
  fs.mkdirSync(charaDir(novelId), { recursive: true });
  fs.mkdirSync(baseDir(novelId), { recursive: true });
}

export function listNovels(): Novel[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM novels ORDER BY COALESCE(last_opened_at, created_at) DESC`,
    )
    .all() as NovelRow[];
  return rows.map(mapRow);
}

export function getNovel(id: string): Novel | null {
  const row = getDb().prepare(`SELECT * FROM novels WHERE id = ?`).get(id) as NovelRow | undefined;
  return row ? mapRow(row) : null;
}

export function requireNovel(id: string): Novel {
  const novel = getNovel(id);
  if (!novel) throw new Error('小说不存在');
  return novel;
}

export function createNovel(input: NovelInput): Novel {
  const title = input.title.trim();
  if (!title) throw new Error('小说标题不能为空');
  const db = getDb();
  const id = novelIdFromTitle(title);
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO novels (id, title, author, description, genre, pov, tone, created_at, updated_at)
     VALUES (@id, @title, @author, @description, @genre, @pov, @tone, @createdAt, @updatedAt)`,
  ).run({
    id,
    title,
    author: input.author?.trim() ?? '',
    description: input.description?.trim() ?? '',
    genre: input.genre?.trim() ?? '',
    pov: input.pov?.trim() ?? '',
    tone: input.tone?.trim() ?? '',
    createdAt: stamp,
    updatedAt: stamp,
  });
  scaffoldNovelDirs(id);
  db.prepare(
    `INSERT OR IGNORE INTO volumes (novel_id, vol_index, title, summary) VALUES (?, 1, ?, '')`,
  ).run(id, defaultVolumeTitle(1));
  recordChange({
    novelId: id,
    target: 'novel',
    targetId: id,
    action: 'create',
    after: { title },
    source: 'user',
    note: '创建小说',
  });
  return requireNovel(id);
}

export interface NovelPatch {
  title?: string;
  author?: string;
  description?: string;
  genre?: string;
  pov?: string;
  tone?: string;
  fontSize?: number;
  lineHeight?: number;
  dialogueHighlight?: boolean;
  readingMode?: ReadingMode;
  contextStrategy?: ContextStrategy;
  tokenBudget?: number;
}

export function updateNovel(id: string, patch: NovelPatch): Novel {
  const before = requireNovel(id);
  const fields: string[] = [];
  const params: Record<string, unknown> = { id, updatedAt: nowIso() };
  const mapping: [keyof NovelPatch, string][] = [
    ['title', 'title'],
    ['author', 'author'],
    ['description', 'description'],
    ['genre', 'genre'],
    ['pov', 'pov'],
    ['tone', 'tone'],
    ['fontSize', 'font_size'],
    ['lineHeight', 'line_height'],
    ['readingMode', 'reading_mode'],
    ['contextStrategy', 'context_strategy'],
    ['tokenBudget', 'token_budget'],
  ];
  for (const [key, column] of mapping) {
    const value = patch[key];
    if (value === undefined) continue;
    fields.push(`${column} = @${key}`);
    params[key] = value;
  }
  if (patch.dialogueHighlight !== undefined) {
    fields.push('dialogue_highlight = @dialogueHighlight');
    params.dialogueHighlight = patch.dialogueHighlight ? 1 : 0;
  }
  if (fields.length === 0) return before;
  fields.push('updated_at = @updatedAt');
  getDb()
    .prepare(`UPDATE novels SET ${fields.join(', ')} WHERE id = @id`)
    .run(params);
  const after = requireNovel(id);
  if (patch.title !== undefined && patch.title !== before.title) {
    recordChange({
      novelId: id,
      target: 'novel',
      targetId: id,
      action: 'update',
      before: { title: before.title },
      after: { title: after.title },
      source: 'user',
      note: '修改小说标题',
    });
  }
  return after;
}

export function touchNovel(id: string): void {
  getDb().prepare(`UPDATE novels SET last_opened_at = ? WHERE id = ?`).run(nowIso(), id);
}

export function deleteNovel(id: string): void {
  requireNovel(id);
  const db = getDb();
  db.prepare(`DELETE FROM novels WHERE id = ?`).run(id);
  const tables = [
    'volumes',
    'chapters',
    'chapter_index',
    'independent_rules',
    'rule_bindings',
    'characters',
    'relations',
    'encyclopedia',
    'outline',
    'tags',
    'chapter_tags',
    'bookmarks',
    'changelog',
  ];
  for (const table of tables) {
    db.prepare(`DELETE FROM ${table} WHERE novel_id = ?`).run(id);
  }
  db.prepare(`DELETE FROM usage_log WHERE novel_id = ?`).run(id);
  if (isFtsTablePresent()) {
    db.prepare(`DELETE FROM chapter_fts WHERE novel_id = ?`).run(id);
  }
  removeDir(novelDir(id));
}

function isFtsTablePresent(): boolean {
  return Boolean(
    getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chapter_fts'`)
      .get(),
  );
}

export function setCover(id: string, data: Buffer | null): Novel {
  requireNovel(id);
  if (data) {
    fs.mkdirSync(novelDir(id), { recursive: true });
    fs.writeFileSync(coverFile(id), data);
    getDb()
      .prepare(`UPDATE novels SET cover_version = cover_version + 1, updated_at = ? WHERE id = ?`)
      .run(nowIso(), id);
  } else {
    fs.rmSync(coverFile(id), { force: true });
    getDb()
      .prepare(`UPDATE novels SET cover_version = cover_version + 1, updated_at = ? WHERE id = ?`)
      .run(nowIso(), id);
  }
  return requireNovel(id);
}

export function novelDirs(id: string) {
  return {
    root: novelDir(id),
    setting: settingDir(id),
    vols: volsDir(id),
    chara: charaDir(id),
    base: baseDir(id),
    cover: coverFile(id),
  };
}
