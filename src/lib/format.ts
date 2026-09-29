/** 展示层使用的纯格式化工具，不依赖数据库与文件系统。 */

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 把序号转成中文数字，用于卷名与章节名的默认取值。 */
export function chineseNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 0) return String(value);
  if (value < 10) return CN_DIGITS[value] as string;
  if (value < 20) return value === 10 ? '十' : `十${CN_DIGITS[value - 10]}`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${CN_DIGITS[tens]}十${ones === 0 ? '' : CN_DIGITS[ones]}`;
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    if (rest === 0) return `${CN_DIGITS[hundreds]}百`;
    if (rest < 10) return `${CN_DIGITS[hundreds]}百零${CN_DIGITS[rest]}`;
    return `${CN_DIGITS[hundreds]}百${chineseNumber(rest)}`;
  }
  return String(value);
}

export function defaultVolumeTitle(volIndex: number): string {
  return `第${chineseNumber(volIndex)}卷`;
}

export function defaultChapterTitle(indexNo: number): string {
  return `第${chineseNumber(indexNo)}章`;
}

/** 章节在界面上的完整标题。 */
export function chapterLabel(indexNo: number, title: string): string {
  if (indexNo <= -100000) return `废稿 ${title || '未命名'}`;
  if (!title) return defaultChapterTitle(indexNo);
  if (title.startsWith('第')) return title;
  return `第${chineseNumber(indexNo)}章 ${title}`;
}

export function truncate(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

/** 从长文中截取关键词附近的片段，用于检索结果预览。 */
export function snippetAround(content: string, keyword: string, radius = 40): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const index = flat.indexOf(keyword);
  if (index < 0) return truncate(flat, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(flat.length, index + keyword.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 相对时间，用于「几分钟前保存」这类提示。 */
export function formatRelative(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return formatDateTime(iso);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value));
}

/** 粗略 token 估算：中日韩字符按 1 个计，其余按 4 个字符 1 个计。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}
