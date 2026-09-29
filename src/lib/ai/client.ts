import { buildChatUrl, buildModelsUrl } from './presets';
import { getProviderWithSecret, recordUsage } from '../store/providers';
import { estimateTokens } from '../format';
import type { GenScene, ProviderConfig, ProviderProtocol, TokenUsage } from '../types';

/**
 * 模型调用。
 *
 * 同一套上层接口下支持两种协议：
 * - openai：`/chat/completions`，Authorization 鉴权，delta.content 增量；
 * - anthropic：`/messages`，x-api-key 鉴权，content_block_delta 增量，
 *   思考内容走 thinking_delta，用量分散在 message_start 与 message_delta 里。
 * 两种协议都支持流式、失败重试与 token 统计，密钥只在服务端解密使用。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type { TokenUsage };

export interface ChatOptions {
  providerId: string;
  messages: ChatMessage[];
  scene: GenScene | 'test';
  novelId?: string | null;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  /** 推理模型会在正文之前先吐思考内容，单独回调出去 */
  onReasoning?: (text: string) => void;
  maxTokens?: number;
  temperature?: number;
  /** Anthropic 协议的扩展思考开关，开启后会强制 temperature = 1 */
  thinking?: boolean;
}

export interface ChatResult {
  content: string;
  reasoning: string;
  usage: TokenUsage;
}

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

/* --------------------------------- 载荷类型 --------------------------------- */

interface OpenAiChunk {
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null };
    message?: { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  error?: { message?: string };
}

interface AnthropicStreamChunk {
  type?: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

interface AnthropicMessage {
  content?: { type?: string; text?: string; thinking?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

/* ---------------------------------- 请求构造 ---------------------------------- */

function buildHeaders(apiKey: string, protocol: ProviderProtocol): Record<string, string> {
  if (protocol === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return {
    'Content-Type': 'application/json',
    // 兼容两种鉴权写法：多数供应商读 Authorization，小米 MiMo 的示例用 api-key
    Authorization: `Bearer ${apiKey}`,
    'api-key': apiKey,
  };
}

/**
 * 把消息整理成 Anthropic 能接受的形式。
 * system 必须提到顶层，且 user / assistant 要交替出现、首条必须是 user；
 * 因此连续的同类消息会合并，作为风格前缀的 assistant 消息会并入 system。
 */
export function normalizeAnthropicMessages(messages: ChatMessage[]): {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
} {
  const systemParts: string[] = [];
  const rest: { role: 'user' | 'assistant'; content: string }[] = [];

  for (const message of messages) {
    if (!message.content.trim()) continue;
    if (message.role === 'system') {
      systemParts.push(message.content.trim());
      continue;
    }
    const last = rest[rest.length - 1];
    if (!last) {
      // 首条是 assistant（风格前缀）时并入 system，避免以 assistant 开头
      if (message.role === 'assistant') {
        systemParts.push(message.content.trim());
        continue;
      }
      rest.push({ role: 'user', content: message.content });
      continue;
    }
    if (last.role === message.role) {
      last.content = `${last.content}\n\n${message.content}`;
      continue;
    }
    rest.push({ role: message.role, content: message.content });
  }

  return { system: systemParts.join('\n\n'), messages: rest };
}

function thinkingBudget(maxTokens: number): number {
  // Anthropic 要求 budget_tokens 不小于 1024 且严格小于 max_tokens
  const ceiling = Math.max(1024, maxTokens - 1024);
  return Math.min(8192, ceiling);
}

function buildBody(
  config: ProviderConfig,
  options: ChatOptions,
  stream: boolean,
): Record<string, unknown> {
  const maxTokens = options.maxTokens ?? config.maxTokens;
  const thinking = config.protocol === 'anthropic' && (options.thinking ?? config.thinking);

  if (config.protocol === 'anthropic') {
    const { system, messages } = normalizeAnthropicMessages(options.messages);
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: maxTokens,
      messages,
      stream,
    };
    if (system) body.system = system;
    if (thinking) {
      // 开启扩展思考时 Anthropic 只接受 temperature = 1
      body.thinking = { type: 'enabled', budget_tokens: thinkingBudget(maxTokens) };
      body.temperature = 1;
    } else {
      body.temperature = options.temperature ?? config.temperature;
    }
    return body;
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages: options.messages,
    temperature: options.temperature ?? config.temperature,
    top_p: config.topP,
    max_tokens: maxTokens,
    stream,
  };
  if (stream) {
    // 让供应商在流式响应末尾附带用量信息
    body.stream_options = { include_usage: true };
  }
  return body;
}

function isRetryable(error: unknown, status?: number): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof AiRequestError) {
    if (!status) return true;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return true;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('已中止', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 把 SSE 文本切成一个个 data 载荷，两种协议共用。 */
async function* readSse(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new AiRequestError('响应没有可读的流');
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      // 只关心 data 行：两种协议的 JSON 里都带 type 字段，不需要看 event 行
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      yield payload;
    }
  }
}

/* ---------------------------------- 流式解析 ---------------------------------- */

async function consumeOpenAiStream(
  response: Response,
  onDelta?: (text: string) => void,
  onReasoning?: (text: string) => void,
): Promise<{ content: string; reasoning: string; usage: Partial<TokenUsage> | null }> {
  let content = '';
  let reasoning = '';
  let usage: Partial<TokenUsage> | null = null;

  for await (const payload of readSse(response)) {
    let chunk: OpenAiChunk;
    try {
      chunk = JSON.parse(payload) as OpenAiChunk;
    } catch {
      continue;
    }
    if (chunk.error?.message) throw new AiRequestError(chunk.error.message);
    const choice = chunk.choices?.[0];
    const think = choice?.delta?.reasoning_content;
    if (think) {
      reasoning += think;
      onReasoning?.(think);
    }
    const delta = choice?.delta?.content;
    if (delta) {
      content += delta;
      onDelta?.(delta);
    }
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        totalTokens:
          chunk.usage.total_tokens ??
          (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
        estimated: false,
      };
    }
  }
  return { content, reasoning, usage };
}

async function consumeAnthropicStream(
  response: Response,
  onDelta?: (text: string) => void,
  onReasoning?: (text: string) => void,
): Promise<{ content: string; reasoning: string; usage: Partial<TokenUsage> | null }> {
  let content = '';
  let reasoning = '';
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  for await (const payload of readSse(response)) {
    let chunk: AnthropicStreamChunk;
    try {
      chunk = JSON.parse(payload) as AnthropicStreamChunk;
    } catch {
      continue;
    }
    if (chunk.type === 'error') {
      throw new AiRequestError(chunk.error?.message ?? '模型返回错误');
    }
    if (chunk.type === 'message_start') {
      inputTokens = chunk.message?.usage?.input_tokens ?? null;
      continue;
    }
    if (chunk.type === 'content_block_delta') {
      const delta = chunk.delta;
      if (delta?.type === 'thinking_delta' && delta.thinking) {
        reasoning += delta.thinking;
        onReasoning?.(delta.thinking);
      } else if (delta?.text) {
        content += delta.text;
        onDelta?.(delta.text);
      }
      continue;
    }
    if (chunk.type === 'message_delta' && chunk.usage?.output_tokens != null) {
      outputTokens = chunk.usage.output_tokens;
    }
  }

  const usage =
    inputTokens == null && outputTokens == null
      ? null
      : {
          promptTokens: inputTokens ?? 0,
          completionTokens: outputTokens ?? 0,
          totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
          estimated: false,
        };
  return { content, reasoning, usage };
}

/* ---------------------------------- 单次请求 ---------------------------------- */

async function requestOnce(
  config: ProviderConfig,
  apiKey: string,
  options: ChatOptions,
): Promise<ChatResult> {
  const url = buildChatUrl(config.baseUrl, config.protocol);
  if (!url) throw new AiRequestError('API 地址为空');
  const stream = config.stream && Boolean(options.onDelta || options.onReasoning);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(apiKey, config.protocol),
      body: JSON.stringify(buildBody(config, options, stream)),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = text.slice(0, 400);
      try {
        const parsed = JSON.parse(text) as OpenAiChunk & AnthropicMessage;
        message = parsed.error?.message ?? message;
      } catch {
        // 保持原始文本
      }
      throw new AiRequestError(
        `模型接口返回 ${response.status}${message ? `：${message}` : ''}`,
        response.status,
      );
    }

    const promptFallback = estimateTokens(options.messages.map((m) => m.content).join('\n'));

    if (stream) {
      const { content, reasoning, usage } =
        config.protocol === 'anthropic'
          ? await consumeAnthropicStream(response, options.onDelta, options.onReasoning)
          : await consumeOpenAiStream(response, options.onDelta, options.onReasoning);
      const promptTokens = usage?.promptTokens || promptFallback;
      const completionTokens = usage?.completionTokens || estimateTokens(content);
      return {
        content,
        reasoning,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: usage?.totalTokens || promptTokens + completionTokens,
          estimated: usage?.estimated ?? true,
        },
      };
    }

    if (config.protocol === 'anthropic') {
      const json = (await response.json()) as AnthropicMessage;
      if (json.error?.message) throw new AiRequestError(json.error.message);
      const blocks = json.content ?? [];
      const content = blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      const reasoning = blocks
        .filter((block) => block.type === 'thinking')
        .map((block) => block.thinking ?? '')
        .join('');
      const promptTokens = json.usage?.input_tokens ?? promptFallback;
      const completionTokens = json.usage?.output_tokens ?? estimateTokens(content);
      return {
        content,
        reasoning,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          estimated: !json.usage,
        },
      };
    }

    const json = (await response.json()) as OpenAiChunk;
    if (json.error?.message) throw new AiRequestError(json.error.message);
    const content = json.choices?.[0]?.message?.content ?? '';
    const promptTokens = json.usage?.prompt_tokens ?? promptFallback;
    const completionTokens = json.usage?.completion_tokens ?? estimateTokens(content);
    return {
      content,
      reasoning: '',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: json.usage?.total_tokens ?? promptTokens + completionTokens,
        estimated: !json.usage,
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (options.signal?.aborted) throw error;
      throw new AiRequestError('请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** 带重试的调用。所有调用都会记录到用量统计。 */
export async function runChat(options: ChatOptions): Promise<ChatResult> {
  const resolved = getProviderWithSecret(options.providerId);
  if (!resolved) throw new AiRequestError('没有可用的模型配置，请先到设置里添加供应商');
  const { config, apiKey } = resolved;
  if (!apiKey) throw new AiRequestError('该供应商还没有填写 API Key');

  const attempts = Math.max(1, config.maxRetries + 1);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await requestOnce(config, apiKey, options);
      recordUsage({
        novelId: options.novelId ?? null,
        providerId: config.id,
        model: config.model,
        scene: options.scene,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        estimated: result.usage.estimated,
      });
      return result;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
      const status = error instanceof AiRequestError ? error.status : undefined;
      if (!isRetryable(error, status) || attempt === attempts - 1) throw error;
      await delay(600 * 2 ** attempt, options.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new AiRequestError('模型调用失败');
}

/**
 * 设置页的连通性测试。
 * Anthropic 的模型列表接口并非所有代理都提供，直接发一条最小请求更可靠。
 */
export async function testProvider(
  providerId: string,
): Promise<{ ok: boolean; message: string; latency: number }> {
  const resolved = getProviderWithSecret(providerId);
  if (!resolved) return { ok: false, message: '供应商不存在', latency: 0 };
  const { config, apiKey } = resolved;
  if (!apiKey) return { ok: false, message: '还没有填写 API Key', latency: 0 };
  const started = Date.now();

  if (config.protocol === 'anthropic') {
    try {
      const response = await fetch(buildChatUrl(config.baseUrl, 'anthropic'), {
        method: 'POST',
        headers: buildHeaders(apiKey, 'anthropic'),
        body: JSON.stringify({
          model: config.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: '请回复两个字：正常' }],
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(config.timeoutMs, 20000)),
      });
      const latency = Date.now() - started;
      if (response.ok) return { ok: true, message: '连接成功', latency };
      const text = await response.text().catch(() => '');
      let message = text.slice(0, 160);
      try {
        message = (JSON.parse(text) as AnthropicMessage).error?.message ?? message;
      } catch {
        // 保持原始文本
      }
      return { ok: false, message: `返回 ${response.status} ${message}`, latency };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '连接失败',
        latency: Date.now() - started,
      };
    }
  }

  try {
    const response = await fetch(buildModelsUrl(config.baseUrl, 'openai'), {
      headers: buildHeaders(apiKey, 'openai'),
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 20000)),
    });
    const latency = Date.now() - started;
    if (response.ok) return { ok: true, message: '连接成功', latency };
    const text = await response.text().catch(() => '');
    return { ok: false, message: `返回 ${response.status} ${text.slice(0, 160)}`, latency };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '连接失败',
      latency: Date.now() - started,
    };
  }
}
