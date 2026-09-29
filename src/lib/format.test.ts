import { describe, expect, it } from 'vitest';

import { chineseNumber, chapterLabel, defaultChapterTitle, estimateTokens, snippetAround, truncate } from './format';

/** 展示层格式化的单元测试。 */

describe('chineseNumber', () => {
  it('十以内的数字', () => {
    expect(chineseNumber(1)).toBe('一');
    expect(chineseNumber(9)).toBe('九');
  });

  it('十几与整十', () => {
    expect(chineseNumber(10)).toBe('十');
    expect(chineseNumber(11)).toBe('十一');
    expect(chineseNumber(20)).toBe('二十');
  });

  it('百位以上', () => {
    expect(chineseNumber(101)).toBe('一百零一');
    expect(chineseNumber(120)).toBe('一百二十');
    expect(chineseNumber(999)).toBe('九百九十九');
  });
});

describe('chapterLabel', () => {
  it('已有「第 X 章」前缀时不重复添加', () => {
    expect(chapterLabel(3, '第3章 雨夜')).toBe('第3章 雨夜');
  });

  it('只有标题时补上序号', () => {
    expect(chapterLabel(3, '雨夜')).toBe('第三章 雨夜');
  });

  it('没有标题时只输出序号', () => {
    expect(chapterLabel(3, '')).toBe('第三章');
  });

  it('废稿章节单独标识', () => {
    expect(chapterLabel(-100001, '残稿')).toBe('废稿 残稿');
  });
});

describe('defaultChapterTitle', () => {
  it('生成中文序号标题', () => {
    expect(defaultChapterTitle(12)).toBe('第十二章');
  });
});

describe('estimateTokens', () => {
  it('中文按字符近似', () => {
    expect(estimateTokens('我的小说')).toBe(4);
  });

  it('英文按四字符一个 token', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('空串为零', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('truncate 与 snippetAround', () => {
  it('超长文本截断并加省略号', () => {
    const text = '一'.repeat(100);
    expect(truncate(text, 10)).toBe(`${'一'.repeat(10)}…`);
  });

  it('命中关键词时截取上下文', () => {
    const content = `${'前'.repeat(50)}关键词${'后'.repeat(50)}`;
    const snippet = snippetAround(content, '关键词', 5);
    expect(snippet).toContain('关键词');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
