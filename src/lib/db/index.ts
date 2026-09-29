import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';

import { dataRoot, dbFile, novelRoot, exportDir, workspaceDir } from '../paths';
import { DEFAULT_BASE_RULES } from '../rules/templates';
import { DDL_STATEMENTS, FTS_DDL, SCHEMA_VERSION } from './schema';

/**
 * 数据库连接与初始化。
 *
 * 单例挂在 globalThis 上，避免 Next.js 开发模式热更新时重复打开连接。
 * 初始化过程是幂等的：建表、登记结构版本、写入默认基础规则。
 */

export type Db = SqliteDatabase;

interface GlobalWithDb {
  __nymphDb?: Db;
  __nymphFts?: boolean;
}

const globalRef = globalThis as unknown as GlobalWithDb;

export function nowIso(): string {
  return new Date().toISOString();
}

function prepareFts(db: Db): boolean {
  const existing = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chapter_fts'`)
    .get();
  if (existing) return true;
  for (const candidate of FTS_DDL) {
    try {
      db.exec(candidate.sql);
      return true;
    } catch {
      // 分词器不可用时继续尝试下一种
    }
  }
  return false;
}

function seedBaseRules(db: Db): void {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM base_rules`).get() as { n: number };
  if (count.n > 0) return;
  const insert = db.prepare(
    `INSERT INTO base_rules (slot, title, kind, content, description, is_builtin, sort_order, updated_at)
     VALUES (@slot, @title, @kind, @content, @description, 1, @sortOrder, @updatedAt)`,
  );
  const stamp = nowIso();
  const tx = db.transaction(() => {
    DEFAULT_BASE_RULES.forEach((rule, index) => {
      insert.run({ ...rule, sortOrder: index, updatedAt: stamp });
    });
  });
  tx();
}

function seedSettings(db: Db): void {
  const insert = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  const defaults: [string, string][] = [
    ['defaultProviderId', ''],
    ['locale', 'zh'],
    ['scene', 'chapter'],
    ['tokenBudget', '60000'],
    ['contextStrategy', 'balanced'],
    ['dialogueHighlight', '1'],
    ['fontSize', '18'],
    ['lineHeight', '1.9'],
    ['autoSave', '1'],
  ];
  const tx = db.transaction(() => {
    for (const [key, value] of defaults) insert.run(key, value);
  });
  tx();
}

/**
 * 给已经存在的表补列。
 * 建表语句只在首次创建时生效，老库需要在这里逐列补齐，保证升级不丢数据。
 */
function ensureColumn(db: Db, table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function migrate(db: Db): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const statement of DDL_STATEMENTS) db.exec(statement);
  ensureColumn(db, 'providers', 'protocol', `protocol TEXT NOT NULL DEFAULT 'openai'`);
  ensureColumn(db, 'providers', 'thinking', `thinking INTEGER NOT NULL DEFAULT 0`);
  ensureColumn(db, 'providers', 'batch_support', `batch_support TEXT NOT NULL DEFAULT 'auto'`);
  const fts = prepareFts(db);
  globalRef.__nymphFts = fts;
  seedBaseRules(db);
  seedSettings(db);
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schemaVersion', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCHEMA_VERSION));
}

export function getDb(): Db {
  if (globalRef.__nymphDb) return globalRef.__nymphDb;
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(novelRoot, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(exportDir, { recursive: true });
  const db = new Database(dbFile);
  migrate(db);
  globalRef.__nymphDb = db;
  return db;
}

/** 本机 SQLite 是否支持全文检索表。 */
export function isFtsEnabled(): boolean {
  getDb();
  return globalRef.__nymphFts === true;
}

/** 把数据库中的行映射成对象，同时把整数型布尔还原为布尔值。 */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

export function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** 简易事务包装，供多处复用。 */
export function transact<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

export function dataFileExists(relative: string): boolean {
  return fs.existsSync(path.join(projectRootSafe(), relative));
}

function projectRootSafe(): string {
  return path.dirname(dataRoot);
}
