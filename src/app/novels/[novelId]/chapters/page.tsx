import { notFound } from 'next/navigation';

import { ChaptersClient } from '@/components/novel/ChaptersClient';
import { listChapters, listVolumes, rescanChapters } from '@/lib/store/chapters';
import { getNovel } from '@/lib/store/novels';

export const dynamic = 'force-dynamic';

export default async function ChaptersPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();
  rescanChapters(novelId);
  return (
    <ChaptersClient
      novel={novel}
      initial={{ chapters: listChapters(novelId), volumes: listVolumes(novelId) }}
    />
  );
}
