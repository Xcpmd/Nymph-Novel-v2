import { notFound } from 'next/navigation';

import { ReaderClient } from '@/components/novel/ReaderClient';
import { getChapterByRef, listChapters, rescanChapters } from '@/lib/store/chapters';
import { getNovel } from '@/lib/store/novels';
import { isBookmarked } from '@/lib/store/tags';

export const dynamic = 'force-dynamic';

/** 阅读器。目录与首章正文由服务端取好，切换章节时再按需请求。 */
export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ novelId: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { novelId } = await params;
  const { ref } = await searchParams;
  const novel = getNovel(novelId);
  if (!novel) notFound();

  rescanChapters(novelId);
  const chapters = listChapters(novelId);
  const formal = chapters.filter((chapter) => !chapter.isDraft);
  const target = formal.find((chapter) => chapter.ref === ref) ?? formal[0];
  const detail = target ? (getChapterByRef(novelId, target.ref) ?? null) : null;
  const bookmarked = target ? isBookmarked(novelId, target.ref) : false;

  return <ReaderClient novel={novel} initial={{ chapters, detail, bookmarked }} />;
}
