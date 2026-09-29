import { notFound } from 'next/navigation';

import { NovelShell } from '@/components/layout/NovelShell';
import { getNovel, touchNovel } from '@/lib/store/novels';

export const dynamic = 'force-dynamic';

export default async function NovelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ novelId: string }>;
}) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();
  touchNovel(novelId);
  return (
    <NovelShell novelId={novelId} novel={novel}>
      {children}
    </NovelShell>
  );
}
