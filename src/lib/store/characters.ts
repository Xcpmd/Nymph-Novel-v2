import { charaFile } from '../paths';
import { getDb, nowIso } from '../db';
import type { AiCharacterDraft, Character, CharacterRole, Relation } from '../types';
import { recordChange } from './changelog';
import { removeFile, writeText } from './files';

/**
 * 角色图鉴与角色关系网。
 *
 * 结构化字段以数据库为准，同时在 novel/{novelId}/data/chara/{称呼}.md 生成一份
 * 人类可读的词条文件，界面里可以直接查看与编辑。
 * 龙套角色不进入图鉴，添加时会做拦截。
 */

interface CharacterRow {
  id: number;
  novel_id: string;
  name: string;
  role: string;
  aliases: string;
  identity: string;
  personality: string;
  abilities: string;
  foreshadowing: string;
  summary: string;
  file: string;
  position_x: number;
  position_y: number;
  created_at: string;
  updated_at: string;
}

function splitList(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    novelId: row.novel_id,
    name: row.name,
    role: row.role as CharacterRole,
    aliases: splitList(row.aliases),
    identity: row.identity,
    personality: row.personality,
    abilities: row.abilities,
    foreshadowing: row.foreshadowing,
    summary: row.summary,
    file: row.file,
    positionX: row.position_x,
    positionY: row.position_y,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 生成角色词条的 Markdown 文本。 */
export function renderCharacterMarkdown(character: Character, relations: Relation[]): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`name: ${character.name}`);
  lines.push(`role: ${character.role}`);
  if (character.aliases.length > 0) lines.push(`aliases: ${character.aliases.join(', ')}`);
  lines.push(`updated: ${character.updatedAt}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${character.name}`);
  lines.push('');
  if (character.summary) {
    lines.push(`> ${character.summary}`);
    lines.push('');
  }
  const section = (title: string, body: string) => {
    if (!body.trim()) return;
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(body.trim());
    lines.push('');
  };
  section('身份', character.identity);
  section('性格', character.personality);
  section('能力体系', character.abilities);
  section('伏笔管理', character.foreshadowing);
  if (relations.length > 0) {
    lines.push('## 关系');
    lines.push('');
    for (const relation of relations) {
      const target = relation.from === character.name ? relation.to : relation.from;
      lines.push(`- ${target}：${relation.label || relation.kind || '关联'}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function listCharacters(novelId: string): Character[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM characters WHERE novel_id = ?
       ORDER BY CASE role WHEN 'protagonist' THEN 0 WHEN 'major' THEN 1 ELSE 2 END, id`,
    )
    .all(novelId) as CharacterRow[];
  return rows.map(mapCharacter);
}

export function getCharacter(novelId: string, name: string): Character | null {
  const row = getDb()
    .prepare(`SELECT * FROM characters WHERE novel_id = ? AND name = ?`)
    .get(novelId, name) as CharacterRow | undefined;
  return row ? mapCharacter(row) : null;
}

export function getCharacterById(novelId: string, id: number): Character | null {
  const row = getDb()
    .prepare(`SELECT * FROM characters WHERE novel_id = ? AND id = ?`)
    .get(novelId, id) as CharacterRow | undefined;
  return row ? mapCharacter(row) : null;
}

export function listRelations(novelId: string): Relation[] {
  const rows = getDb()
    .prepare(`SELECT * FROM relations WHERE novel_id = ? ORDER BY id`)
    .all(novelId) as {
    id: number;
    novel_id: string;
    from_name: string;
    to_name: string;
    label: string;
    kind: string;
    strength: number;
    created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    novelId: row.novel_id,
    from: row.from_name,
    to: row.to_name,
    label: row.label,
    kind: row.kind,
    strength: row.strength,
    createdAt: row.created_at,
  }));
}

export function relationsOf(novelId: string, name: string): Relation[] {
  return listRelations(novelId).filter((relation) => relation.from === name || relation.to === name);
}

export interface CharacterInput {
  name: string;
  role?: CharacterRole;
  aliases?: string[];
  identity?: string;
  personality?: string;
  abilities?: string;
  foreshadowing?: string;
  summary?: string;
}

export function upsertCharacter(
  novelId: string,
  input: CharacterInput,
  source: 'ai' | 'user' | 'system' = 'user',
): { character: Character; created: boolean } {
  const name = input.name.trim();
  if (!name) throw new Error('角色称呼不能为空');
  const existing = getCharacter(novelId, name);
  const stamp = nowIso();
  if (!existing) {
    const file = charaFile(novelId, name);
    getDb()
      .prepare(
        `INSERT INTO characters (novel_id, name, role, aliases, identity, personality, abilities, foreshadowing, summary, file, created_at, updated_at)
         VALUES (@novelId, @name, @role, @aliases, @identity, @personality, @abilities, @foreshadowing, @summary, @file, @stamp, @stamp)`,
      )
      .run({
        novelId,
        name,
        role: input.role ?? 'supporting',
        aliases: (input.aliases ?? []).join(', '),
        identity: input.identity ?? '',
        personality: input.personality ?? '',
        abilities: input.abilities ?? '',
        foreshadowing: input.foreshadowing ?? '',
        summary: input.summary ?? '',
        file,
        stamp,
      });
    const created = getCharacter(novelId, name) as Character;
    writeCharacterFile(novelId, created);
    recordChange({
      novelId,
      target: 'character',
      targetId: name,
      action: 'create',
      after: created,
      source,
      note: `新增角色 ${name}`,
    });
    return { character: created, created: true };
  }
  const merged: CharacterInput = {
    name,
    role: input.role ?? existing.role,
    // 别称做并集，避免 AI 覆盖掉用户手工补充的称呼
    aliases: unique([...existing.aliases, ...(input.aliases ?? [])]),
    identity: input.identity ?? existing.identity,
    personality: input.personality ?? existing.personality,
    abilities: input.abilities ?? existing.abilities,
    foreshadowing: input.foreshadowing ?? existing.foreshadowing,
    summary: input.summary ?? existing.summary,
  };
  getDb()
    .prepare(
      `UPDATE characters SET role = @role, aliases = @aliases, identity = @identity,
        personality = @personality, abilities = @abilities, foreshadowing = @foreshadowing,
        summary = @summary, updated_at = @stamp
       WHERE novel_id = @novelId AND name = @name`,
    )
    .run({
      novelId,
      name,
      role: merged.role,
      aliases: (merged.aliases ?? []).join(', '),
      identity: merged.identity,
      personality: merged.personality,
      abilities: merged.abilities,
      foreshadowing: merged.foreshadowing,
      summary: merged.summary,
      stamp,
    });
  const updated = getCharacter(novelId, name) as Character;
  writeCharacterFile(novelId, updated);
  recordChange({
    novelId,
    target: 'character',
    targetId: name,
    action: 'update',
    before: existing,
    after: updated,
    source,
    note: `更新角色 ${name}`,
  });
  return { character: updated, created: false };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

/** 把词条写回 Markdown 文件。 */
export function writeCharacterFile(novelId: string, character: Character): void {
  const relations = relationsOf(novelId, character.name);
  writeText(charaFile(novelId, character.name), renderCharacterMarkdown(character, relations));
}

export function renameCharacter(novelId: string, from: string, to: string): void {
  const existing = getCharacter(novelId, from);
  if (!existing) throw new Error('角色不存在');
  const target = to.trim();
  if (!target) throw new Error('角色称呼不能为空');
  if (getCharacter(novelId, target)) throw new Error('同名条目已存在');
  const db = getDb();
  db.prepare(`UPDATE characters SET name = ?, file = ?, updated_at = ? WHERE novel_id = ? AND name = ?`).run(
    target,
    charaFile(novelId, target),
    nowIso(),
    novelId,
    from,
  );
  db.prepare(`UPDATE relations SET from_name = ? WHERE novel_id = ? AND from_name = ?`).run(target, novelId, from);
  db.prepare(`UPDATE relations SET to_name = ? WHERE novel_id = ? AND to_name = ?`).run(target, novelId, from);
  removeFile(charaFile(novelId, from));
  const renamed = getCharacter(novelId, target) as Character;
  writeCharacterFile(novelId, renamed);
  recordChange({
    novelId,
    target: 'character',
    targetId: target,
    action: 'update',
    before: { name: from },
    after: { name: target },
    source: 'user',
    note: '重命名角色',
  });
}

export function removeCharacter(novelId: string, name: string, source: 'ai' | 'user' | 'system' = 'user'): void {
  const existing = getCharacter(novelId, name);
  if (!existing) return;
  getDb().prepare(`DELETE FROM characters WHERE novel_id = ? AND name = ?`).run(novelId, name);
  getDb()
    .prepare(`DELETE FROM relations WHERE novel_id = ? AND (from_name = ? OR to_name = ?)`)
    .run(novelId, name, name);
  removeFile(charaFile(novelId, name));
  recordChange({
    novelId,
    target: 'character',
    targetId: name,
    action: 'delete',
    before: existing,
    source,
    note: `删除角色 ${name}`,
  });
}

export function updateCharacterPosition(novelId: string, id: number, x: number, y: number): void {
  getDb()
    .prepare(`UPDATE characters SET position_x = ?, position_y = ? WHERE novel_id = ? AND id = ?`)
    .run(x, y, novelId, id);
}

export interface RelationInput {
  from: string;
  to: string;
  label?: string;
  kind?: string;
  strength?: number;
}

export function upsertRelation(
  novelId: string,
  input: RelationInput,
  source: 'ai' | 'user' | 'system' = 'user',
): Relation {
  const from = input.from.trim();
  const to = input.to.trim();
  if (!from || !to) throw new Error('关系的两端都不能为空');
  if (from === to) throw new Error('不能与自身建立关系');
  const existing = getDb()
    .prepare(`SELECT * FROM relations WHERE novel_id = ? AND from_name = ? AND to_name = ?`)
    .get(novelId, from, to) as
    | {
        id: number;
        label: string;
        kind: string;
        strength: number;
      }
    | undefined;
  if (existing) {
    getDb()
      .prepare(`UPDATE relations SET label = @label, kind = @kind, strength = @strength WHERE id = @id`)
      .run({
        id: existing.id,
        label: input.label ?? existing.label,
        kind: input.kind ?? existing.kind,
        strength: input.strength ?? existing.strength,
      });
  } else {
    getDb()
      .prepare(
        `INSERT INTO relations (novel_id, from_name, to_name, label, kind, strength, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(novelId, from, to, input.label ?? '', input.kind ?? '', input.strength ?? 1, nowIso());
  }
  const relation = listRelations(novelId).find((item) => item.from === from && item.to === to) as Relation;
  recordChange({
    novelId,
    target: 'relation',
    targetId: `${from}->${to}`,
    action: existing ? 'update' : 'create',
    before: existing ?? null,
    after: relation,
    source,
    note: `角色关系 ${from} → ${to}`,
  });
  refreshCharacterFiles(novelId, [from, to]);
  return relation;
}

export function removeRelation(
  novelId: string,
  from: string,
  to: string,
  source: 'ai' | 'user' | 'system' = 'user',
): void {
  const existing = listRelations(novelId).find((item) => item.from === from && item.to === to);
  if (!existing) return;
  getDb()
    .prepare(`DELETE FROM relations WHERE novel_id = ? AND from_name = ? AND to_name = ?`)
    .run(novelId, from, to);
  recordChange({
    novelId,
    target: 'relation',
    targetId: `${from}->${to}`,
    action: 'delete',
    before: existing,
    source,
    note: `删除角色关系 ${from} → ${to}`,
  });
  refreshCharacterFiles(novelId, [from, to]);
}

function refreshCharacterFiles(novelId: string, names: string[]): void {
  for (const name of unique(names)) {
    const character = getCharacter(novelId, name);
    if (character) writeCharacterFile(novelId, character);
  }
}

/**
 * 把 AI 返回的角色草稿写入图鉴。
 * 龙套角色由提示词约束不写入，这里额外做一次数量保护，避免一次性灌入大量无名角色。
 */
export function applyCharacterDrafts(
  novelId: string,
  drafts: AiCharacterDraft[],
  source: 'ai' | 'user' | 'system' = 'ai',
): string[] {
  const touched: string[] = [];
  for (const draft of drafts.slice(0, 12)) {
    if (!draft?.name?.trim()) continue;
    upsertCharacter(novelId, draft, source);
    touched.push(draft.name.trim());
  }
  return touched;
}

export function applyRelationDrafts(
  novelId: string,
  drafts: { from: string; to: string; label?: string; kind?: string; strength?: number }[],
  source: 'ai' | 'user' | 'system' = 'ai',
): string[] {
  const touched: string[] = [];
  for (const draft of drafts.slice(0, 40)) {
    if (!draft?.from || !draft?.to) continue;
    upsertRelation(novelId, draft, source);
    touched.push(`${draft.from}→${draft.to}`);
  }
  return touched;
}

export function countCharacters(novelId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM characters WHERE novel_id = ?`)
    .get(novelId) as { n: number };
  return row.n;
}
