import { notFound } from 'next/navigation';

import { OutlineClient } from '@/components/novel/OutlineClient';
import { currentModelMeta } from '@/lib/ai/pipeline';
import { listChapters } from '@/lib/store/chapters';
import { getNovel } from '@/lib/store/novels';
import { listOutline } from '@/lib/store/outline';

export const dynamic = 'force-dynamic';

/** 大纲页。大纲与章节都在服务端取好，编辑内容会自动保存。 */
export default async function OutlinePage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();
  return (
    <OutlineClient
      novel={novel}
      initial={{ outline: listOutline(novelId), chapters: listChapters(novelId) }}
      model={currentModelMeta('outline')}
    />
  );
}
