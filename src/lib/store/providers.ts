import { decryptSecret, encryptSecret, maskSecret, novelIdFromTitle } from '../crypto';
import { getDb, nowIso, toBool } from '../db';
import type { GenScene, ProviderConfig, ProviderInput } from '../types';
import { findPreset } from '../ai/presets';
import type { BatchSupport } from '../types';

/** 批量能力允许显式声明，auto 走推断。 */
function mapBatchSupport(value: string): BatchSupport | 'auto' {
  return value === 'none' || value === 'anthropic' || value === 'openai' ? value : 'auto';
}

/**
 * 供应商配置。
 *
 * API Key 使用 AES-256-GCM 加密后写入本地数据库，读取时只在服务端解密，
 * 任何接口都不会把明文密钥返回给前端。
 */

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  model: string;
  protocol: string;
  thinking: number;
  batch_support: string;
  api_key: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  stream: number;
  max_retries: number;
  timeout_ms: number;
  enabled: number;
  is_default: number;
  is_preset: number;
  created_at: string;
}

function mapRow(row: ProviderRow): ProviderConfig {
  let mask = '';
  let hasKey = false;
  if (row.api_key) {
    try {
      mask = maskSecret(decryptSecret(row.api_key));
      hasKey = true;
    } catch {
      hasKey = false;
    }
  }
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
    thinking: toBool(row.thinking),
    batch: mapBatchSupport(row.batch_support),
    hasKey,
    keyMask: mask,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    topP: row.top_p,
    stream: toBool(row.stream),
    maxRetries: row.max_retries,
    timeoutMs: row.timeout_ms,
    enabled: toBool(row.enabled),
    isDefault: toBool(row.is_default),
    isPreset: toBool(row.is_preset),
    createdAt: row.created_at,
  };
}

export function listProviders(): ProviderConfig[] {
  const rows = getDb().prepare(`SELECT * FROM providers ORDER BY created_at`).all() as ProviderRow[];
  return rows.map(mapRow);
}

export function getProvider(id: string): ProviderConfig | null {
  const row = getDb().prepare(`SELECT * FROM providers WHERE id = ?`).get(id) as ProviderRow | undefined;
  return row ? mapRow(row) : null;
}

/** 只在服务端使用：取出解密后的密钥与连接信息。 */
export function getProviderWithSecret(id: string): {
  config: ProviderConfig;
  apiKey: string;
} | null {
  const row = getDb().prepare(`SELECT * FROM providers WHERE id = ?`).get(id) as ProviderRow | undefined;
  if (!row) return null;
  let apiKey = '';
  if (row.api_key) {
    try {
      apiKey = decryptSecret(row.api_key);
    } catch {
      apiKey = '';
    }
  }
  return { config: mapRow(row), apiKey };
}

export function saveProvider(input: ProviderInput): ProviderConfig {
  const db = getDb();
  const id = input.id ?? novelIdFromTitle(input.name || 'provider');
  const existing = db.prepare(`SELECT * FROM providers WHERE id = ?`).get(id) as ProviderRow | undefined;
  const stamp = nowIso();
  const preset = findPreset(id);
  const apiKey = input.apiKey !== undefined && input.apiKey !== '' ? encryptSecret(input.apiKey) : existing?.api_key ?? '';
  if (!existing) {
    db.prepare(
      `INSERT INTO providers (id, name, base_url, model, protocol, thinking, batch_support, api_key,
        temperature, max_tokens, top_p, stream, max_retries, timeout_ms, enabled, is_default,
        is_preset, created_at, updated_at)
       VALUES (@id, @name, @baseUrl, @model, @protocol, @thinking, @batch, @apiKey, @temperature,
        @maxTokens, @topP, @stream, @maxRetries, @timeoutMs, 1, 0, @isPreset, @stamp, @stamp)`,
    ).run({
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      protocol: input.protocol ?? preset?.protocol ?? 'openai',
      thinking: input.thinking === true ? 1 : 0,
      batch: input.batch ?? 'auto',
      apiKey,
      temperature: input.temperature ?? 0.85,
      maxTokens: input.maxTokens ?? 4096,
      topP: input.topP ?? 0.95,
      stream: input.stream === false ? 0 : 1,
      maxRetries: input.maxRetries ?? 2,
      timeoutMs: input.timeoutMs ?? 120000,
      isPreset: preset ? 1 : 0,
      stamp,
    });
  } else {
    db.prepare(
      `UPDATE providers SET name = @name, base_url = @baseUrl, model = @model, protocol = @protocol,
        thinking = @thinking, batch_support = @batch, api_key = @apiKey, temperature = @temperature, max_tokens = @maxTokens,
        top_p = @topP, stream = @stream, max_retries = @maxRetries, timeout_ms = @timeoutMs,
        updated_at = @stamp
       WHERE id = @id`,
    ).run({
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      protocol: input.protocol ?? (existing.protocol === 'anthropic' ? 'anthropic' : 'openai'),
      thinking: input.thinking === undefined ? existing.thinking : input.thinking ? 1 : 0,
      batch: input.batch ?? existing.batch_support,
      apiKey,
      temperature: input.temperature ?? existing.temperature,
      maxTokens: input.maxTokens ?? existing.max_tokens,
      topP: input.topP ?? existing.top_p,
      stream: input.stream === undefined ? existing.stream : input.stream ? 1 : 0,
      maxRetries: input.maxRetries ?? existing.max_retries,
      timeoutMs: input.timeoutMs ?? existing.timeout_ms,
      stamp,
    });
  }
  const saved = getProvider(id) as ProviderConfig;
  const defaultId = getSetting('defaultProviderId');
  if (!defaultId) setSetting('defaultProviderId', id);
  return saved;
}

export function deleteProvider(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM providers WHERE id = ?`).run(id);
  const settings = db
    .prepare(`SELECT key, value FROM settings WHERE key LIKE 'scene.%' OR key = 'defaultProviderId'`)
    .all() as { key: string; value: string }[];
  for (const row of settings) {
    if (row.value === id) {
      db.prepare(`UPDATE settings SET value = '' WHERE key = ?`).run(row.key);
    }
  }
}

export function setDefaultProvider(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE providers SET is_default = 0`).run();
  db.prepare(`UPDATE providers SET is_default = 1 WHERE id = ?`).run(id);
  setSetting('defaultProviderId', id);
}

export function setSceneProvider(scene: GenScene, providerId: string): void {
  setSetting(`scene.${scene}`, providerId);
}

export function getSceneProviders(): Partial<Record<GenScene, string>> {
  const rows = getDb()
    .prepare(`SELECT key, value FROM settings WHERE key LIKE 'scene.%'`)
    .all() as { key: string; value: string }[];
  const result: Partial<Record<GenScene, string>> = {};
  for (const row of rows) {
    const scene = row.key.replace('scene.', '') as GenScene;
    if (row.value) result[scene] = row.value;
  }
  return result;
}

/**
 * 解析某个场景实际使用的供应商。
 * 优先取该场景的专属配置，其次是全局默认，最后回退到第一个可用供应商。
 */
export function resolveProviderForScene(scene: GenScene): { config: ProviderConfig; apiKey: string } | null {
  const sceneId = getSetting(`scene.${scene}`);
  const defaultId = getSetting('defaultProviderId');
  const candidates = [sceneId, defaultId].filter(Boolean);
  for (const id of candidates) {
    const resolved = getProviderWithSecret(id);
    if (resolved && resolved.apiKey) return resolved;
  }
  const fallback = listProviders().find((provider) => provider.enabled && provider.hasKey);
  if (fallback) return getProviderWithSecret(fallback.id);
  return null;
}

/* ---------------------------------- 通用设置 ---------------------------------- */

export function getSetting(key: string, fallback = ''): string {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as {
    key: string;
    value: string;
  }[];
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function recordUsage(input: {
  novelId: string | null;
  providerId: string;
  model: string;
  scene: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}): void {
  getDb()
    .prepare(
      `INSERT INTO usage_log (novel_id, provider_id, model, scene, prompt_tokens, completion_tokens, total_tokens, estimated, created_at)
       VALUES (@novelId, @providerId, @model, @scene, @promptTokens, @completionTokens, @totalTokens, @estimated, @createdAt)`,
    )
    .run({
      novelId: input.novelId,
      providerId: input.providerId,
      model: input.model,
      scene: input.scene,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: input.totalTokens,
      estimated: input.estimated ? 1 : 0,
      createdAt: nowIso(),
    });
}
