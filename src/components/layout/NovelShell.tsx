'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';

import { useI18n } from '@/components/providers/I18nProvider';
import { Button } from '@/components/ui/primitives';
import type { Novel } from '@/lib/types';

/** 小说工作区的整体框架：左侧导航 + 中间内容。 */

interface NavItem {
  href: string;
  labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0];
  icon: string;
}

export function NovelShell({
  novelId,
  novel,
  children,
}: {
  novelId: string;
  novel: Novel | null;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const base = `/novels/${novelId}`;

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: t('nav.overview'),
      items: [
        { href: base, labelKey: 'nav.overview', icon: 'fa-gauge-high' },
        { href: `${base}/workbench`, labelKey: 'nav.workbench', icon: 'fa-wand-magic-sparkles' },
        { href: `${base}/batch`, labelKey: 'nav.batch', icon: 'fa-layer-group' },
        { href: `${base}/read`, labelKey: 'nav.read', icon: 'fa-book-open-reader' },
        { href: `${base}/chapters`, labelKey: 'nav.chapters', icon: 'fa-list-ol' },
        { href: `${base}/outline`, labelKey: 'nav.outline', icon: 'fa-diagram-project' },
      ],
    },
    {
      title: t('nav.characters'),
      items: [
        { href: `${base}/characters`, labelKey: 'nav.characters', icon: 'fa-users' },
        { href: `${base}/relations`, labelKey: 'nav.relations', icon: 'fa-circle-nodes' },
        { href: `${base}/encyclopedia`, labelKey: 'nav.encyclopedia', icon: 'fa-book' },
      ],
    },
    {
      title: t('nav.search'),
      items: [
        { href: `${base}/search`, labelKey: 'nav.search', icon: 'fa-magnifying-glass' },
        { href: `${base}/rules`, labelKey: 'nav.rules', icon: 'fa-scroll' },
        { href: `${base}/usage`, labelKey: 'nav.usage', icon: 'fa-chart-simple' },
        { href: `${base}/history`, labelKey: 'nav.history', icon: 'fa-clock-rotate-left' },
      ],
    },
  ];

  return (
    <div className="mx-auto flex w-[80%] min-w-[min(80%,72rem)] gap-6 py-8">
      <aside className="sticky top-8 h-fit w-56 shrink-0">
        <Link href="/" className="mb-5 flex items-center gap-2 text-sm text-muted hover:text-accent">
          <i className="fa-solid fa-chevron-left text-xs" aria-hidden />
          {t('nav.shelf')}
        </Link>
        <div className="rounded-3xl border border-line-soft bg-surface/70 p-4 backdrop-blur">
          <h1 className="mb-1 line-clamp-2 text-base font-semibold">{novel?.title ?? t('common.loading')}</h1>
          <p className="mb-4 text-[11px] text-faint">
            {novel?.author ? `${novel.author} · ` : ''}
            {novel ? (novel.genre || t('app.name')) : ''}
          </p>
          <nav className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="mb-2 px-2 text-[10px] tracking-widest text-faint uppercase">{group.title}</p>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm ${
                          active
                            ? 'bg-accent/15 font-semibold text-accent'
                            : 'text-muted hover:bg-white/5 hover:text-text'
                        }`}
                      >
                        <i className={`fa-solid ${item.icon} w-4 text-center text-xs`} aria-hidden />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <Link href="/settings" className="mt-5 block">
            <Button variant="outline" size="sm" icon="fa-gear" className="w-full justify-center">
              {t('nav.settings')}
            </Button>
          </Link>
        </div>
      </aside>
      <main className="fade-in min-w-0 flex-1">{children}</main>
    </div>
  );
}
