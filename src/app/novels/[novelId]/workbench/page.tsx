import { notFound } from 'next/navigation';

import { WorkbenchClient } from '@/components/novel/WorkbenchClient';
import { previewContext } from '@/lib/ai/context';
import { currentModelMeta } from '@/lib/ai/pipeline';
import { rulesPayload } from '@/lib/rules/payload';
import { getChapterByRef, listChapters, listVolumes, rescanChapters } from '@/lib/store/chapters';
import { getNovel } from '@/lib/store/novels';

export const dynamic = 'force-dynamic';

/**
 * 生成工作台。
 *
 * 章节列表、规则清单、上下文预览与当前模型全部在服务端算好后再渲染，
 * 首屏不需要客户端发起任何请求，也就不会出现「先空白再填内容」的跳动。
 */
export default async function WorkbenchPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();

  rescanChapters(novelId);
  const chapters = listChapters(novelId);
  const target = chapters.find((chapter) => !chapter.isDraft);

  return (
    <WorkbenchClient
      novel={novel}
      initial={{
        volumes: listVolumes(novelId),
        chapters,
        rules: rulesPayload(novelId),
        preview: target ? previewContext({ novelId, chapterRef: target.ref, direction: '' }) : null,
        detail: target ? (getChapterByRef(novelId, target.ref) ?? null) : null,
        model: currentModelMeta('chapter'),
      }}
    />
  );
}
