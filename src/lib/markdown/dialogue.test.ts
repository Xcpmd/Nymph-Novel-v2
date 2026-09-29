import { describe, expect, it } from 'vitest';

import { splitDialogue } from './dialogue';

/** 对话识别的单元测试，验证引号内的角色发言能被单独标出。 */

describe('splitDialogue', () => {
  it('识别直角引号内的发言', () => {
    const parts = splitDialogue('他抬起头。「这不是石头。」');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ text: '他抬起头。', dialogue: false });
    expect(parts[1]).toEqual({ text: '「这不是石头。」', dialogue: true });
  });

  it('识别中文弯引号', () => {
    const parts = splitDialogue('她说：“走吧。”');
    expect(parts.filter((part) => part.dialogue)).toHaveLength(1);
  });

  it('识别直角双引号与半角引号', () => {
    const parts = splitDialogue('『快走』 then "run"');
    expect(parts.filter((part) => part.dialogue).map((part) => part.text)).toEqual(['『快走』', '"run"']);
  });

  it('多段对话全部标记', () => {
    const parts = splitDialogue('「甲」「乙」');
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.dialogue)).toBe(true);
  });

  it('没有引号时原样返回', () => {
    const parts = splitDialogue('雨下了一整夜。');
    expect(parts).toEqual([{ text: '雨下了一整夜。', dialogue: false }]);
  });
});
