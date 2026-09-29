import { notFound } from 'next/navigation';

import { RulesClient } from '@/components/novel/RulesClient';
import { rulesPayload } from '@/lib/rules/payload';
import { getNovel } from '@/lib/store/novels';

export const dynamic = 'force-dynamic';

export default async function RulesPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();
  return <RulesClient novel={novel} initial={rulesPayload(novelId)} />;
}
