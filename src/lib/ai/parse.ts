import type { AiChapterPayload, CharacterRole, EncyclopediaCategory } from '../types';
import { stripCodeFence } from '../rules/dsl';

/**
 * AI 返回内容解析。
 *
 * 约定 AI 只返回一个固定结构的 JSON 对象，正文放在 content 字段里。
 * 模型偶尔会加上解释文字或代码块围栏，这里做逐级降级解析：
 * 直接解析 → 代码块内解析 → 取最长的一段平衡花括号 → 整体当作正文。
 */

const ROLE_VALUES: CharacterRole[] = ['protagonist', 'major', 'supporting'];
const CATEGORY_VALUES: EncyclopediaCategory[] = [
  'place',
  'race',
  'creature',
  'item',
  'concept',
  'event',
  'other',
];

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asString(item)).filter(Boolean);
  const single = asString(value);
  return single ? [single] : [];
}

/** 从文本里取出所有平衡的 JSON 对象片段，按长度从大到小返回。 */
export function extractBalancedObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, index + 1));
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return results.sort((a, b) => b.length - a.length);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function coercePayload(value: unknown): AiChapterPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const payload: AiChapterPayload = {};

  const title = asString(record.title ?? record['标题']);
  if (title) payload.title = title.replace(/^第\s*[0-9一二三四五六七八九十百]+\s*章\s*/, '').trim();

  const summary = asString(record.summary ?? record['摘要']);
  if (summary) payload.summary = summary.trim();

  const content = asString(record.content ?? record['正文'] ?? record['body']);
  if (content) payload.content = content;

  const nextOutline = asString(record.nextOutline ?? record['下一章大纲']);
  if (nextOutline) payload.nextOutline = nextOutline;

  const characters = record.characters ?? record['角色'];
  if (Array.isArray(characters)) {
    payload.characters = characters
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const name = asString(row.name ?? row['称呼'] ?? row['姓名']).trim();
        if (!name) return null;
        const roleText = asString(row.role ?? row['定位']).toLowerCase();
        const role = ROLE_VALUES.includes(roleText as CharacterRole)
          ? (roleText as CharacterRole)
          : undefined;
        return {
          name,
          role,
          aliases: asStringArray(row.aliases ?? row['别称']),
          identity: asString(row.identity ?? row['身份']),
          personality: asString(row.personality ?? row['性格']),
          abilities: asString(row.abilities ?? row['能力体系']),
          foreshadowing: asString(row.foreshadowing ?? row['伏笔管理']),
          summary: asString(row.summary ?? row['简介']),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  const relations = record.relations ?? record['关系'];
  if (Array.isArray(relations)) {
    payload.relations = relations
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const from = asString(row.from ?? row['甲']).trim();
        const to = asString(row.to ?? row['乙']).trim();
        if (!from || !to) return null;
        const strength = Number(row.strength ?? row['亲疏强度']);
        return {
          from,
          to,
          label: asString(row.label ?? row['关系描述']),
          kind: asString(row.kind ?? row['关系类型']),
          strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : undefined,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  const encyclopedia = record.encyclopedia ?? record.wiki ?? record['百科'];
  if (Array.isArray(encyclopedia)) {
    payload.encyclopedia = encyclopedia
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const entryTitle = asString(row.title ?? row['条目名'] ?? row['名称']).trim();
        if (!entryTitle) return null;
        const categoryText = asString(row.category ?? row['分类']).toLowerCase();
        return {
          title: entryTitle,
          category: CATEGORY_VALUES.includes(categoryText as EncyclopediaCategory)
            ? (categoryText as EncyclopediaCategory)
            : undefined,
          tags: asStringArray(row.tags ?? row['标签']),
          summary: asString(row.summary ?? row['简介']),
          content: asString(row.content ?? row['正文']),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  const tags = record.tags ?? record['标签'];
  if (Array.isArray(tags)) payload.tags = asStringArray(tags);

  const postprocess = record.postprocess ?? record['后续处理'];
  if (Array.isArray(postprocess)) {
    payload.postprocess = postprocess
      .flatMap((item) => (typeof item === 'string' ? item.split('\n') : []))
      .map((line) => line.trim())
      .filter(Boolean);
  } else if (typeof postprocess === 'string') {
    payload.postprocess = postprocess
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const meaningful =
    payload.content !== undefined ||
    payload.title !== undefined ||
    payload.summary !== undefined ||
    (payload.postprocess?.length ?? 0) > 0;
  return meaningful ? payload : null;
}

export interface ParsedResponse {
  payload: AiChapterPayload;
  strategy: 'json' | 'fenced' | 'balanced' | 'plain';
}

/** 解析模型输出。任何情况下都会返回一个可用的 payload。 */
export function parseAiResponse(raw: string): ParsedResponse {  const text = (raw ?? '').trim();
  if (!text) return { payload: {}, strategy: 'plain' };

  const direct = coercePayload(tryParseJson(text));
  if (direct) return { payload: direct, strategy: 'json' };

  const fenced = tryParseJson(stripCodeFence(text));
  const fromFence = coercePayload(fenced);
  if (fromFence) return { payload: fromFence, strategy: 'fenced' };

  for (const candidate of extractBalancedObjects(text)) {
    const parsed = coercePayload(tryParseJson(candidate));
    if (parsed) return { payload: parsed, strategy: 'balanced' };
  }

  // 完全没有 JSON 时，把整段输出当作正文，保证不丢内容
  return {
    payload: {
      content: text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```$/, ''),
    },
    strategy: 'plain',
  };
}

function unescapeJsonString(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/**
 * 流式正文提取器。
 *
 * 模型按 JSON 输出，直接展示原始流会夹杂大量结构符号。这里在流的过程中
 * 定位 content 字段的字符串值，只把其中的正文增量交给界面，
 * 让长文生成过程可以实时显示。
 */
export function createContentExtractor(): (buffer: string) => string {
  let emitted = 0;
  return (buffer: string): string => {
    const keyIndex = buffer.indexOf('"content"');
    if (keyIndex < 0) return '';
    const colonIndex = buffer.indexOf(':', keyIndex + 9);
    if (colonIndex < 0) return '';
    let quoteIndex = colonIndex + 1;
    while (quoteIndex < buffer.length && /\s/.test(buffer[quoteIndex] as string)) quoteIndex += 1;
    if (buffer[quoteIndex] !== '"') return '';

    let index = quoteIndex + 1;
    let raw = '';
    let closed = false;
    while (index < buffer.length) {
      const char = buffer[index] as string;
      if (char === '\\') {
        const next = buffer[index + 1];
        if (next === undefined) break;
        raw += char + next;
        index += 2;
        continue;
      }
      if (char === '"') {
        closed = true;
        break;
      }
      raw += char;
      index += 1;
    }
    // 末尾可能停在一个不完整的转义序列上，先不输出
    const text = unescapeJsonString(raw);
    if (!closed && text.length <= emitted) return '';
    const delta = text.slice(emitted);
    emitted = text.length;
    return delta;
  };
}
