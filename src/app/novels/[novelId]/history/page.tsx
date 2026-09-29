import { notFound } from 'next/navigation';

import { HistoryPanel } from '@/components/novel/HistoryPanel';
import { listChanges } from '@/lib/store/changelog';
import { getNovel } from '@/lib/store/novels';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

/** 修改日志。分页通过查询参数交给服务端处理，前端只渲染当前页。 */
export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ novelId: string }>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const { novelId } = await params;
  const { offset: rawOffset } = await searchParams;
  const novel = getNovel(novelId);
  if (!novel) notFound();

  const parsed = Number(rawOffset ?? 0);
  const offset = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;

  return (
    <HistoryPanel
      novelId={novelId}
      entries={listChanges(novelId, PAGE_SIZE, offset)}
      offset={offset}
      pageSize={PAGE_SIZE}
    />
  );
}
