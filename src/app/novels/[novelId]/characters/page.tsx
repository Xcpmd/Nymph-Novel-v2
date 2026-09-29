import { notFound } from 'next/navigation';

import { CharactersClient } from '@/components/novel/CharactersClient';
import { currentModelMeta } from '@/lib/ai/pipeline';
import { listCharacters, listRelations } from '@/lib/store/characters';
import { getNovel } from '@/lib/store/novels';

export const dynamic = 'force-dynamic';

/** 角色图鉴。数据在服务端读取，界面只负责筛选与展示。 */
export default async function CharactersPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();
  return (
    <CharactersClient
      novel={novel}
      initial={{ characters: listCharacters(novelId), relations: listRelations(novelId) }}
      model={currentModelMeta('character')}
    />
  );
}
