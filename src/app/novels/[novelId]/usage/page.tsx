import { notFound } from 'next/navigation';

import { UsagePanel } from '@/components/novel/UsagePanel';
import { getNovel } from '@/lib/store/novels';
import { usageSummary } from '@/lib/store/usage';

export const dynamic = 'force-dynamic';

/** 用量统计全部在服务端汇总好，页面直接渲染。 */
export default async function UsagePage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();
  return <UsagePanel novel={novel} summary={usageSummary(novelId)} />;
}
