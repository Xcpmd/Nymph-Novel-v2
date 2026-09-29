/** 把模型返回的 JSON 草稿解析成数组。容忍代码块围栏与前后解释文字。 */
export function parseDrafts(text: string): unknown[] | null {
  const cleaned = text
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
  const candidate = cleaned.startsWith('[')
    ? cleaned
    : (cleaned.match(/\[[\s\S]*\]/)?.[0] ?? cleaned);
  try {
    const parsed: unknown = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
