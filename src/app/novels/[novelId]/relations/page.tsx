import { notFound } from 'next/navigation';

import { RelationsClient } from '@/components/novel/RelationsClient';
import { listCharacters, listRelations } from '@/lib/store/characters';
import { getNovel } from '@/lib/store/novels';

export const dynamic = 'force-dynamic';

export default async function RelationsPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();
  return (
    <RelationsClient
      novel={novel}
      initial={{ characters: listCharacters(novelId), relations: listRelations(novelId) }}
    />
  );
}
