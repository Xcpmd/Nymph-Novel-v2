/**
 * 数据库结构定义。
 *
 * 数据库只保存结构化与半结构化数据：元数据、配置、加密后的 API Key 与检索索引。
 * 正文、设定、角色词条、百科章节的正文内容保存在 Markdown 文件里，
 * 数据库里只保留它们的索引与元信息。
 */

export const SCHEMA_VERSION = 1;

export const DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS novels (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT '',
    pov TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    font_size INTEGER NOT NULL DEFAULT 18,
    line_height REAL NOT NULL DEFAULT 1.9,
    dialogue_highlight INTEGER NOT NULL DEFAULT 1,
    reading_mode TEXT NOT NULL DEFAULT 'page',
    context_strategy TEXT NOT NULL DEFAULT 'balanced',
    token_budget INTEGER NOT NULL DEFAULT 60000,
    cover_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS volumes (
    novel_id TEXT NOT NULL,
    vol_index INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (novel_id, vol_index)
  )`,

  `CREATE TABLE IF NOT EXISTS chapters (
    novel_id TEXT NOT NULL,
    vol_index INTEGER NOT NULL,
    index_no INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'idle',
    word_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (novel_id, vol_index, index_no)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters (novel_id, index_no)`,

  `CREATE TABLE IF NOT EXISTS chapter_index (
    novel_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    index_no INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (novel_id, ref)
  )`,

  `CREATE TABLE IF NOT EXISTS independent_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    file TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'user',
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    UNIQUE (novel_id, title)
  )`,

  `CREATE TABLE IF NOT EXISTS base_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'prompt',
    content TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS rule_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'system',
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    UNIQUE (novel_id, kind, ref_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_bindings_novel ON rule_bindings (novel_id, category, sort_order)`,

  `CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'supporting',
    aliases TEXT NOT NULL DEFAULT '',
    identity TEXT NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    abilities TEXT NOT NULL DEFAULT '',
    foreshadowing TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    file TEXT NOT NULL DEFAULT '',
    position_x REAL NOT NULL DEFAULT 0,
    position_y REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (novel_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id TEXT NOT NULL,
    from_name TEXT NOT NULL,
    to_name TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT '',
    strength REAL NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (novel_id, from_name, to_name)
  )`,

  `CREATE TABLE IF NOT EXISTS encyclopedia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    tags TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (novel_id, title)
  )`,

  `CREATE TABLE IF NOT EXISTS outline (
    novel_id TEXT NOT NULL,
    vol_index INTEGER NOT NULL DEFAULT 1,
    index_no INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (novel_id, index_no)
  )`,

  `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '',
    UNIQUE (novel_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS chapter_tags (
    novel_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (novel_id, ref, tag_id)
  )`,

  `CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS changelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id TEXT NOT NULL,
    target TEXT NOT NULL,
    target_id TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    before TEXT NOT NULL DEFAULT '',
    after TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'user',
    note TEXT NOT NULL DEFAULT '',
    restored INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_changelog_novel ON changelog (novel_id, id DESC)`,

  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'openai',
    thinking INTEGER NOT NULL DEFAULT 0,
    batch_support TEXT NOT NULL DEFAULT 'auto',
    api_key TEXT NOT NULL DEFAULT '',
    temperature REAL NOT NULL DEFAULT 0.85,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    top_p REAL NOT NULL DEFAULT 0.95,
    stream INTEGER NOT NULL DEFAULT 1,
    max_retries INTEGER NOT NULL DEFAULT 2,
    timeout_ms INTEGER NOT NULL DEFAULT 120000,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_preset INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id TEXT,
    provider_id TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    scene TEXT NOT NULL DEFAULT 'chapter',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    estimated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_usage_novel ON usage_log (novel_id, id DESC)`,

  /**
   * 批量推理任务。
   * kind 区分是提交给供应商的原生批量接口，还是在本地按并发受控跑队列。
   * 任务落库，因此刷新页面或重启服务都不会丢进度。
   */
  `CREATE TABLE IF NOT EXISTS batch_jobs (
    id TEXT PRIMARY KEY,
    novel_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'openai',
    provider_id TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    scene TEXT NOT NULL DEFAULT 'chapter',
    status TEXT NOT NULL DEFAULT 'pending',
    total INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    remote_id TEXT NOT NULL DEFAULT '',
    results_url TEXT NOT NULL DEFAULT '',
    options TEXT NOT NULL DEFAULT '{}',
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS batch_items (
    job_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    custom_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    tokens INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (job_id, ref)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_batch_novel ON batch_jobs (novel_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_batch_items ON batch_items (job_id, status)`,
];

/**
 * 全文检索表。
 * 中文没有空格分词，优先使用 trigram 分词器以便按子串命中；
 * 若本机 SQLite 不支持，则退回 unicode61，再不行就只依赖 LIKE 匹配。
 */
export const FTS_DDL: { sql: string; tokenizer: string }[] = [
  {
    tokenizer: 'trigram',
    sql: `CREATE VIRTUAL TABLE IF NOT EXISTS chapter_fts USING fts5(
      novel_id UNINDEXED,
      ref UNINDEXED,
      title,
      content,
      tokenize='trigram'
    )`,
  },
  {
    tokenizer: 'unicode61',
    sql: `CREATE VIRTUAL TABLE IF NOT EXISTS chapter_fts USING fts5(
      novel_id UNINDEXED,
      ref UNINDEXED,
      title,
      content,
      tokenize='unicode61'
    )`,
  },
];
