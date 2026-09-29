import { notFound } from 'next/navigation';

import { EncyclopediaClient } from '@/components/novel/EncyclopediaClient';
import { currentModelMeta } from '@/lib/ai/pipeline';
import { buildToc, listEntries } from '@/lib/store/encyclopedia';
import { getNovel } from '@/lib/store/novels';

export const dynamic = 'force-dynamic';

/** 百科全书。目录在服务端按条目正文的二级标题生成。 */
export default async function EncyclopediaPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();
  return (
    <EncyclopediaClient
      novel={novel}
      initial={{ entries: listEntries(novelId), toc: buildToc(novelId) }}
      model={currentModelMeta('encyclopedia')}
    />
  );
}
