/**
 * 供应商预设。
 *
 * 同一条供应商可能同时提供 OpenAI 兼容与 Anthropic 兼容两套入口，
 * 预设里各自声明协议与对应的接入地址，用户也可以自定义任意组合。
 */

import type { BatchSupport, ProviderProtocol } from '../types';

export interface ProviderEndpoint {
  url: string;
  models: string[];
  defaultModel: string;
  note?: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  note: string;
  docs?: string;
  /** 该供应商支持的批量推理方式，none 表示只能走本地队列 */
  batch: BatchSupport;
  /** 同供应商的另一套协议入口，设置页可以一键切换 */
  alternate?: ProviderEndpoint;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    note: '长文写作成本低，中文语感稳定。',
    docs: 'https://platform.deepseek.com',
    batch: 'none',
    alternate: {
      url: 'https://api.deepseek.com/anthropic',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      defaultModel: 'deepseek-chat',
      note: 'Anthropic 兼容入口。',
    },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
    defaultModel: 'claude-sonnet-4-5',
    note: '原生 Messages 协议，支持扩展思考与批量推理（费用减半）。',
    docs: 'https://docs.anthropic.com',
    batch: 'anthropic',
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    defaultModel: 'glm-4-plus',
    note: '中文表达自然，适合对话密集的章节。',
    docs: 'https://open.bigmodel.cn',
    batch: 'none',
    alternate: {
      url: 'https://open.bigmodel.cn/api/anthropic',
      models: ['glm-4-plus', 'glm-4-air'],
      defaultModel: 'glm-4-plus',
      note: 'Anthropic 兼容入口。',
    },
  },
  {
    id: 'mimo',
    name: '小米 MiMo',
    protocol: 'openai',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    models: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.5-pro'],
    defaultModel: 'mimo-v2.6-pro',
    note: '兼容 OpenAI 与 Anthropic 协议，长程连贯性较好。',
    docs: 'https://platform.xiaomimimo.com',
    batch: 'none',
    alternate: {
      url: 'https://api.xiaomimimo.com/anthropic',
      models: ['mimo-v2.6-pro', 'mimo-v2.6-flash'],
      defaultModel: 'mimo-v2.6-pro',
      note: 'Anthropic 协议入口，支持扩展思考。',
    },
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI 兼容接口',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o'],
    defaultModel: 'gpt-4o-mini',
    note: '任何兼容 OpenAI 协议的服务都能填在这里，官方入口支持 Batch 接口。',
    batch: 'openai',
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5:14b', 'llama3.1:8b'],
    defaultModel: 'qwen2.5:14b',
    note: '完全离线运行，数据不出本机，不支持批量接口。',
    batch: 'none',
  },
];

export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

/** 供应商声明的批量推理能力；预设里没有的按协议推断。 */
export function batchSupportOf(protocol: ProviderProtocol, baseUrl: string): BatchSupport {
  const trimmed = stripTrailingSlash(baseUrl);
  const preset = PROVIDER_PRESETS.find(
    (item) =>
      trimmed === stripTrailingSlash(item.baseUrl) ||
      Boolean(trimmed && stripTrailingSlash(item.baseUrl).includes(trimmed)) ||
      (trimmed && trimmed.includes(stripTrailingSlash(item.baseUrl))),
  );
  if (preset) return preset.batch;
  return protocol === 'anthropic' ? 'anthropic' : 'none';
}

/**
 * 供应商实际生效的批量能力。
 * 用户在设置里显式指定时以用户为准，否则按预设与协议推断——
 * 自定义网关只要自己声明支持，就能走原生批量。
 */
export function resolveBatchSupport(
  protocol: ProviderProtocol,
  baseUrl: string,
  declared?: BatchSupport | 'auto',
): BatchSupport {
  if (declared && declared !== 'auto') return declared;
  return batchSupportOf(protocol, baseUrl);
}

/** 判断某个地址是否明显指向 Anthropic 风格入口，用于自动纠正协议。 */
export function guessProtocol(baseUrl: string): ProviderProtocol {
  return /anthropic|\/messages\/?$/i.test(baseUrl) ? 'anthropic' : 'openai';
}

export function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** 生成对话补全的完整地址，兼容用户填到不同层级的情况。 */
export function buildChatUrl(baseUrl: string, protocol: ProviderProtocol = 'openai'): string {
  const trimmed = stripTrailingSlash(baseUrl);
  if (!trimmed) return '';
  if (protocol === 'anthropic') {
    if (/\/messages$/.test(trimmed)) return trimmed;
    // Anthropic 的路径固定带版本号；若用户已经把 /v1 写进来就不再重复
    if (/\/v1$/.test(trimmed)) return `${trimmed}/messages`;
    return `${trimmed}/v1/messages`;
  }
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function buildModelsUrl(baseUrl: string, protocol: ProviderProtocol = 'openai'): string {
  const trimmed = stripTrailingSlash(baseUrl);
  if (!trimmed) return '';
  if (protocol === 'anthropic') {
    if (/\/models$/.test(trimmed)) return trimmed;
    if (/\/v1$/.test(trimmed)) return `${trimmed}/models`;
    return `${trimmed}/v1/models`;
  }
  if (/\/models$/.test(trimmed)) return trimmed;
  return `${trimmed}/models`;
}

/** 批量推理接口的地址。 */
export function buildBatchUrl(baseUrl: string, protocol: ProviderProtocol): string {
  const trimmed = stripTrailingSlash(baseUrl);
  if (!trimmed) return '';
  if (protocol === 'anthropic') {
    if (/\/batches$/.test(trimmed)) return trimmed;
    if (/\/v1$/.test(trimmed)) return `${trimmed}/messages/batches`;
    return `${trimmed}/v1/messages/batches`;
  }
  if (/\/batches$/.test(trimmed)) return trimmed;
  return `${trimmed}/batches`;
}

/** OpenAI 的批量推理需要先把 JSONL 上传成文件。 */
export function buildFilesUrl(baseUrl: string): string {
  const trimmed = stripTrailingSlash(baseUrl);
  if (!trimmed) return '';
  if (/\/files$/.test(trimmed)) return trimmed;
  return `${trimmed}/files`;
}
