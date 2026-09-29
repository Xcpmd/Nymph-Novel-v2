import path from 'node:path';

/**
 * 路径规划。
 *
 * 所有小说数据都存放在项目根目录下的 novel/ 内，每部小说一个独立目录，
 * 互不影响。数据库等结构化数据放在 data/ 内。
 */

/** 正式章节与废稿区的分界线，序号小于等于该值的章节属于废稿。 */
export const DRAFT_INDEX_BASE = -100000;

/** 废稿章节所在的卷目录。 */
export const DRAFT_VOLUME_INDEX = 0;

export const projectRoot = process.cwd();
export const novelRoot = path.join(projectRoot, 'novel');
export const dataRoot = path.join(projectRoot, 'data');
export const dbFile = path.join(dataRoot, 'nymph.db');
export const secretFile = path.join(dataRoot, 'secret.key');
export const workspaceDir = path.join(dataRoot, 'workspace');
export const exportDir = path.join(dataRoot, 'exports');

/** 小说 id 由时间戳与随机串组成，只允许小写字母、数字与连字符。 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function assertNovelId(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`非法的小说标识：${id}`);
  }
  return id;
}

export function novelDir(novelId: string): string {
  return path.join(novelRoot, assertNovelId(novelId));
}

export function coverFile(novelId: string): string {
  return path.join(novelDir(novelId), 'cover.png');
}

export function settingDir(novelId: string): string {
  return path.join(novelDir(novelId), 'setting');
}

export function volsDir(novelId: string): string {
  return path.join(novelDir(novelId), 'vols');
}

export function volDirName(volIndex: number): string {
  return `vol-${String(volIndex).padStart(3, '0')}`;
}

export function volDir(novelId: string, volIndex: number): string {
  return path.join(volsDir(novelId), volDirName(volIndex));
}

/** 章节文件：每章一个 Markdown 文件，文件名即章节序号。 */
export function chapterFile(novelId: string, volIndex: number, indexNo: number): string {
  return path.join(volDir(novelId, volIndex), `${indexNo}.md`);
}

export function charaDir(novelId: string): string {
  return path.join(novelDir(novelId), 'data', 'chara');
}

export function charaFile(novelId: string, name: string): string {
  return path.join(charaDir(novelId), `${safeFileName(name)}.md`);
}

/** 自动分配 id 的通用条目目录。 */
export function baseDir(novelId: string): string {
  return path.join(novelDir(novelId), 'data', 'base');
}

export function baseFile(novelId: string, id: string): string {
  return path.join(baseDir(novelId), `${safeFileName(id)}.md`);
}

/** 章节引用格式为 volIndex:indexNo，例如 1:12。 */
export function chapterRef(volIndex: number, indexNo: number): string {
  return `${volIndex}:${indexNo}`;
}

export function parseChapterRef(ref: string): { volIndex: number; indexNo: number } {
  const [volPart, indexPart] = ref.split(':');
  const volIndex = Number(volPart);
  const indexNo = Number(indexPart);
  if (!Number.isFinite(volIndex) || !Number.isFinite(indexNo)) {
    throw new Error(`非法的章节引用：${ref}`);
  }
  return { volIndex, indexNo };
}

/** Windows 与 POSIX 下都不可用于文件名的字符。 */
const INVALID_FILE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Windows 保留设备名，作为文件名会导致创建失败。 */
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/**
 * 把用户填写的名称转成安全的文件名。
 * 中文与常规标点保留，只替换系统不允许的字符，并去掉结尾的点与空格。
 */
export function safeFileName(name: string, fallback = 'unnamed'): string {
  let result = name.replace(INVALID_FILE_CHARS, '_').trim();
  result = result.replace(/[. ]+$/, '');
  result = result.replace(/^\.+/, '');
  if (!result) return fallback;
  if (RESERVED_NAMES.has(result.toLowerCase())) return `${result}_`;
  if (result.length > 96) result = result.slice(0, 96);
  return result;
}

export function isDraftIndex(indexNo: number): boolean {
  return indexNo <= DRAFT_INDEX_BASE;
}

/** 由正式章节数量推导下一个可用的废稿序号。 */
export function nextDraftIndex(existing: number[]): number {
  const drafts = existing.filter(isDraftIndex);
  if (drafts.length === 0) return DRAFT_INDEX_BASE - 1;
  return Math.min(...drafts) - 1;
}
