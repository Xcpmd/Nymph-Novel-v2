import { describe, expect, it } from 'vitest';

import { describeArguments, parseDsl, stripCodeFence, DslParseError } from './dsl';

/** 后续处理语法的解析测试，覆盖正常写法与常见错误。 */

describe('parseDsl', () => {
  it('解析带对象参数的语句', () => {
    const statements = parseDsl('chara.add({ name: "李四", role: "major", age: 18, alive: true })');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ target: 'chara', method: 'add' });
    expect(statements[0]?.args[0]).toEqual({ name: '李四', role: 'major', age: 18, alive: true });
  });

  it('解析多行脚本与注释', () => {
    const script = [
      '// 本章补全角色',
      'chara.add({ name: "青云子" })',
      'relation.add({ from: "张三", to: "青云子", label: "师徒" })',
      '# 再补一条百科',
      'wiki.add({ title: "青云山", category: "place" })',
    ].join('\n');
    const statements = parseDsl(script);
    expect(statements.map((item) => `${item.target}.${item.method}`)).toEqual([
      'chara.add',
      'relation.add',
      'wiki.add',
    ]);
    expect(statements[0]?.line).toBe(2);
  });

  it('支持字符串数组与数字参数', () => {
    const statements = parseDsl('tag.add("1:12", "转折")');
    expect(statements[0]?.args).toEqual(['1:12', '转折']);
  });

  it('兼容中文引号与裸标识符', () => {
    const statements = parseDsl('chara.update("张三", { personality: “外冷内热”, role: major })');
    expect(statements[0]?.args[1]).toEqual({ personality: '外冷内热', role: 'major' });
  });

  it('允许末尾分号', () => {
    const statements = parseDsl('log.note("完成");\nlog.note("收尾");');
    expect(statements).toHaveLength(2);
  });

  it('遇到语法错误时抛出带行列信息的异常', () => {
    expect(() => parseDsl('chara.add({ name: "李四" ')).toThrow(DslParseError);
    try {
      parseDsl('chara.add({ name: "李四" ');
    } catch (error) {
      expect((error as DslParseError).message).toContain('第 1 行');
    }
  });

  it('拒绝带点号的对象名以外的表达式', () => {
    expect(() => parseDsl('1 + 2')).toThrow(DslParseError);
  });

  it('空脚本返回空数组', () => {
    expect(parseDsl('')).toEqual([]);
    expect(parseDsl('   \n  ')).toEqual([]);
  });
});

describe('stripCodeFence', () => {
  it('去掉 markdown 代码块围栏', () => {
    expect(stripCodeFence('```js\nchara.add({})\n```')).toBe('chara.add({})');
  });

  it('没有围栏时原样返回', () => {
    expect(stripCodeFence('chara.add({})')).toBe('chara.add({})');
  });
});

describe('describeArguments', () => {
  it('把参数转成可读文本', () => {
    const [statement] = parseDsl('chara.add({ name: "李四", tags: ["甲", "乙"] })');
    expect(describeArguments(statement?.args ?? [])).toBe('{ name: "李四", tags: ["甲", "乙"] }');
  });
});
