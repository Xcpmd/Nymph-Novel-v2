import { createNovel } from '@/lib/store/novels';
import {
  createChapter,
  saveChapterContent,
  updateChapter,
} from '@/lib/store/chapters';
import { upsertCharacter, upsertRelation } from '@/lib/store/characters';
import { upsertEntry } from '@/lib/store/encyclopedia';
import { setOutlineLine } from '@/lib/store/outline';
import { saveIndependentRule } from '@/lib/store/rules';
import { fail, handleError, ok } from '@/lib/api/http';
import type { AiCharacterDraft, EncyclopediaCategory } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 默认章节切分规则：匹配「第X章 标题」。 */
const DEFAULT_PATTERN = '^\\s*第\\s*([0-9一二三四五六七八九十百千零两]+)\\s*[章回节]\\s*(.*)$';

interface ParsedChapter {
  title: string;
  content: string;
}

/** 按正则把整本 txt 拆成章节。匹配不到时整篇作为第一章。 */
export function splitChapters(text: string, pattern: string): ParsedChapter[] {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'gm');
  } catch {
    regex = new RegExp(DEFAULT_PATTERN, 'gm');
  }
  const lines = text.split(/\r?\n/);
  const chapters: ParsedChapter[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (regex.test(line)) {
      if (current) chapters.push({ title: current.title, content: current.lines.join('\n').trim() });
      current = { title: line.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) chapters.push({ title: current.title, content: current.lines.join('\n').trim() });
  if (chapters.length === 0) {
    const trimmed = text.trim();
    if (trimmed) chapters.push({ title: '第1章', content: trimmed });
  }
  return chapters;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('没有收到文件');
    if (file.size > 64 * 1024 * 1024) return fail('文件不能超过 64MB');
    const mode = String(form.get('mode') ?? 'txt');
    const raw = await file.text();

    if (mode === 'bundle') {
      return importBundle(raw);
    }

    const fallbackTitle = file.name.replace(/\.(txt|md|text)$/i, '') || '导入的小说';
    const title = String(form.get('title') ?? '').trim() || fallbackTitle;
    const pattern = String(form.get('pattern') ?? '').trim() || DEFAULT_PATTERN;
    const parsed = splitChapters(raw, pattern);

    const novel = createNovel({
      title,
      description: `由 ${file.name} 导入，共 ${parsed.length} 章`,
    });
    parsed.forEach((chapter, index) => {
      const indexNo = index + 1;
      const created = createChapter(novel.id, { indexNo, volIndex: 1, title: chapter.title });
      saveChapterContent(novel.id, created.ref, chapter.content, { status: 'done', source: 'system', silent: true });
    });
    setOutlineLine(novel.id, 1, parsed[0]?.title ?? '开篇', 1, 'system');

    return ok({ novel, chapters: parsed.length, mode: 'txt' });
  } catch (error) {
    return handleError(error);
  }
}

interface BundleShape {
  kind?: string;
  novel?: {
    title?: string;
    author?: string;
    description?: string;
    genre?: string;
    pov?: string;
    tone?: string;
  };
  chapters?: {
    volIndex?: number;
    indexNo?: number;
    title?: string;
    summary?: string;
    status?: string;
    content?: string;
  }[];
  outline?: { indexNo: number; volIndex?: number; content: string }[];
  characters?: AiCharacterDraft[];
  relations?: { from: string; to: string; label?: string; kind?: string; strength?: number }[];
  encyclopedia?: {
    title: string;
    category?: EncyclopediaCategory;
    tags?: string[];
    summary?: string;
    content?: string;
  }[];
  rules?: { independent?: { title: string; content: string; category?: 'system' | 'user' | 'assistant' }[] };
}

function importBundle(raw: string): Response {
  let parsed: BundleShape;
  try {
    parsed = JSON.parse(raw) as BundleShape;
  } catch {
    return fail('数据包不是合法的 JSON');
  }
  if (parsed.kind && parsed.kind !== 'nymph-novel-bundle') {
    return fail('数据包类型不匹配');
  }
  const title = parsed.novel?.title?.trim();
  if (!title) return fail('数据包里没有小说标题');

  const novel = createNovel({
    title,
    author: parsed.novel?.author,
    description: parsed.novel?.description,
    genre: parsed.novel?.genre,
    pov: parsed.novel?.pov,
    tone: parsed.novel?.tone,
  });

  for (const chapter of parsed.chapters ?? []) {
    const indexNo = chapter.indexNo ?? 1;
    const volIndex = chapter.volIndex ?? 1;
    const created = createChapter(novel.id, { indexNo, volIndex, title: chapter.title ?? '' });
    saveChapterContent(novel.id, created.ref, chapter.content ?? '', {
      status: chapter.status === 'draft' ? 'draft' : 'done',
      source: 'system',
      silent: true,
    });
    if (chapter.summary) updateChapter(novel.id, created.ref, { summary: chapter.summary });
  }

  for (const line of parsed.outline ?? []) {
    setOutlineLine(novel.id, line.indexNo, line.content, line.volIndex, 'system');
  }
  for (const character of parsed.characters ?? []) {
    if (character?.name) upsertCharacter(novel.id, character, 'system');
  }
  for (const relation of parsed.relations ?? []) {
    if (relation?.from && relation?.to) upsertRelation(novel.id, relation, 'system');
  }
  for (const entry of parsed.encyclopedia ?? []) {
    if (entry?.title) upsertEntry(novel.id, entry, 'system');
  }
  for (const rule of parsed.rules?.independent ?? []) {
    if (rule?.title) saveIndependentRule(novel.id, { title: rule.title, content: rule.content ?? '', category: rule.category });
  }

  return ok({
    novel,
    chapters: (parsed.chapters ?? []).length,
    mode: 'bundle',
  });
}
