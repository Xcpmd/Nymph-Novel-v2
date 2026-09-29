import { describe, expect, it } from 'vitest';

import {
  batchSupportOf,
  buildBatchUrl,
  buildChatUrl,
  buildFilesUrl,
  buildModelsUrl,
  findPreset,
  guessProtocol,
  PROVIDER_PRESETS,
} from './presets';

/** 供应商预设与地址拼接的基础校验。 */

describe('provider presets', () => {
  it('每款预设都有默认模型且默认模型在候选列表里', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.models.length).toBeGreaterThan(0);
      expect(preset.models).toContain(preset.defaultModel);
      expect(preset.baseUrl.startsWith('http')).toBe(true);
      expect(['openai', 'anthropic']).toContain(preset.protocol);
    }
  });

  it('每款预设都声明了批量推理能力', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(['none', 'anthropic', 'openai']).toContain(preset.batch);
    }
  });

  it('包含需求里点名的 DeepSeek、GLM 与 MiMo', () => {
    expect(findPreset('deepseek')).toBeTruthy();
    expect(findPreset('glm')).toBeTruthy();
    expect(findPreset('mimo')?.baseUrl).toContain('xiaomimimo.com');
  });

  it('Anthropic 走原生 Messages 协议并支持批量', () => {
    const anthropic = findPreset('anthropic');
    expect(anthropic?.protocol).toBe('anthropic');
    expect(anthropic?.batch).toBe('anthropic');
  });

  it('提供了另一套协议入口的预设都带上备用地址与模型', () => {
    for (const preset of PROVIDER_PRESETS.filter((item) => item.alternate)) {
      expect(preset.alternate?.url.startsWith('http')).toBe(true);
      expect(preset.alternate?.models).toContain(preset.alternate?.defaultModel);
    }
  });
});

describe('buildChatUrl', () => {
  it('补全 chat/completions 路径', () => {
    expect(buildChatUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('去掉多余的斜杠', () => {
    expect(buildChatUrl('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('已经写全路径时原样返回', () => {
    const url = 'https://example.com/v1/chat/completions';
    expect(buildChatUrl(url)).toBe(url);
  });

  it('Anthropic 协议补全 /v1/messages', () => {
    expect(buildChatUrl('https://api.anthropic.com', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });

  it('Anthropic 协议下已经带 /v1 时不重复拼接', () => {
    expect(buildChatUrl('https://api.deepseek.com/anthropic/v1', 'anthropic')).toBe(
      'https://api.deepseek.com/anthropic/v1/messages',
    );
  });

  it('Anthropic 协议下已经写全路径时原样返回', () => {
    const url = 'https://proxy.example.com/v1/messages';
    expect(buildChatUrl(url, 'anthropic')).toBe(url);
  });

  it('空地址返回空串', () => {
    expect(buildChatUrl('  ')).toBe('');
  });
});

describe('buildModelsUrl', () => {
  it('补全 models 路径', () => {
    expect(buildModelsUrl('https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/models',
    );
  });

  it('Anthropic 协议补全 /v1/models', () => {
    expect(buildModelsUrl('https://api.anthropic.com', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/models',
    );
  });
});

describe('batch 地址', () => {
  it('Anthropic 批量走 /v1/messages/batches', () => {
    expect(buildBatchUrl('https://api.anthropic.com', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/messages/batches',
    );
  });

  it('OpenAI 批量走 /batches', () => {
    expect(buildBatchUrl('https://api.openai.com/v1', 'openai')).toBe('https://api.openai.com/v1/batches');
  });

  it('已经写全批量路径时原样返回', () => {
    expect(buildBatchUrl('https://x.com/v1/batches', 'openai')).toBe('https://x.com/v1/batches');
  });

  it('文件上传地址补全 /files', () => {
    expect(buildFilesUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/files');
  });
});

describe('协议推断', () => {
  it('带 anthropic 的地址判为 Anthropic 协议', () => {
    expect(guessProtocol('https://api.deepseek.com/anthropic')).toBe('anthropic');
  });

  it('普通地址判为 OpenAI 协议', () => {
    expect(guessProtocol('https://api.deepseek.com/v1')).toBe('openai');
  });
});

describe('批量能力推断', () => {
  it('Anthropic 协议默认支持原生批量', () => {
    expect(batchSupportOf('anthropic', 'https://proxy.example.com')).toBe('anthropic');
  });

  it('未知的 OpenAI 兼容地址不支持原生批量', () => {
    expect(batchSupportOf('openai', 'https://proxy.example.com/v1')).toBe('none');
  });

  it('命中预设时以预设声明为准', () => {
    expect(batchSupportOf('openai', 'https://api.openai.com/v1')).toBe('openai');
    expect(batchSupportOf('openai', 'http://127.0.0.1:11434/v1')).toBe('none');
  });
});
