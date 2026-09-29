import { runChat, normalizeAnthropicMessages, type ChatMessage } from './client';
import { assembleContext } from './context';
import { parseAiResponse } from './parse';
import { persistGeneration } from './pipeline';
import { buildBatchUrl, buildChatUrl, buildFilesUrl, resolveBatchSupport } from './presets';
import { getProviderWithSecret, recordUsage, resolveProviderForScene } from '../store/providers';
import {
  createJob,
  getJob,
  getJobDetail,
  listActiveJobs,
  listJobs,
  listPendingItems,
  patchItem,
  patchJob,
  refreshCounters,
  resetFailedItems,
  type BatchOptions,
} from '../store/batches';
import { listChapters, requireChapter } from '../store/chapters';
import type { BatchJob, BatchJobDetail } from '../types';

/**
 * 批量推理。
 *
 * 两条路径共用同一套任务模型：
 * - provider：把每一章组装好的请求一次性提交给供应商的批量接口，之后只轮询取结果。
 *   Anthropic 走 messages/batches；OpenAI 走「上传 JSONL → 建 batch → 下载结果」三步。
 * - local：本地按并发上限逐章调用普通接口，任何供应商都能用。
 *
 * 调度由接口层触发（见 advanceBatches），不依赖常驻进程，因此刷新页面或重启服务都不会卡住。
 */

/* --------------------------------- 请求组装 --------------------------------- */

interface PreparedRequest {
  ref: string;
  customId: string;
  messages: ChatMessage[];
}

/** custom_id 用章节引用变形而来，供应商回传时可以直接对应回章节。 */
export function customIdOf(ref: string): string {
  return `ch-${ref.replace(':', '-')}`;
}

export function prepareRequests(novelId: string, refs: string[], direction = ''): PreparedRequest[] {
  return refs.map((ref) => {
    const chapter = requireChapter(novelId, ref);
    const context = assembleContext({ novelId, chapterRef: ref, direction });
    const messages: ChatMessage[] = [];
    if (context.system.trim()) messages.push({ role: 'system', content: context.system });
    if (context.assistantSeed.trim()) messages.push({ role: 'assistant', content: context.assistantSeed });
    messages.push({
      role: 'user',
      content: context.userPrompt.trim() || `请开始写第${chapter.indexNo}章。`,
    });
    return { ref, customId: customIdOf(ref), messages };
  });
}

/* ---------------------------------- 鉴权头 ---------------------------------- */

function authHeaders(apiKey: string, protocol: 'openai' | 'anthropic'): Record<string, string> {
  if (protocol === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  }
  return { Authorization: `Bearer ${apiKey}`, 'api-key': apiKey };
}

/* ------------------------------- 供应商批量提交 ------------------------------- */

/** Anthropic：一次性提交全部请求。 */
async function submitAnthropicBatch(
  baseUrl: string,
  apiKey: string,
  model: string,
  requests: PreparedRequest[],
  maxTokens: number,
  thinking: boolean,
): Promise<string> {
  const body = {
    requests: requests.map((item) => {
      const { system, messages } = normalizeAnthropicMessages(item.messages);
      const params: Record<string, unknown> = { model, max_tokens: maxTokens, messages };
      if (system) params.system = system;
      if (thinking) {
        const budget = Math.min(8192, Math.max(1024, maxTokens - 1024));
        params.thinking = { type: 'enabled', budget_tokens: budget };
        params.temperature = 1;
      }
      return { custom_id: item.customId, params };
    }),
  };
  const response = await fetch(buildBatchUrl(baseUrl, 'anthropic'), {
    method: 'POST',
    headers: { ...authHeaders(apiKey, 'anthropic'), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`提交批量任务失败（${response.status}）：${text.slice(0, 300)}`);
  const parsed = JSON.parse(text) as { id?: string };
  if (!parsed.id) throw new Error('供应商没有返回批量任务编号');
  return parsed.id;
}

/** OpenAI：先上传 JSONL 文件，再创建 batch。 */
async function submitOpenAiBatch(
  baseUrl: string,
  apiKey: string,
  requests: PreparedRequest[],
  model: string,
  maxTokens: number,
): Promise<string> {
  const chatPath = new URL(buildChatUrl(baseUrl, 'openai')).pathname;
  const lines = requests.map((item) =>
    JSON.stringify({
      custom_id: item.customId,
      method: 'POST',
      url: chatPath,
      body: { model, messages: item.messages, max_tokens: maxTokens },
    }),
  );

  const form = new FormData();
  form.append('purpose', 'batch');
  form.append('file', new Blob([lines.join('\n')], { type: 'application/jsonl' }), 'nymph-batch.jsonl');
  const upload = await fetch(buildFilesUrl(baseUrl), {
    method: 'POST',
    headers: authHeaders(apiKey, 'openai'),
    body: form,
  });
  const uploadText = await upload.text();
  if (!upload.ok) throw new Error(`上传批量文件失败（${upload.status}）：${uploadText.slice(0, 300)}`);
  const fileId = (JSON.parse(uploadText) as { id?: string }).id;
  if (!fileId) throw new Error('上传批量文件后没有拿到文件编号');

  const response = await fetch(buildBatchUrl(baseUrl, 'openai'), {
    method: 'POST',
    headers: { ...authHeaders(apiKey, 'openai'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_file_id: fileId,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`创建批量任务失败（${response.status}）：${text.slice(0, 300)}`);
  const parsed = JSON.parse(text) as { id?: string };
  if (!parsed.id) throw new Error('供应商没有返回批量任务编号');
  return parsed.id;
}

/* ---------------------------------- 结果解析 --------------------------------- */

interface ParsedResult {
  customId: string;
  text: string;
  tokens: number;
  error?: string;
}

/** 结果统一是 JSONL，每行一条。两种协议只是字段位置不同。 */
export function parseResultLines(jsonl: string, protocol: 'openai' | 'anthropic'): ParsedResult[] {
  const results: ParsedResult[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const record = row as {
      custom_id?: string;
      result?: {
        type?: string;
        message?: {
          content?: { type?: string; text?: string }[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        error?: { message?: string };
      };
      response?: {
        status_code?: number;
        body?: {
          choices?: { message?: { content?: string } }[];
          usage?: { total_tokens?: number };
          error?: { message?: string };
        };
      };
      error?: { message?: string };
    };
    const customId = record.custom_id ?? '';
    if (!customId) continue;

    if (protocol === 'anthropic') {
      const message = record.result?.message;
      results.push({
        customId,
        text: (message?.content ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join(''),
        tokens: (message?.usage?.input_tokens ?? 0) + (message?.usage?.output_tokens ?? 0),
        error:
          record.result?.type && record.result.type !== 'succeeded'
            ? (record.result.error?.message ?? '该条处理失败')
            : undefined,
      });
      continue;
    }

    const body = record.response?.body;
    const failed =
      record.error?.message ??
      (record.response?.status_code && record.response.status_code >= 400
        ? (body?.error?.message ?? '该条处理失败')
        : undefined);
    results.push({
      customId,
      text: body?.choices?.[0]?.message?.content ?? '',
      tokens: body?.usage?.total_tokens ?? 0,
      error: failed,
    });
  }
  return results;
}

/** 把一条批量结果写回章节。与同步生成走的是同一段落盘逻辑。 */
function applyResult(novelId: string, ref: string, text: string): { ok: boolean; message: string } {
  const parsed = parseAiResponse(text);
  const content = (parsed.payload.content ?? '').trim();
  if (!content) return { ok: false, message: '返回内容里没有正文' };
  persistGeneration(novelId, ref, content, parsed.payload, 'draft');
  return { ok: true, message: `已写入 ${content.length} 字` };
}

/* ---------------------------------- 任务创建 ---------------------------------- */

export interface CreateBatchInput {
  novelId: string;
  refs: string[];
  options: BatchOptions;
}

export function startBatch(input: CreateBatchInput): BatchJob {
  const resolved = resolveProviderForScene('chapter');
  if (!resolved) throw new Error('没有可用的模型配置，请先到设置里添加供应商与 API Key');
  if (input.refs.length === 0) throw new Error('请先选择要生成的章节');

  const { config } = resolved;
  const support = resolveBatchSupport(config.protocol, config.baseUrl, config.batch);
  const wantsProvider = input.options.mode === 'provider';
  const useProvider = wantsProvider ? support !== 'none' : input.options.mode === 'auto' && support !== 'none';

  if (wantsProvider && support === 'none') {
    throw new Error('当前模型不支持原生批量接口，请改用「本地队列」');
  }

  const job = createJob({
    novelId: input.novelId,
    kind: useProvider ? 'provider' : 'local',
    protocol: config.protocol,
    providerId: config.id,
    model: config.model,
    scene: 'chapter',
    refs: input.refs,
    options: input.options,
  });

  if (useProvider) {
    void submitProviderJob(job.id).catch((error: unknown) => {
      patchJob(job.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    });
  } else {
    kickLocalJob(job.id);
  }
  return getJob(job.id) as BatchJob;
}

async function submitProviderJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  const detail = getJobDetail(jobId);
  if (!job || !detail) return;
  const resolved = getProviderWithSecret(job.providerId);
  if (!resolved?.apiKey) throw new Error('该供应商还没有填写 API Key');

  patchJob(jobId, { status: 'running' });
  const requests = prepareRequests(
    job.novelId,
    detail.items.map((item) => item.ref),
    job.options.direction,
  );
  const maxTokens = job.options.maxTokens ?? resolved.config.maxTokens;

  const remoteId =
    job.protocol === 'anthropic'
      ? await submitAnthropicBatch(
          resolved.config.baseUrl,
          resolved.apiKey,
          job.model,
          requests,
          maxTokens,
          job.options.thinking ?? resolved.config.thinking,
        )
      : await submitOpenAiBatch(resolved.config.baseUrl, resolved.apiKey, requests, job.model, maxTokens);

  patchJob(jobId, { remoteId });
}

/* ---------------------------------- 轮询推进 ---------------------------------- */

const lastPoll = new Map<string, number>();
const POLL_INTERVAL_MS = 8000;

async function pollProviderJob(job: BatchJob): Promise<void> {
  if (!job.remoteId) return;
  const previous = lastPoll.get(job.id) ?? 0;
  if (Date.now() - previous < POLL_INTERVAL_MS) return;
  lastPoll.set(job.id, Date.now());

  const resolved = getProviderWithSecret(job.providerId);
  if (!resolved?.apiKey) return;
  const headers = authHeaders(resolved.apiKey, job.protocol);

  if (job.protocol === 'anthropic') {
    const response = await fetch(`${buildBatchUrl(resolved.config.baseUrl, 'anthropic')}/${job.remoteId}`, {
      headers,
    });
    if (!response.ok) return;
    const detail = (await response.json()) as {
      processing_status?: string;
      results_url?: string;
      request_counts?: { succeeded?: number; errored?: number };
    };
    if (detail.request_counts) {
      patchJob(job.id, {
        completed: detail.request_counts.succeeded ?? 0,
        failed: detail.request_counts.errored ?? 0,
      });
    }
    if (detail.processing_status !== 'ended') {
      patchJob(job.id, { status: 'running' });
      return;
    }
    patchJob(job.id, { resultsUrl: detail.results_url ?? '' });
    if (detail.results_url) {
      const results = await fetch(detail.results_url, { headers });
      if (results.ok) await applyResults(job.id, parseResultLines(await results.text(), 'anthropic'));
    }
    finishJob(job.id);
    return;
  }

  const response = await fetch(`${buildBatchUrl(resolved.config.baseUrl, 'openai')}/${job.remoteId}`, {
    headers,
  });
  if (!response.ok) return;
  const detail = (await response.json()) as {
    status?: string;
    output_file_id?: string;
    error_file_id?: string;
    request_counts?: { completed?: number; failed?: number };
  };
  if (detail.request_counts) {
    patchJob(job.id, {
      completed: detail.request_counts.completed ?? 0,
      failed: detail.request_counts.failed ?? 0,
    });
  }
  if (!['completed', 'failed', 'cancelled', 'expired'].includes(detail.status ?? '')) {
    patchJob(job.id, { status: 'running' });
    return;
  }

  if (detail.output_file_id) {
    const file = await fetch(`${buildFilesUrl(resolved.config.baseUrl)}/${detail.output_file_id}/content`, {
      headers,
    });
    if (file.ok) await applyResults(job.id, parseResultLines(await file.text(), 'openai'));
  }
  if (detail.error_file_id) {
    const file = await fetch(`${buildFilesUrl(resolved.config.baseUrl)}/${detail.error_file_id}/content`, {
      headers,
    });
    if (file.ok) {
      for (const item of parseResultLines(await file.text(), 'openai')) {
        markItem(job.id, item.customId, item.error ?? '供应商返回错误');
      }
    }
  }
  finishJob(job.id);
}

async function applyResults(jobId: string, results: ParsedResult[]): Promise<void> {
  const job = getJob(jobId);
  const detail = getJobDetail(jobId);
  if (!job || !detail) return;
  const byCustomId = new Map(detail.items.map((item) => [item.customId, item.ref]));

  for (const result of results) {
    const ref = byCustomId.get(result.customId);
    if (!ref) continue;
    if (result.error) {
      patchItem(jobId, ref, { status: 'failed', message: result.error, tokens: result.tokens });
      continue;
    }
    const applied = applyResult(job.novelId, ref, result.text);
    patchItem(jobId, ref, {
      status: applied.ok ? 'done' : 'failed',
      message: applied.message,
      tokens: result.tokens,
      attempts: 1,
    });
    if (applied.ok && result.tokens > 0) {
      recordUsage({
        novelId: job.novelId,
        providerId: job.providerId,
        model: job.model,
        scene: 'chapter',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: result.tokens,
        estimated: false,
      });
    }
  }
  refreshCounters(jobId);
}

function markItem(jobId: string, customId: string, message: string): void {
  const item = getJobDetail(jobId)?.items.find((entry) => entry.customId === customId);
  if (item) patchItem(jobId, item.ref, { status: 'failed', message });
}

function finishJob(jobId: string): void {
  refreshCounters(jobId);
  const job = getJob(jobId);
  if (!job) return;
  const allFailed = job.failed > 0 && job.completed === 0;
  patchJob(jobId, {
    status: allFailed ? 'failed' : 'done',
    error: allFailed ? '全部条目都失败了' : '',
  });
}

/* ---------------------------------- 本地队列 ---------------------------------- */

interface LocalRunner {
  cancelled: boolean;
}

const runners = new Map<string, LocalRunner>();

/** 把本地队列推起来。重复调用是安全的，同一个任务只会跑一份。 */
export function kickLocalJob(jobId: string): void {
  if (runners.has(jobId)) return;
  const runner: LocalRunner = { cancelled: false };
  runners.set(jobId, runner);
  void runLocalJob(jobId, runner).finally(() => runners.delete(jobId));
}

export function cancelJob(jobId: string): void {
  const runner = runners.get(jobId);
  if (runner) runner.cancelled = true;
  patchJob(jobId, { status: 'cancelled' });
}

async function runLocalJob(jobId: string, runner: LocalRunner): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.status === 'cancelled') return;
  patchJob(jobId, { status: 'running' });

  const concurrency = Math.min(4, Math.max(1, job.options.concurrency ?? 1));
  const pending = listPendingItems(jobId);
  let cursor = 0;

  const worker = async () => {
    while (cursor < pending.length) {
      if (runner.cancelled) return;
      const current = getJob(jobId);
      if (!current || current.status === 'cancelled') return;
      const item = pending[cursor];
      cursor += 1;
      if (!item) return;

      patchItem(jobId, item.ref, { status: 'running', attempts: item.attempts + 1 });
      try {
        const prepared = prepareRequests(job.novelId, [item.ref], job.options.direction)[0];
        if (!prepared) throw new Error('无法组装请求');
        const result = await runChat({
          providerId: job.providerId,
          messages: prepared.messages,
          scene: 'chapter',
          novelId: job.novelId,
          maxTokens: job.options.maxTokens,
          thinking: job.options.thinking,
        });
        const applied = applyResult(job.novelId, item.ref, result.content);
        patchItem(jobId, item.ref, {
          status: applied.ok ? 'done' : 'failed',
          message: applied.message,
          tokens: result.usage.totalTokens,
        });
      } catch (error) {
        patchItem(jobId, item.ref, {
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      refreshCounters(jobId);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (runner.cancelled) return;
  finishJob(jobId);
}

/* ---------------------------------- 对外入口 ---------------------------------- */

/**
 * 推进所有未完成的任务并返回最新列表。
 * 界面每次轮询都会走到这里，因此不需要额外的常驻调度器。
 */
export async function advanceBatches(novelId: string): Promise<BatchJobDetail[]> {
  for (const job of listActiveJobs(novelId)) {
    if (job.status === 'cancelled') continue;
    if (job.kind === 'provider') {
      await pollProviderJob(job).catch(() => undefined);
    } else {
      kickLocalJob(job.id);
    }
  }
  return listJobs(novelId, 10).map((job) => getJobDetail(job.id) as BatchJobDetail);
}

/** 重试一个任务里失败的条目。 */
export function retryFailed(jobId: string): BatchJobDetail | null {
  const job = getJob(jobId);
  if (!job) return null;
  const count = resetFailedItems(jobId);
  if (count === 0) return getJobDetail(jobId);
  patchJob(jobId, { status: 'pending', error: '' });
  refreshCounters(jobId);
  if (job.kind === 'provider') {
    void submitProviderJob(jobId).catch((error: unknown) => {
      patchJob(jobId, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    });
  } else {
    kickLocalJob(jobId);
  }
  return getJobDetail(jobId);
}

/** 可批量生成的章节：只挑正式章节，废稿不参与。 */
export function batchCandidateRefs(novelId: string): string[] {
  return listChapters(novelId)
    .filter((chapter) => !chapter.isDraft)
    .map((chapter) => chapter.ref);
}
