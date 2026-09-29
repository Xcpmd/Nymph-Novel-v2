/**
 * 章节排序的纯逻辑。
 *
 * 章节的序号就是它在列表里的位置，因此「拖动」被表达成
 * 「从列表里取出一个元素，再插到某个位置」，目标位置上的章节所属的卷
 * 会成为被拖动章节的新卷。这一层不碰数据库与文件系统，便于单测覆盖。
 */

export interface OrderedChapter {
  ref: string;
  volIndex: number;
}

/** 把 ref 对应的章节插到 targetRef 之前；targetRef 为空表示放到最后。 */
export function moveInOrder<T extends OrderedChapter>(
  list: T[],
  ref: string,
  targetRef: string | null,
  targetVolIndex: number,
): T[] {
  const dragged = list.find((item) => item.ref === ref);
  if (!dragged) return list;
  const next = list.filter((item) => item.ref !== ref).map((item) => ({ ...item }));
  const moved = { ...dragged, volIndex: targetVolIndex };
  if (targetRef === null) {
    next.push(moved);
  } else {
    const index = next.findIndex((item) => item.ref === targetRef);
    next.splice(index < 0 ? next.length : index, 0, moved);
  }
  return next;
}

/** 上下移动一格；跨越卷边界时采用目标章节所在的卷。 */
export function nudgeInOrder<T extends OrderedChapter>(list: T[], ref: string, delta: number): T[] {
  const index = list.findIndex((item) => item.ref === ref);
  const target = list[index + delta];
  const dragged = list[index];
  if (index < 0 || !target || !dragged) return list;
  const next = list.filter((item) => item.ref !== ref).map((item) => ({ ...item }));
  next.splice(index + delta, 0, { ...dragged, volIndex: target.volIndex });
  return next;
}

/** 判断两次排序是否等价，用于跳过没有实际变化的提交。 */
export function isSameOrder(a: OrderedChapter[], b: OrderedChapter[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, index) => item.ref === b[index]?.ref && item.volIndex === b[index]?.volIndex,
  );
}

/** 标题里的章节序号前缀，中文数字与阿拉伯数字都要认。 */
const TITLE_INDEX_PATTERN = /^(第\s*[0-9一二三四五六七八九十百千零两]+\s*章)\s*/;

/**
 * 重排之后把标题里的章节序号对齐到新位置。
 * 只改序号前缀，用户自己起的章节名保持不动；没有序号前缀的标题原样返回。
 */
export function renumberTitle(title: string, indexNo: number): string {
  const trimmed = title.trim();
  if (!trimmed) return `第${indexNo}章`;
  const match = TITLE_INDEX_PATTERN.exec(trimmed);
  if (!match) return trimmed;
  const rest = trimmed.slice(match[0].length).trim();
  return rest ? `第${indexNo}章 ${rest}` : `第${indexNo}章`;
}
