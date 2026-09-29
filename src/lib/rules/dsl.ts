/**
 * 后续处理语法解析器。
 *
 * 这是基础规则里「后续处理」所使用的迷你脚本语言，写在规则文本与 AI 返回的
 * postprocess 字段里。语法只支持 对象.方法(参数) 形式的语句，参数是字面量、
 * 对象与数组的组合，不包含变量、表达式与循环。
 *
 * 解析器完全自研，不使用 eval 或 new Function，因此规则文本无论写成什么样
 * 都不会触及宿主环境。
 */

export type DslValue = string | number | boolean | null | DslValue[] | { [key: string]: DslValue };

export interface DslStatement {
  target: string;
  method: string;
  args: DslValue[];
  line: number;
  source: string;
}

export class DslParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`第 ${line} 行第 ${column} 列：${message}`);
    this.name = 'DslParseError';
  }
}

interface Token {
  type: 'ident' | 'string' | 'number' | 'punct';
  value: string;
  line: number;
  column: number;
}

const PUNCT = ['(', ')', '{', '}', '[', ']', ',', ':', '.', ';'];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let column = 1;
  let index = 0;

  const push = (type: Token['type'], value: string, atLine: number, atColumn: number) => {
    tokens.push({ type, value, line: atLine, column: atColumn });
  };

  while (index < source.length) {
    const char = source[index] as string;

    if (char === '\n') {
      line += 1;
      column = 1;
      index += 1;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      index += 1;
      column += 1;
      continue;
    }
    // 注释：以 // 或 # 开头直到行尾
    if ((char === '/' && source[index + 1] === '/') || char === '#') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '“' || char === '”' || char === '‘' || char === '’') {
      const quote = char;
      const closing = quote === '“' ? '”' : quote === '‘' ? '’' : quote;
      const startLine = line;
      const startColumn = column;
      index += 1;
      column += 1;
      let value = '';
      let closed = false;
      while (index < source.length) {
        const current = source[index] as string;
        if (current === '\\' && index + 1 < source.length) {
          const next = source[index + 1] as string;
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          index += 2;
          column += 2;
          continue;
        }
        if (current === closing) {
          closed = true;
          index += 1;
          column += 1;
          break;
        }
        if (current === '\n') {
          line += 1;
          column = 1;
        } else {
          column += 1;
        }
        value += current;
        index += 1;
      }
      if (!closed) throw new DslParseError('字符串引号没有闭合', startLine, startColumn);
      push('string', value, startLine, startColumn);
      continue;
    }

    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(source[index + 1] ?? ''))) {
      const startLine = line;
      const startColumn = column;
      let value = '';
      while (index < source.length && /[0-9.\-]/.test(source[index] as string)) {
        value += source[index] as string;
        index += 1;
        column += 1;
      }
      push('number', value, startLine, startColumn);
      continue;
    }

    if (/[A-Za-z_\u4e00-\u9fff]/.test(char)) {
      const startLine = line;
      const startColumn = column;
      let value = '';
      // 点号是对象与方法的固定分隔符，不并入标识符
      while (index < source.length && /[A-Za-z0-9_\u4e00-\u9fff]/.test(source[index] as string)) {
        value += source[index] as string;
        index += 1;
        column += 1;
      }
      push('ident', value, startLine, startColumn);
      continue;
    }

    if (PUNCT.includes(char)) {
      push('punct', char, line, column);
      index += 1;
      column += 1;
      continue;
    }

    throw new DslParseError(`无法识别的字符 ${char}`, line, column);
  }

  return tokens;
}

class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private next(): Token {
    const token = this.tokens[this.position];
    if (!token) {
      // 语句被截断时，报出最后一个已知记号的位置，便于定位到具体行
      const last = this.tokens[this.tokens.length - 1];
      throw new DslParseError('语句不完整', last?.line ?? 1, last?.column ?? 1);
    }
    this.position += 1;
    return token;
  }

  private expect(value: string): Token {
    const token = this.next();
    if (token.type !== 'punct' || token.value !== value) {
      throw new DslParseError(`期望 ${value}，实际是 ${token.value}`, token.line, token.column);
    }
    return token;
  }

  private at(value: string): boolean {
    const token = this.peek();
    return Boolean(token && token.type === 'punct' && token.value === value);
  }

  private parseValue(): DslValue {
    const token = this.peek();
    if (!token) {
      const last = this.tokens[this.tokens.length - 1];
      throw new DslParseError('缺少参数', last?.line ?? 1, last?.column ?? 1);
    }
    if (token.type === 'punct' && token.value === '{') return this.parseObject();
    if (token.type === 'punct' && token.value === '[') return this.parseArray();
    if (token.type === 'string') {
      this.next();
      return token.value;
    }
    if (token.type === 'number') {
      this.next();
      const parsed = Number(token.value);
      if (!Number.isFinite(parsed)) {
        throw new DslParseError(`数字不合法：${token.value}`, token.line, token.column);
      }
      return parsed;
    }
    if (token.type === 'ident') {
      this.next();
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (token.value === 'null') return null;
      // 允许裸标识符当作字符串，降低模型写错引号的代价
      return token.value;
    }
    throw new DslParseError(`参数不合法：${token.value}`, token.line, token.column);
  }

  private parseObject(): { [key: string]: DslValue } {
    this.expect('{');
    const result: { [key: string]: DslValue } = {};
    if (this.at('}')) {
      this.next();
      return result;
    }
    while (true) {
      const keyToken = this.next();
      if (keyToken.type !== 'ident' && keyToken.type !== 'string') {
        throw new DslParseError('对象的键必须是名称或字符串', keyToken.line, keyToken.column);
      }
      this.expect(':');
      result[keyToken.value] = this.parseValue();
      if (this.at(',')) {
        this.next();
        if (this.at('}')) break;
        continue;
      }
      break;
    }
    this.expect('}');
    return result;
  }

  private parseArray(): DslValue[] {
    this.expect('[');
    const result: DslValue[] = [];
    if (this.at(']')) {
      this.next();
      return result;
    }
    while (true) {
      result.push(this.parseValue());
      if (this.at(',')) {
        this.next();
        if (this.at(']')) break;
        continue;
      }
      break;
    }
    this.expect(']');
    return result;
  }

  parseProgram(): DslStatement[] {
    const statements: DslStatement[] = [];
    while (this.peek()) {
      // 语句之间允许用换行或分号分隔，分词阶段已经丢掉空白
      if (this.at(';')) {
        this.next();
        continue;
      }
      statements.push(this.parseStatement());
      if (this.at(';')) this.next();
    }
    return statements;
  }

  private parseStatement(): DslStatement {
    const start = this.peek();
    if (!start) throw new DslParseError('空语句', 0, 0);
    const targetToken = this.next();
    if (targetToken.type !== 'ident') {
      throw new DslParseError('语句必须以对象名开头，例如 chara.add(...)', targetToken.line, targetToken.column);
    }
    const dot = this.next();
    if (dot.type !== 'punct' || dot.value !== '.') {
      throw new DslParseError('对象名之后需要跟一个点号', dot.line, dot.column);
    }
    const methodToken = this.next();
    if (methodToken.type !== 'ident') {
      throw new DslParseError('点号之后需要跟方法名', methodToken.line, methodToken.column);
    }
    this.expect('(');
    const args: DslValue[] = [];
    if (!this.at(')')) {
      while (true) {
        args.push(this.parseValue());
        if (this.at(',')) {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expect(')');
    const lineText = `${targetToken.value}.${methodToken.value}`;
    return {
      target: targetToken.value,
      method: methodToken.value,
      args,
      line: start.line,
      source: lineText,
    };
  }
}

/** 解析整段后续处理脚本。解析失败时抛出带行列信息的错误。 */
export function parseDsl(source: string): DslStatement[] {
  const cleaned = stripCodeFence(source ?? '');
  if (!cleaned.trim()) return [];
  const tokens = tokenize(cleaned);
  return new Parser(tokens).parseProgram();
}

/** 去掉模型偶尔带上的代码块围栏与语言标记。 */
export function stripCodeFence(source: string): string {
  const trimmed = source.trim();
  const match = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  if (match?.[1] !== undefined) return match[1];
  return source;
}

/** 把解析结果转成可读的参数描述，用于日志与界面展示。 */
export function describeArguments(args: DslValue[]): string {
  const format = (value: DslValue): string => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `[${value.map(format).join(', ')}]`;
    if (typeof value === 'object') {
      return `{ ${Object.entries(value)
        .map(([key, item]) => `${key}: ${format(item)}`)
        .join(', ')} }`;
    }
    if (typeof value === 'string') return `"${value}"`;
    return String(value);
  };
  return args.map(format).join(', ');
}
