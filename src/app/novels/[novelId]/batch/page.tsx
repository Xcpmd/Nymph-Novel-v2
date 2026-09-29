import { notFound } from 'next/navigation';

import { BatchClient } from '@/components/novel/BatchClient';
import { advanceBatches } from '@/lib/ai/batch';
import { resolveBatchSupport } from '@/lib/ai/presets';
import { currentModelMeta } from '@/lib/ai/pipeline';
import { chapterLabel } from '@/lib/format';
import { listChapters, rescanChapters } from '@/lib/store/chapters';
import { getNovel } from '@/lib/store/novels';
import { resolveProviderForScene } from '@/lib/store/providers';

export const dynamic = 'force-dynamic';

/** 批量生成页。任务列表与候选章节在服务端取好，客户端轮询推进任务。 */
export default async function BatchPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();

  rescanChapters(novelId);
  const resolved = resolveProviderForScene('chapter');

  return (
    <BatchClient
      novel={novel}
      initial={{
        jobs: await advanceBatches(novelId),
        candidates: listChapters(novelId)
          .filter((chapter) => !chapter.isDraft)
          .map((chapter) => ({
            ref: chapter.ref,
            indexNo: chapter.indexNo,
            title: chapterLabel(chapter.indexNo, chapter.title),
            status: chapter.status,
            wordCount: chapter.wordCount,
          })),
        support: resolved ? resolveBatchSupport(resolved.config.protocol, resolved.config.baseUrl, resolved.config.batch) : 'none',
        model: currentModelMeta('chapter'),
      }}
    />
  );
}
