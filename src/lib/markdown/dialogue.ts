/**
 * 对话识别。
 *
 * 网文里的角色发言通常用「」『』“”或半角双引号包裹。
 * 这里把一段文本切分成普通叙述与对话两类，供渲染层高亮使用。
 */

/** 常见的中英文引号对。 */
const DIALOGUE_PATTERN = /(「[^」\n]*」|『[^』\n]*』|“[^”\n]*”|"[^"\n]*")/g;

export interface TextPart {
  text: string;
  dialogue: boolean;
}

export function splitDialogue(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let lastIndex = 0;
  DIALOGUE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DIALOGUE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), dialogue: false });
    }
    parts.push({ text: match[0], dialogue: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), dialogue: false });
  return parts;
}

export { DIALOGUE_PATTERN };
