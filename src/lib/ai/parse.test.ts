import { describe, expect, it } from 'vitest';

import { createContentExtractor, extractBalancedObjects, parseAiResponse } from './parse';

/** AI 返回内容的解析测试。 */

describe('parseAiResponse', () => {
  it('直接解析标准 JSON', () => {
    const raw = JSON.stringify({
      title: '第12章 雨夜',
      summary: '主角在雨夜捡到一枚蛋',
      content: '雨下了一整夜。\n\n「这不是石头。」',
      tags: ['转折'],
    });
    const result = parseAiResponse(raw);
    expect(result.strategy).toBe('json');
    expect(result.payload.title).toBe('雨夜');
    expect(result.payload.content).toContain('雨下了一整夜');
    expect(result.payload.tags).toEqual(['转折']);
  });

  it('解析带代码块围栏的 JSON', () => {
    const result = parseAiResponse('```json\n{"content":"正文"}\n```');
    expect(result.strategy).toBe('fenced');
    expect(result.payload.content).toBe('正文');
  });

  it('解析夹在解释文字中的 JSON', () => {
    const raw = '好的，以下是本章内容：\n{"content":"正文","postprocess":["chara.add({ name: \\"甲\\" })"]}\n希望有帮助。';
    const result = parseAiResponse(raw);
    expect(result.strategy).toBe('balanced');
    expect(result.payload.content).toBe('正文');
    expect(result.payload.postprocess).toEqual(['chara.add({ name: "甲" })']);
  });

  it('完全没有 JSON 时把整段当作正文', () => {
    const result = parseAiResponse('雨下了一整夜。');
    expect(result.strategy).toBe('plain');
    expect(result.payload.content).toBe('雨下了一整夜。');
  });

  it('规范化角色与百科字段', () => {
    const raw = JSON.stringify({
      content: '正文',
      characters: [{ name: '张三', role: 'protagonist', aliases: '阿三' }, { role: 'major' }],
      encyclopedia: [{ title: '青云山', category: 'place' }, { summary: '缺少标题' }],
      relations: [{ from: '张三', to: '李四', strength: 3 }],
    });
    const result = parseAiResponse(raw);
    expect(result.payload.characters).toHaveLength(1);
    expect(result.payload.characters?.[0]?.role).toBe('protagonist');
    expect(result.payload.characters?.[0]?.aliases).toEqual(['阿三']);
    expect(result.payload.encyclopedia).toHaveLength(1);
    expect(result.payload.relations?.[0]?.strength).toBe(1);
  });
});

describe('extractBalancedObjects', () => {
  it('取出平衡的对象片段并按长度排序', () => {
    const objects = extractBalancedObjects('a {"x":1} b {"y":{"z":2}}');
    expect(objects[0]).toBe('{"y":{"z":2}}');
    expect(objects[1]).toBe('{"x":1}');
  });

  it('忽略字符串里的花括号', () => {
    const objects = extractBalancedObjects('{"text":"包含 } 与 { 的字符串"}');
    expect(objects).toHaveLength(1);
  });
});

describe('createContentExtractor', () => {
  it('按增量输出正文', () => {
    const extract = createContentExtractor();
    expect(extract('{"title":"甲","content":"雨下')).toBe('雨下');
    expect(extract('{"title":"甲","content":"雨下了一夜')).toBe('了一夜');
    expect(extract('{"title":"甲","content":"雨下了一夜","tags":[]}')).toBe('');
  });

  it('正确还原转义字符', () => {
    const extract = createContentExtractor();
    expect(extract('{"content":"第一行\\n第二行"}')).toBe('第一行\n第二行');
  });

  it('没有 content 字段时不输出内容', () => {
    const extract = createContentExtractor();
    expect(extract('{"summary":"还没有正文"}')).toBe('');
  });
});
