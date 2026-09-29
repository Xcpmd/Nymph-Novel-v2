/**
 * 大纲文本解析。
 *
 * 每章一行，行首写章节序号。这一层是纯函数，前端编辑时用它实时预览拆分结果，
 * 服务端保存时用同一份实现，避免两边规则不一致。
 */

export interface OutlineParsedLine {
  indexNo: number;
  content: string;
}

/** 行首允许写成「12 内容」「第12章 内容」「12. 内容」「12、内容」等形式。 */
const LINE_PATTERN = /^\s*(?:第\s*)?(\d{1,5})\s*(?:章|节|[:.、）)]|\s)\s*(.*)$/;

/** 把整段大纲文本解析成章节行。没有序号的续行会并入上一条。 */
export function parseOutlineText(text: string): OutlineParsedLine[] {
  const result: OutlineParsedLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = LINE_PATTERN.exec(line);
    if (match) {
      result.push({ indexNo: Number(match[1]), content: (match[2] ?? '').trim() });
      continue;
    }
    const last = result[result.length - 1];
    if (last) last.content = `${last.content} ${line}`.trim();
  }
  return result;
}

/**
 * 由大纲行内容推导章节标题。
 * 内容通常写成「标题：描述」，取冒号前的部分；过长或不含标题时退回序号标题。
 */
export function titleFromOutline(content: string, indexNo: number): string {
  const head = content.split(/[：:，,。；;（(]/)[0]?.trim() ?? '';
  if (!head || head.length > 24) return `第${indexNo}章`;
  return head.startsWith('第') ? head : `第${indexNo}章 ${head}`;
}

/** 渲染成可编辑文本。 */
export function renderOutlineText(lines: OutlineParsedLine[]): string {
  return lines.map((line) => `第${line.indexNo}章 ${line.content}`).join('\n');
}
