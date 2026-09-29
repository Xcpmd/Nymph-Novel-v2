import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, Button, Card, EmptyState, ProgressBar, SectionTitle } from '@/components/ui/primitives';
import { CoverUploader } from '@/components/novel/CoverUploader';
import { ExportPanel } from '@/components/novel/ExportPanel';
import { chapterStats, listChapters, listVolumes } from '@/lib/store/chapters';
import { countCharacters } from '@/lib/store/characters';
import { countEntries } from '@/lib/store/encyclopedia';
import { listOutline } from '@/lib/store/outline';
import { getNovel } from '@/lib/store/novels';
import { usageSummary } from '@/lib/store/usage';
import { chapterLabel, formatDateTime, formatNumber } from '@/lib/format';
import { getT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();
  const t = getT();

  const stats = chapterStats(novelId);
  const chapters = listChapters(novelId).filter((chapter) => !chapter.isDraft);
  const volumes = listVolumes(novelId);
  const outline = listOutline(novelId);
  const usage = usageSummary(novelId);
  const relations = countCharacters(novelId);
  const entries = countEntries(novelId);
  const lastChapter = chapters[chapters.length - 1];
  const firstUnwritten = chapters.find((chapter) => chapter.status !== 'done');

  const tiles = [
    { key: 'chapters', label: t('overview.stat.chapters'), value: formatNumber(stats.chapters), icon: 'fa-list-ol' },
    { key: 'words', label: t('overview.stat.words'), value: formatNumber(stats.words), icon: 'fa-pen-nib' },
    { key: 'characters', label: t('overview.stat.characters'), value: formatNumber(relations), icon: 'fa-users' },
    { key: 'entries', label: t('overview.stat.entries'), value: formatNumber(entries), icon: 'fa-book' },
    { key: 'tokens', label: t('overview.stat.tokens'), value: formatNumber(usage.totalTokens), icon: 'fa-coins' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{novel.title}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{novel.description || t('common.empty')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {novel.author ? <Badge>{novel.author}</Badge> : null}
              {novel.genre ? <Badge tone="accent">{novel.genre}</Badge> : null}
              {novel.pov ? <Badge tone="muted">{novel.pov}</Badge> : null}
              {novel.tone ? <Badge tone="muted">{novel.tone}</Badge> : null}
              <span className="text-[11px] text-faint">
                {t('shelf.lastOpened', { time: formatDateTime(novel.lastOpenedAt ?? novel.createdAt) })}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <CoverUploader novel={novel} />
            <Link href={`/novels/${novelId}/workbench`}>
              <Button variant="primary" icon="fa-wand-magic-sparkles">
                {t('overview.continue')}
              </Button>
            </Link>
            <Link href={`/novels/${novelId}/read`}>
              <Button variant="outline" icon="fa-book-open-reader">
                {t('overview.startReading')}
              </Button>
            </Link>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((tile, index) => (
          <Card key={tile.key} className="rise-in" >
            <div className="flex items-center gap-2 text-[11px] text-muted" style={{ animationDelay: `${index * 30}ms` }}>
              <i className={`fa-solid ${tile.icon} text-accent`} aria-hidden />
              {tile.label}
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums">{tile.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle icon="fa-chart-line" title={t('overview.progress')} />
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{t('overview.outlineCoverage', { done: stats.done, total: outline.length || chapters.length })}</span>
            <span>
              {stats.done} / {stats.chapters}
            </span>
          </div>
          <ProgressBar className="mt-2" value={stats.done} max={Math.max(1, stats.chapters)} />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-line-soft bg-ink-soft/40 p-3">
              <dt className="text-faint">{t('common.volume')}</dt>
              <dd className="mt-1 text-base font-semibold">{volumes.length}</dd>
            </div>
            <div className="rounded-xl border border-line-soft bg-ink-soft/40 p-3">
              <dt className="text-faint">{t('chapters.draftArea')}</dt>
              <dd className="mt-1 text-base font-semibold">{stats.drafts}</dd>
            </div>
          </dl>
          {firstUnwritten ? (
            <p className="mt-4 text-xs text-muted">
              {t('overview.continue')}：{chapterLabel(firstUnwritten.indexNo, firstUnwritten.title)}
            </p>
          ) : null}
        </Card>

        <Card>
          <SectionTitle icon="fa-clock-rotate-left" title={t('overview.recent')} />
          {chapters.length === 0 ? (
            <EmptyState icon="fa-feather" title={t('reader.emptyChapter')} />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {[...chapters]
                .reverse()
                .slice(0, 8)
                .map((chapter) => (
                  <li key={chapter.ref}>
                    <Link
                      href={`/novels/${novelId}/read?ref=${encodeURIComponent(chapter.ref)}`}
                      className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm hover:bg-white/5"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {chapterLabel(chapter.indexNo, chapter.title)}
                      </span>
                      <span className="shrink-0 text-[11px] text-faint">
                        {chapter.wordCount} {t('common.words')}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
          {lastChapter ? (
            <p className="mt-3 text-[11px] text-faint">
              {t('common.chapter')} {lastChapter.indexNo} · {formatDateTime(lastChapter.updatedAt)}
            </p>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ExportPanel novel={novel} chapterCount={chapters.length} />
        <Card>
          <SectionTitle icon="fa-folder-tree" title={t('nav.chapters')} hint={t('shelf.subtitle')} />
          <ul className="flex flex-col gap-1 font-mono text-[11px] text-muted">
            <li>novel/{novelId}/cover.png</li>
            <li>novel/{novelId}/vols/vol-001/1.md</li>
            <li>novel/{novelId}/setting/{'{'}规则标题{'}'}.md</li>
            <li>novel/{novelId}/data/chara/{'{'}称呼{'}'}.md</li>
            <li>novel/{novelId}/data/base/{'{'}id{'}'}.md</li>
          </ul>
          <p className="mt-3 text-[11px] text-faint">{t('shelf.subtitle')}</p>
        </Card>
      </div>
    </div>
  );
}
