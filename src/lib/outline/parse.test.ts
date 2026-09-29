import { describe, expect, it } from 'vitest';

import { parseOutlineText, renderOutlineText, titleFromOutline } from './parse';

/** 大纲文本解析测试，前后端共用同一份实现。 */

describe('parseOutlineText', () => {
  it('解析「第N章 内容」形式', () => {
    const lines = parseOutlineText('第1章 雨夜破壳\n第2章 第一次对话');
    expect(lines).toEqual([
      { indexNo: 1, content: '雨夜破壳' },
      { indexNo: 2, content: '第一次对话' },
    ]);
  });

  it('兼容多种序号写法', () => {
    const text = ['12 直接写序号', '第13章 带章字', '14. 带点号', '15、带顿号'].join('\n');
    expect(parseOutlineText(text).map((line) => line.indexNo)).toEqual([12, 13, 14, 15]);
  });

  it('没有序号的续行并入上一条', () => {
    const lines = parseOutlineText('第1章 开头\n补充说明\n第2章 后续');
    expect(lines[0]?.content).toBe('开头 补充说明');
    expect(lines).toHaveLength(2);
  });

  it('忽略空行', () => {
    expect(parseOutlineText('\n\n第1章 甲\n\n')).toHaveLength(1);
  });

  it('空文本返回空数组', () => {
    expect(parseOutlineText('')).toEqual([]);
  });
});

describe('titleFromOutline', () => {
  it('取冒号前的标题部分', () => {
    expect(titleFromOutline('雨夜破壳：牧云捡到一枚蛋', 1)).toBe('第1章 雨夜破壳');
  });

  it('内容过长时退回序号标题', () => {
    expect(titleFromOutline('一二三四五六七八九十一二三四五六七八九十一二三四五', 3)).toBe('第3章');
  });

  it('内容为空时退回序号标题', () => {
    expect(titleFromOutline('', 3)).toBe('第3章');
  });

  it('已经带「第X章」时原样保留', () => {
    expect(titleFromOutline('第5章 入宗试炼', 5)).toBe('第5章 入宗试炼');
  });
});

describe('renderOutlineText', () => {
  it('渲染成每章一行的文本', () => {
    const text = renderOutlineText([
      { indexNo: 1, content: '甲' },
      { indexNo: 2, content: '乙' },
    ]);
    expect(text).toBe('第1章 甲\n第2章 乙');
  });

  it('解析与渲染可以往返', () => {
    const text = '第1章 甲\n第2章 乙';
    expect(renderOutlineText(parseOutlineText(text))).toBe(text);
  });
});
