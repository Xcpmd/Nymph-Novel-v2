import { describe, expect, it } from 'vitest';

import { isSameOrder, moveInOrder, nudgeInOrder, renumberTitle, type OrderedChapter } from './order';

/** 章节拖拽排序的纯逻辑测试。 */

const list: OrderedChapter[] = [
  { ref: '1:1', volIndex: 1 },
  { ref: '1:2', volIndex: 1 },
  { ref: '1:3', volIndex: 1 },
  { ref: '2:4', volIndex: 2 },
];

describe('moveInOrder', () => {
  it('插到目标章节之前', () => {
    const next = moveInOrder(list, '1:3', '1:1', 1);
    expect(next.map((item) => item.ref)).toEqual(['1:3', '1:1', '1:2', '2:4']);
  });

  it('插到列表末尾', () => {
    const next = moveInOrder(list, '1:1', null, 2);
    expect(next.map((item) => item.ref)).toEqual(['1:2', '1:3', '2:4', '1:1']);
    expect(next[3]?.volIndex).toBe(2);
  });

  it('跨卷拖动时更换所属卷', () => {
    const next = moveInOrder(list, '1:1', '2:4', 2);
    expect(next.map((item) => item.ref)).toEqual(['1:2', '1:3', '1:1', '2:4']);
    expect(next[2]?.volIndex).toBe(2);
  });

  it('目标不存在时退化为放到末尾', () => {
    const next = moveInOrder(list, '1:1', 'missing', 1);
    expect(next[next.length - 1]?.ref).toBe('1:1');
  });

  it('ref 不存在时原样返回', () => {
    expect(moveInOrder(list, 'missing', '1:1', 1)).toBe(list);
  });

  it('不修改传入的数组', () => {
    const copy = list.map((item) => ({ ...item }));
    moveInOrder(list, '1:3', '1:1', 1);
    expect(list).toEqual(copy);
  });
});

describe('nudgeInOrder', () => {
  it('上移一格', () => {
    expect(nudgeInOrder(list, '1:2', -1).map((item) => item.ref)).toEqual(['1:2', '1:1', '1:3', '2:4']);
  });

  it('下移一格', () => {
    expect(nudgeInOrder(list, '1:2', 1).map((item) => item.ref)).toEqual(['1:1', '1:3', '1:2', '2:4']);
  });

  it('越过卷边界时换成目标章节的卷', () => {
    const next = nudgeInOrder(list, '1:3', 1);
    expect(next.map((item) => item.ref)).toEqual(['1:1', '1:2', '2:4', '1:3']);
    expect(next[3]?.volIndex).toBe(2);
  });

  it('已在边界时原样返回', () => {
    expect(nudgeInOrder(list, '1:1', -1)).toBe(list);
    expect(nudgeInOrder(list, '2:4', 1)).toBe(list);
  });
});

describe('isSameOrder', () => {
  it('顺序与卷都一致时判定为相同', () => {
    expect(isSameOrder(list, list.map((item) => ({ ...item })))).toBe(true);
  });

  it('顺序变化时判定为不同', () => {
    expect(isSameOrder(list, moveInOrder(list, '1:1', null, 1))).toBe(false);
  });

  it('只有卷变化时也判定为不同', () => {
    const changed = list.map((item, index) => (index === 0 ? { ...item, volIndex: 2 } : { ...item }));
    expect(isSameOrder(list, changed)).toBe(false);
  });
});

describe('renumberTitle', () => {
  it('改写阿拉伯数字序号', () => {
    expect(renumberTitle('第3章 丙', 1)).toBe('第1章 丙');
  });

  it('改写中文数字序号', () => {
    expect(renumberTitle('第三章 丙', 12)).toBe('第12章 丙');
  });

  it('保留用户自己起的章节名', () => {
    expect(renumberTitle('第2章 雨夜破壳', 7)).toBe('第7章 雨夜破壳');
  });

  it('没有序号前缀时原样返回', () => {
    expect(renumberTitle('雨夜破壳', 7)).toBe('雨夜破壳');
  });

  it('只有序号时保留序号', () => {
    expect(renumberTitle('第5章', 2)).toBe('第2章');
  });

  it('空标题回退为序号标题', () => {
    expect(renumberTitle('   ', 4)).toBe('第4章');
  });

  it('标题中间出现的「第X章」不受影响', () => {
    expect(renumberTitle('回望第3章的那场雨', 9)).toBe('回望第3章的那场雨');
  });
});
