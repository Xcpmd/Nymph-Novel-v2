import { notFound } from 'next/navigation';

import { SearchClient } from '@/components/novel/SearchClient';
import { listChapters, listVolumes, rescanChapters } from '@/lib/store/chapters';
import { getNovel } from '@/lib/store/novels';
import { listBookmarks, listTags } from '@/lib/store/tags';

export const dynamic = 'force-dynamic';

/** 检索页。目录、标签与书签在服务端备好，检索本身由接口在服务端执行。 */
export default async function SearchPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();
  rescanChapters(novelId);
  return (
    <SearchClient
      novel={novel}
      initial={{
        tags: listTags(novelId),
        bookmarks: listBookmarks(novelId),
        chapters: listChapters(novelId),
        volumes: listVolumes(novelId),
      }}
    />
  );
}
