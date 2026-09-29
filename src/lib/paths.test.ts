import { describe, expect, it } from 'vitest';

import { isDraftIndex, nextDraftIndex, parseChapterRef, chapterRef, safeFileName, DRAFT_INDEX_BASE } from './paths';

/** 路径与文件名的安全构造测试。 */

describe('safeFileName', () => {
  it('保留中文与常规标点', () => {
    expect(safeFileName('张三·青云传')).toBe('张三·青云传');
  });

  it('替换系统不允许的字符', () => {
    expect(safeFileName('a/b\\c:d*e?f')).toBe('a_b_c_d_e_f');
  });

  it('去掉结尾的点与空格', () => {
    expect(safeFileName('名字... ')).toBe('名字');
  });

  it('Windows 保留名加下划线', () => {
    expect(safeFileName('con')).toBe('con_');
    expect(safeFileName('NUL')).toBe('NUL_');
  });

  it('空名称使用兜底值', () => {
    expect(safeFileName('   ', 'rule')).toBe('rule');
  });
});

describe('chapterRef', () => {
  it('往返转换保持一致', () => {
    const ref = chapterRef(2, 17);
    expect(ref).toBe('2:17');
    expect(parseChapterRef(ref)).toEqual({ volIndex: 2, indexNo: 17 });
  });

  it('非法引用抛出异常', () => {
    expect(() => parseChapterRef('abc')).toThrow();
  });
});

describe('draft index', () => {
  it('负数区段被识别为废稿', () => {
    expect(isDraftIndex(12)).toBe(false);
    expect(isDraftIndex(DRAFT_INDEX_BASE)).toBe(true);
    expect(isDraftIndex(-100005)).toBe(true);
  });

  it('下一个废稿序号在已有最小值之前', () => {
    expect(nextDraftIndex([])).toBe(DRAFT_INDEX_BASE - 1);
    expect(nextDraftIndex([-100003, -100001])).toBe(-100004);
  });
});
