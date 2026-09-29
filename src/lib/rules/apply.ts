import {
  applyCharacterDrafts,
  applyRelationDrafts,
  relationsOf,
  removeCharacter,
  removeRelation,
  renameCharacter,
  upsertCharacter,
  upsertRelation,
} from '../store/characters';
import { applyEntryDrafts, removeEntry, upsertEntry } from '../store/encyclopedia';
import { updateChapter } from '../store/chapters';
import { setOutlineLine } from '../store/outline';
import { addTagToChapter, removeTagFromChapter } from '../store/tags';
import { recordChange } from '../store/changelog';
import type {
  AiChapterPayload,
  CharacterRole,
  DslExecutionResult,
  DslOperationResult,
  EncyclopediaCategory,
} from '../types';
import { describeArguments, parseDsl, stripCodeFence, type DslStatement, type DslValue } from './dsl';

/**
 * 后续处理执行器。
 *
 * 把解析后的语句映射为对小说数据的操作。所有写入都会经过仓库层，
 * 因此每条改动都会自动进入永久修改日志，可以还原。
 */

type WriteSource = 'ai' | 'user' | 'system';

function asString(value: DslValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => asString(item)).join('');
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${asString(item)}`)
    .join('\n');
}

function asNumber(value: DslValue | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asRecord(value: DslValue | undefined): Record<string, DslValue> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, DslValue>;
  }
  return {};
}

function asStringArray(value: DslValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => asString(item)).filter(Boolean);
  const single = asString(value);
  if (!single) return [];
  return single
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const ROLE_VALUES: CharacterRole[] = ['protagonist', 'major', 'supporting'];

function asRole(value: DslValue | undefined): CharacterRole | undefined {
  const text = asString(value);
  if ((ROLE_VALUES as string[]).includes(text)) return text as CharacterRole;
  if (text === '主角') return 'protagonist';
  if (text === '配角') return 'major';
  if (text === '次要角色') return 'supporting';
  return undefined;
}

const CATEGORY_VALUES: EncyclopediaCategory[] = [
  'place',
  'race',
  'creature',
  'item',
  'concept',
  'event',
  'other',
];

function asCategory(value: DslValue | undefined): EncyclopediaCategory | undefined {
  const text = asString(value);
  if ((CATEGORY_VALUES as string[]).includes(text)) return text as EncyclopediaCategory;
  const table: Record<string, EncyclopediaCategory> = {
    地名: 'place',
    地点: 'place',
    种族: 'race',
    动植物: 'creature',
    生物: 'creature',
    器物: 'item',
    物品: 'item',
    概念: 'concept',
    设定: 'concept',
    事件: 'event',
    其他: 'other',
  };
  return table[text];
}

function characterFrom(value: DslValue | undefined) {
  const record = asRecord(value);
  return {
    name: asString(record.name ?? record['称呼'] ?? record['姓名']),
    role: asRole(record.role ?? record['定位']),
    aliases: asStringArray(record.aliases ?? record['别称']),
    identity: asString(record.identity ?? record['身份']),
    personality: asString(record.personality ?? record['性格']),
    abilities: asString(record.abilities ?? record['能力体系'] ?? record['能力']),
    foreshadowing: asString(record.foreshadowing ?? record['伏笔管理'] ?? record['伏笔']),
    summary: asString(record.summary ?? record['简介']),
  };
}

function relationFrom(value: DslValue | undefined, fallbackFrom?: string, fallbackTo?: string) {
  const record = asRecord(value);
  return {
    from: asString(record.from ?? record['甲'] ?? record['角色']) || fallbackFrom || '',
    to: asString(record.to ?? record['乙'] ?? record['关联角色']) || fallbackTo || '',
    label: asString(record.label ?? record['关系描述'] ?? record['关系']) || undefined,
    kind: asString(record.kind ?? record['关系类型']) || undefined,
    strength: asNumber(record.strength ?? record['亲疏强度']),
  };
}

function entryFrom(value: DslValue | undefined) {
  const record = asRecord(value);
  return {
    title: asString(record.title ?? record['条目名'] ?? record['名称']),
    category: asCategory(record.category ?? record['分类']),
    tags: asStringArray(record.tags ?? record['标签']),
    summary: asString(record.summary ?? record['简介']),
    content: asString(record.content ?? record['正文']),
  };
}

/** 单条语句的执行。识别不了的目标与方法会返回失败结果，不影响其它语句。 */
function executeStatement(
  novelId: string,
  statement: DslStatement,
  source: WriteSource,
): DslOperationResult {
  const { target, method, args } = statement;
  const base = { target, method, source };
  const fail = (message: string): DslOperationResult => ({
    ok: false,
    ...base,
    description: `${target}.${method}(${describeArguments(args)})`,
    error: message,
  });
  const done = (description: string): DslOperationResult => ({
    ok: true,
    ...base,
    description,
  });

  try {
    switch (target) {
      case 'chara':
      case 'character': {
        if (method === 'add' || method === 'update' || method === 'upsert' || method === 'set') {
          const draft = characterFrom(args[0]);
          if (!draft.name) return fail('缺少角色称呼');
          const result = upsertCharacter(novelId, draft, source);
          return done(`${result.created ? '新增' : '更新'}角色 ${draft.name}`);
        }
        if (method === 'rename') {
          const from = asString(args[0]);
          const to = asString(args[1]);
          if (!from || !to) return fail('重命名需要原称呼与新称呼');
          renameCharacter(novelId, from, to);
          return done(`角色 ${from} 重命名为 ${to}`);
        }
        if (method === 'remove' || method === 'delete') {
          const name = asString(args[0] ?? asRecord(args[0]).name);
          if (!name) return fail('缺少角色称呼');
          removeCharacter(novelId, name, source);
          return done(`删除角色 ${name}`);
        }
        return fail(`不认识的方法 ${method}`);
      }
      case 'relation': {
        if (method === 'add' || method === 'update' || method === 'upsert' || method === 'set') {
          const draft = relationFrom(args[0], asString(args[1]), asString(args[2]));
          if (!draft.from || !draft.to) return fail('关系需要两个角色');
          upsertRelation(novelId, draft, source);
          return done(`关系 ${draft.from} → ${draft.to}`);
        }
        if (method === 'remove' || method === 'delete') {
          const draft = relationFrom(args[0], asString(args[1]), asString(args[2]));
          if (!draft.from || !draft.to) return fail('关系需要两个角色');
          removeRelation(novelId, draft.from, draft.to, source);
          return done(`删除关系 ${draft.from} → ${draft.to}`);
        }
        return fail(`不认识的方法 ${method}`);
      }
      case 'wiki':
      case 'encyclopedia': {
        if (method === 'add' || method === 'update' || method === 'upsert' || method === 'set') {
          const draft = entryFrom(args[0]);
          if (!draft.title) return fail('缺少条目名');
          const result = upsertEntry(novelId, draft, source);
          return done(`${result.created ? '新增' : '更新'}百科条目 ${draft.title}`);
        }
        if (method === 'remove' || method === 'delete') {
          const title = asString(args[0] ?? asRecord(args[0]).title);
          if (!title) return fail('缺少条目名');
          removeEntry(novelId, title, source);
          return done(`删除百科条目 ${title}`);
        }
        return fail(`不认识的方法 ${method}`);
      }
      case 'outline': {
        if (method === 'set' || method === 'update') {
          const indexNo = asNumber(args[0]);
          if (indexNo === undefined) return fail('需要章节序号');
          const content = asString(args[1]);
          setOutlineLine(novelId, indexNo, content, undefined, source);
          return done(`第 ${indexNo} 章大纲已更新`);
        }
        if (method === 'insert') {
          const indexNo = asNumber(args[0]);
          if (indexNo === undefined) return fail('需要章节序号');
          const content = asString(args[1]);
          setOutlineLine(novelId, indexNo, content, undefined, source);
          return done(`第 ${indexNo} 章大纲已写入`);
        }
        return fail(`不认识的方法 ${method}`);
      }
      case 'tag': {
        const ref = asString(args[0]);
        const name = asString(args[1] ?? asRecord(args[1]).name);
        if (!ref || !name) return fail('需要章节引用与标签名');
        if (method === 'add') {
          addTagToChapter(novelId, ref, name, source);
          return done(`为 ${ref} 添加标签 ${name}`);
        }
        if (method === 'remove' || method === 'delete') {
          removeTagFromChapter(novelId, ref, name);
          return done(`移除 ${ref} 的标签 ${name}`);
        }
        return fail(`不认识的方法 ${method}`);
      }
      case 'summary': {
        if (method === 'set' || method === 'update') {
          const ref = asString(args[0]);
          const text = asString(args[1]);
          if (!ref) return fail('需要章节引用');
          updateChapter(novelId, ref, { summary: text });
          return done(`更新 ${ref} 的章节摘要`);
        }
        return fail(`不认识的方法 ${method}`);
      }
      case 'log': {
        if (method === 'note' || method === 'add') {
          const text = asString(args[0]);
          recordChange({
            novelId,
            target: 'note',
            targetId: '',
            action: 'create',
            after: text,
            source,
            note: text.slice(0, 200),
          });
          return done(`记录说明：${text.slice(0, 60)}`);
        }
        return fail(`不认识的方法 ${method}`);
      }
      default:
        return fail(`不认识的对象 ${target}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** 执行一段后续处理脚本，逐条返回结果。 */
export function executeDsl(novelId: string, script: string, source: WriteSource = 'ai'): DslExecutionResult {
  const cleaned = stripCodeFence(script);
  if (!cleaned.trim()) return { results: [], applied: 0, failed: 0 };
  let statements: DslStatement[];
  try {
    statements = parseDsl(cleaned);
  } catch (error) {
    return {
      results: [
        {
          ok: false,
          target: 'parse',
          method: 'parse',
          description: cleaned.slice(0, 120),
          error: error instanceof Error ? error.message : String(error),
        },
      ],
      applied: 0,
      failed: 1,
    };
  }
  const results = statements.map((statement) => executeStatement(novelId, statement, source));
  return {
    results,
    applied: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
  };
}

/**
 * 把 AI 返回的固定 JSON 结果落到小说数据里。
 * 先写结构化字段，再执行 postprocess 脚本，保证两条路径都能被日志记录。
 */
export function applyPayload(
  novelId: string,
  payload: AiChapterPayload,
  ref: string,
  source: WriteSource = 'ai',
): DslExecutionResult {
  const results: DslOperationResult[] = [];

  if (payload.characters && payload.characters.length > 0) {
    for (const name of applyCharacterDrafts(novelId, payload.characters, source)) {
      results.push({
        ok: true,
        target: 'chara',
        method: 'add',
        description: `补充角色 ${name}`,
      });
    }
  }

  if (payload.relations && payload.relations.length > 0) {
    for (const name of applyRelationDrafts(novelId, payload.relations, source)) {
      results.push({
        ok: true,
        target: 'relation',
        method: 'add',
        description: `补充关系 ${name}`,
      });
    }
  }

  if (payload.encyclopedia && payload.encyclopedia.length > 0) {
    for (const title of applyEntryDrafts(novelId, payload.encyclopedia, source)) {
      results.push({
        ok: true,
        target: 'wiki',
        method: 'add',
        description: `补充百科 ${title}`,
      });
    }
  }

  if (payload.tags && payload.tags.length > 0) {
    for (const tag of payload.tags.slice(0, 12)) {
      if (!tag?.trim()) continue;
      addTagToChapter(novelId, ref, tag.trim(), source);
      results.push({
        ok: true,
        target: 'tag',
        method: 'add',
        description: `添加标签 ${tag.trim()}`,
      });
    }
  }

  if (payload.postprocess && payload.postprocess.length > 0) {
    const script = payload.postprocess.join('\n');
    results.push(...executeDsl(novelId, script, source).results);
  }

  return {
    results,
    applied: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
  };
}

export { relationsOf };
