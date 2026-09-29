import fs from 'node:fs';
import path from 'node:path';

import { getDb, nowIso, toBool } from '../db';
import { safeFileName, settingDir } from '../paths';
import type {
  BaseRule,
  BaseRuleKind,
  IndependentRule,
  RuleBinding,
  RuleCategory,
  RuleChecklist,
} from '../types';
import { DEFAULT_BASE_RULES } from '../rules/templates';
import { recordChange } from './changelog';
import { removeFile, writeText } from './files';
import { listCharacters, listRelations } from './characters';

/**
 * 规则仓库。
 *
 * 基础规则全局生效，保存在数据库里，用户可以在设置中改写并恢复默认。
 * 独立规则每部小说一套，正文写在 novel/{novelId}/setting/{标题}.md。
 * 规则绑定决定某条规则在排序清单里的分组、顺序与是否发送。
 */

const CATEGORIES: RuleCategory[] = ['system', 'user', 'assistant'];

export function isRuleCategory(value: unknown): value is RuleCategory {
  return typeof value === 'string' && (CATEGORIES as string[]).includes(value);
}

/* --------------------------------- 基础规则 --------------------------------- */

interface BaseRuleRow {
  id: number;
  slot: string;
  title: string;
  kind: string;
  content: string;
  description: string;
  is_builtin: number;
  sort_order: number;
  updated_at: string;
}

function mapBaseRule(row: BaseRuleRow): BaseRule {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as BaseRuleKind,
    content: row.content,
    description: row.description,
    isBuiltin: toBool(row.is_builtin),
    updatedAt: row.updated_at,
  };
}

export function listBaseRules(): (BaseRule & { slot: string })[] {
  const rows = getDb()
    .prepare(`SELECT * FROM base_rules ORDER BY sort_order, id`)
    .all() as BaseRuleRow[];
  return rows.map((row) => ({ ...mapBaseRule(row), slot: row.slot }));
}

export function getBaseRule(slot: string): (BaseRule & { slot: string }) | null {
  const row = getDb().prepare(`SELECT * FROM base_rules WHERE slot = ?`).get(slot) as
    | BaseRuleRow
    | undefined;
  return row ? { ...mapBaseRule(row), slot: row.slot } : null;
}

export function updateBaseRule(slot: string, content: string): void {
  getDb()
    .prepare(`UPDATE base_rules SET content = ?, updated_at = ? WHERE slot = ?`)
    .run(content, nowIso(), slot);
}

export function resetBaseRules(): void {
  const db = getDb();
  const statement = db.prepare(
    `UPDATE base_rules SET content = @content, title = @title, kind = @kind, description = @description, updated_at = @updatedAt WHERE slot = @slot`,
  );
  db.transaction(() => {
    for (const seed of DEFAULT_BASE_RULES) {
      statement.run({ ...seed, updatedAt: nowIso() });
    }
  })();
}

/** 把基础规则插回缺失的槽位，用于旧数据升级。 */
export function ensureBaseRules(): void {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO base_rules (slot, title, kind, content, description, is_builtin, sort_order, updated_at)
     VALUES (@slot, @title, @kind, @content, @description, 1, @sortOrder, @updatedAt)
     ON CONFLICT(slot) DO NOTHING`,
  );
  db.transaction(() => {
    DEFAULT_BASE_RULES.forEach((seed, index) => {
      statement.run({ ...seed, sortOrder: index, updatedAt: nowIso() });
    });
  })();
}

/* --------------------------------- 独立规则 --------------------------------- */

interface IndependentRow {
  id: number;
  novel_id: string;
  title: string;
  file: string;
  category: string;
  sort_order: number;
  enabled: number;
  updated_at: string;
}

function ruleFilePath(novelId: string, title: string, excludeId?: number): string {
  const dir = settingDir(novelId);
  const base = safeFileName(title, 'rule');
  let candidate = path.join(dir, `${base}.md`);
  const db = getDb();
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    const owner = db
      .prepare(`SELECT id FROM independent_rules WHERE novel_id = ? AND file = ?`)
      .get(novelId, candidate) as { id: number } | undefined;
    if (!owner || owner.id === excludeId) break;
    candidate = path.join(dir, `${base}-${suffix}.md`);
    suffix += 1;
  }
  return candidate;
}

function mapIndependent(row: IndependentRow): IndependentRule {
  let content = '';
  try {
    content = fs.readFileSync(row.file, 'utf8');
  } catch {
    content = '';
  }
  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    file: row.file,
    content,
    category: row.category as RuleCategory,
    sortOrder: row.sort_order,
    enabled: toBool(row.enabled),
    chars: content.replace(/\s+/g, '').length,
    updatedAt: row.updated_at,
  };
}

export function listIndependentRules(novelId: string): IndependentRule[] {
  const rows = getDb()
    .prepare(`SELECT * FROM independent_rules WHERE novel_id = ? ORDER BY sort_order, id`)
    .all(novelId) as IndependentRow[];
  return rows.map(mapIndependent);
}

export function getIndependentRule(novelId: string, id: number): IndependentRule | null {
  const row = getDb()
    .prepare(`SELECT * FROM independent_rules WHERE novel_id = ? AND id = ?`)
    .get(novelId, id) as IndependentRow | undefined;
  return row ? mapIndependent(row) : null;
}

export interface IndependentRuleInput {
  id?: number;
  title: string;
  content: string;
  category?: RuleCategory;
}

export function saveIndependentRule(novelId: string, input: IndependentRuleInput): IndependentRule {
  const title = input.title.trim();
  if (!title) throw new Error('规则标题不能为空');
  const db = getDb();
  const stamp = nowIso();
  if (input.id) {
    const existing = getIndependentRule(novelId, input.id);
    if (!existing) throw new Error('规则不存在');
    let file = existing.file;
    if (title !== existing.title) {
      const next = ruleFilePath(novelId, title, input.id);
      if (fs.existsSync(existing.file)) fs.renameSync(existing.file, next);
      file = next;
    }
    writeText(file, input.content);
    db.prepare(
      `UPDATE independent_rules SET title = @title, file = @file, category = @category, updated_at = @stamp WHERE id = @id`,
    ).run({
      id: input.id,
      title,
      file,
      category: input.category ?? existing.category,
      stamp,
    });
    recordChange({
      novelId,
      target: 'rule',
      targetId: String(input.id),
      action: 'update',
      before: { title: existing.title, content: existing.content },
      after: { title, content: input.content },
      source: 'user',
      note: `更新独立规则 ${title}`,
    });
    ensureBindings(novelId);
    return getIndependentRule(novelId, input.id) as IndependentRule;
  }
  const orderRow = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM independent_rules WHERE novel_id = ?`)
    .get(novelId) as { maxOrder: number };
  const info = db
    .prepare(
      `INSERT INTO independent_rules (novel_id, title, file, category, sort_order, enabled, updated_at)
       VALUES (@novelId, @title, @file, @category, @sortOrder, 1, @stamp)`,
    )
    .run({
      novelId,
      title,
      file: '',
      category: input.category ?? 'user',
      sortOrder: orderRow.maxOrder + 1,
      stamp,
    });
  const id = Number(info.lastInsertRowid);
  const file = ruleFilePath(novelId, title, id);
  writeText(file, input.content);
  db.prepare(`UPDATE independent_rules SET file = ? WHERE id = ?`).run(file, id);
  recordChange({
    novelId,
    target: 'rule',
    targetId: String(id),
    action: 'create',
    after: { title, content: input.content },
    source: 'user',
    note: `新增独立规则 ${title}`,
  });
  ensureBindings(novelId);
  return getIndependentRule(novelId, id) as IndependentRule;
}

export function deleteIndependentRule(novelId: string, id: number): void {
  const existing = getIndependentRule(novelId, id);
  if (!existing) return;
  const db = getDb();
  db.prepare(`DELETE FROM independent_rules WHERE novel_id = ? AND id = ?`).run(novelId, id);
  db.prepare(`DELETE FROM rule_bindings WHERE novel_id = ? AND kind = 'independent' AND ref_id = ?`).run(
    novelId,
    id,
  );
  removeFile(existing.file);
  recordChange({
    novelId,
    target: 'rule',
    targetId: String(id),
    action: 'delete',
    before: { title: existing.title, content: existing.content },
    source: 'user',
    note: `删除独立规则 ${existing.title}`,
  });
}

/* --------------------------------- 规则绑定 --------------------------------- */

interface BindingRow {
  id: number;
  novel_id: string;
  kind: string;
  ref_id: number;
  category: string;
  sort_order: number;
  enabled: number;
}

function mapBinding(row: BindingRow, novelId: string): RuleBinding | null {
  if (row.kind === 'base') {
    const base = listBaseRules().find((rule) => rule.id === row.ref_id);
    if (!base) return null;
    return {
      id: row.id,
      novelId,
      kind: 'base',
      refId: row.ref_id,
      title: base.title,
      preview: base.content,
      category: row.category as RuleCategory,
      sortOrder: row.sort_order,
      enabled: toBool(row.enabled),
      chars: base.content.replace(/\s+/g, '').length,
    };
  }
  const rule = getIndependentRule(novelId, row.ref_id);
  if (!rule) return null;
  return {
    id: row.id,
    novelId,
    kind: 'independent',
    refId: row.ref_id,
    title: rule.title,
    preview: rule.content,
    category: row.category as RuleCategory,
    sortOrder: row.sort_order,
    enabled: toBool(row.enabled),
    chars: rule.chars,
  };
}

/**
 * 为新出现的基础规则与独立规则补上绑定。
 * 基础规则默认放进 system，其中体积较大的注入项默认不勾选；
 * 独立规则按自身分类放置。
 */
export function ensureBindings(novelId: string): void {
  const db = getDb();
  const baseRules = listBaseRules();
  const independents = listIndependentRules(novelId);
  const existing = db
    .prepare(`SELECT kind, ref_id FROM rule_bindings WHERE novel_id = ?`)
    .all(novelId) as { kind: string; ref_id: number }[];
  const known = new Set(existing.map((row) => `${row.kind}:${row.ref_id}`));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO rule_bindings (novel_id, kind, ref_id, category, sort_order, enabled)
     VALUES (@novelId, @kind, @refId, @category, @sortOrder, @enabled)`,
  );
  db.transaction(() => {
    baseRules.forEach((rule, index) => {
      if (known.has(`base:${rule.id}`)) return;
      const seed = DEFAULT_BASE_RULES.find((item) => item.slot === rule.slot);
      insert.run({
        novelId,
        kind: 'base',
        refId: rule.id,
        category: 'system',
        sortOrder: index,
        enabled: seed?.enabledByDefault === false ? 0 : 1,
      });
    });
    const offset = baseRules.length;
    independents.forEach((rule, index) => {
      if (known.has(`independent:${rule.id}`)) return;
      insert.run({
        novelId,
        kind: 'independent',
        refId: rule.id,
        category: rule.category,
        sortOrder: offset + index,
        enabled: rule.enabled ? 1 : 0,
      });
    });
    // 清掉指向已删除规则的绑定
    db.prepare(
      `DELETE FROM rule_bindings WHERE novel_id = ? AND kind = 'independent'
        AND ref_id NOT IN (SELECT id FROM independent_rules WHERE novel_id = ?)`,
    ).run(novelId, novelId);
    db.prepare(
      `DELETE FROM rule_bindings WHERE novel_id = ? AND kind = 'base'
        AND ref_id NOT IN (SELECT id FROM base_rules)`,
    ).run(novelId);
  })();
}

export function listChecklist(novelId: string): RuleChecklist {
  ensureBindings(novelId);
  const rows = getDb()
    .prepare(`SELECT * FROM rule_bindings WHERE novel_id = ? ORDER BY sort_order, id`)
    .all(novelId) as BindingRow[];
  const checklist: RuleChecklist = { system: [], user: [], assistant: [] };
  for (const row of rows) {
    const binding = mapBinding(row, novelId);
    if (!binding) continue;
    checklist[binding.category].push(binding);
  }
  return checklist;
}

export interface BindingUpdate {
  id: number;
  category: RuleCategory;
  sortOrder: number;
  enabled?: boolean;
}

/** 一次性写回排序结果。整表按分组重排，避免出现并列序号。 */
export function reorderBindings(novelId: string, updates: BindingUpdate[]): RuleChecklist {
  const db = getDb();
  const statement = db.prepare(
    `UPDATE rule_bindings SET category = @category, sort_order = @sortOrder, enabled = @enabled
     WHERE id = @id AND novel_id = @novelId`,
  );
  db.transaction(() => {
    for (const update of updates) {
      const current = db
        .prepare(`SELECT enabled FROM rule_bindings WHERE id = ? AND novel_id = ?`)
        .get(update.id, novelId) as { enabled: number } | undefined;
      if (!current) continue;
      statement.run({
        id: update.id,
        novelId,
        category: update.category,
        sortOrder: update.sortOrder,
        enabled: update.enabled === undefined ? current.enabled : update.enabled ? 1 : 0,
      });
    }
  })();
  return listChecklist(novelId);
}

export function toggleBinding(novelId: string, id: number, enabled: boolean): RuleChecklist {
  getDb()
    .prepare(`UPDATE rule_bindings SET enabled = ? WHERE novel_id = ? AND id = ?`)
    .run(enabled ? 1 : 0, novelId, id);
  return listChecklist(novelId);
}

/** 勾选且内容非空的规则，按分组与顺序返回。基础规则同样受勾选控制。 */
export function activeRules(novelId: string): RuleChecklist {
  const checklist = listChecklist(novelId);
  const filter = (items: RuleBinding[]) =>
    items
      .filter((item) => item.enabled && item.preview.trim() !== '')
      .sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    system: filter(checklist.system),
    user: filter(checklist.user),
    assistant: filter(checklist.assistant),
  };
}

/**
 * 独立规则发给 AI 时统一使用「## 标题 + 空行 + 正文 + 空行」的格式。
 * 正文为空的规则不发送。
 */
export function renderIndependentRules(novelId: string, category?: RuleCategory): string {
  const rules = listIndependentRules(novelId).filter((rule) => rule.content.trim() !== '');
  const checklist = listChecklist(novelId);
  const bindingOf = new Map<number, RuleBinding>();
  for (const list of [checklist.system, checklist.user, checklist.assistant]) {
    for (const binding of list) {
      if (binding.kind === 'independent') bindingOf.set(binding.refId, binding);
    }
  }
  const selected = rules
    .map((rule) => ({ rule, binding: bindingOf.get(rule.id) }))
    .filter((item) => item.binding?.enabled)
    .filter((item) => (category ? item.binding?.category === category : true))
    .sort((a, b) => (a.binding?.sortOrder ?? 0) - (b.binding?.sortOrder ?? 0));
  return selected
    .map((item) => `## ${item.rule.title}\n\n${item.rule.content.trim()}`)
    .join('\n\n');
}

/** 角色图鉴的文本片段，供上下文注入与标签预览使用。 */
export function characterSheetText(novelId: string, limit = 24): string {
  const characters = listCharacters(novelId).slice(0, limit);
  if (characters.length === 0) return '';
  return characters
    .map((character) => {
      const parts = [`### ${character.name}`];
      if (character.identity) parts.push(`身份：${character.identity}`);
      if (character.personality) parts.push(`性格：${character.personality}`);
      if (character.abilities) parts.push(`能力：${character.abilities}`);
      if (character.foreshadowing) parts.push(`伏笔：${character.foreshadowing}`);
      if (character.summary) parts.push(`简介：${character.summary}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

export function relationSheetText(novelId: string): string {
  const relations = listRelations(novelId);
  if (relations.length === 0) return '';
  return relations
    .map((relation) => `- ${relation.from} → ${relation.to}：${relation.label || relation.kind || '关联'}`)
    .join('\n');
}

export const RULE_CATEGORIES = CATEGORIES;
