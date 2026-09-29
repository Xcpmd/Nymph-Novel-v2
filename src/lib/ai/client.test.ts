import { describe, expect, it } from 'vitest';

import { normalizeAnthropicMessages } from './client';

/** Anthropic 消息体整理：system 提到顶层，角色必须交替且首条为 user。 */

describe('normalizeAnthropicMessages', () => {
  it('把 system 提到顶层', () => {
    const result = normalizeAnthropicMessages([
      { role: 'system', content: '你是编辑' },
      { role: 'user', content: '写第一章' },
    ]);
    expect(result.system).toBe('你是编辑');
    expect(result.messages).toEqual([{ role: 'user', content: '写第一章' }]);
  });

  it('把作为风格前缀的 assistant 消息并入 system', () => {
    const result = normalizeAnthropicMessages([
      { role: 'system', content: '你是编辑' },
      { role: 'assistant', content: '文风要求：短句为主' },
      { role: 'user', content: '写第一章' },
    ]);
    expect(result.system).toBe('你是编辑\n\n文风要求：短句为主');
    expect(result.messages).toEqual([{ role: 'user', content: '写第一章' }]);
  });

  it('合并连续的同类消息', () => {
    const result = normalizeAnthropicMessages([
      { role: 'user', content: '甲' },
      { role: 'user', content: '乙' },
      { role: 'assistant', content: '丙' },
      { role: 'assistant', content: '丁' },
      { role: 'user', content: '戊' },
    ]);
    expect(result.messages).toEqual([
      { role: 'user', content: '甲\n\n乙' },
      { role: 'assistant', content: '丙\n\n丁' },
      { role: 'user', content: '戊' },
    ]);
  });

  it('保留结尾的 assistant 前缀，用于续写', () => {
    const result = normalizeAnthropicMessages([
      { role: 'user', content: '写第一章' },
      { role: 'assistant', content: '已经写好的开头' },
      { role: 'user', content: '继续' },
    ]);
    expect(result.messages[1]).toEqual({ role: 'assistant', content: '已经写好的开头' });
    expect(result.messages).toHaveLength(3);
  });

  it('跳过空内容', () => {
    const result = normalizeAnthropicMessages([
      { role: 'system', content: '   ' },
      { role: 'user', content: '甲' },
      { role: 'assistant', content: '' },
    ]);
    expect(result.system).toBe('');
    expect(result.messages).toEqual([{ role: 'user', content: '甲' }]);
  });

  it('全是 system 时返回空消息列表', () => {
    const result = normalizeAnthropicMessages([{ role: 'system', content: '只有系统提示' }]);
    expect(result.system).toBe('只有系统提示');
    expect(result.messages).toEqual([]);
  });
});
