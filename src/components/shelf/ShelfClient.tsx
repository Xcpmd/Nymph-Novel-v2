'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Spinner,
  Textarea,
} from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/client/api';
import { useI18n } from '@/components/providers/I18nProvider';
import { formatDateTime } from '@/lib/format';
import type { Novel } from '@/lib/types';

interface NovelResponse {
  novels: Novel[];
}

export function ShelfClient() {
  const { t } = useI18n();
  const toast = useToast();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<NovelResponse>('/api/novels');
      setNovels(data.novels);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-[80%] min-w-[min(80%,64rem)] py-10">
      <header className="rise-in mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Nymph <span className="text-accent">Novel</span>
          </h1>
          <p className="mt-2 text-sm text-muted">{t('app.tagline')}</p>
          <p className="mt-1 text-xs text-faint">{t('shelf.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" icon="fa-file-import" onClick={() => setImportOpen(true)}>
            {t('shelf.import')}
          </Button>
          <Button variant="primary" icon="fa-plus" onClick={() => setCreateOpen(true)}>
            {t('shelf.create')}
          </Button>
          <Link href="/settings">
            <Button variant="ghost" size="icon" aria-label={t('nav.settings')}>
              <i className="fa-solid fa-gear" aria-hidden />
            </Button>
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-24">
          <Spinner className="text-2xl" />
        </div>
      ) : novels.length === 0 ? (
        <EmptyState
          icon="fa-book-open"
          title={t('shelf.empty')}
          hint={t('shelf.subtitle')}
          action={
            <Button variant="primary" icon="fa-plus" onClick={() => setCreateOpen(true)}>
              {t('shelf.create')}
            </Button>
          }
        />
      ) : (
        <>
          <p className="mb-4 text-xs text-faint">{t('shelf.count', { count: novels.length })}</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-5">
            {novels.map((novel, index) => (
              <NovelCard
                key={novel.id}
                novel={novel}
                index={index}
                onDeleted={() => {
                  void load();
                }}
              />
            ))}
          </div>
        </>
      )}

      <CreateNovelModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />
      <ImportNovelModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          void load();
        }}
      />
    </div>
  );
}

function NovelCard({ novel, index, onDeleted }: { novel: Novel; index: number; onDeleted: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const remove = async () => {
    try {
      await api.delete(`/api/novels/${novel.id}`);
      toast.push(t('common.saved'), 'success');
      onDeleted();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    }
  };

  return (
    <Card className="rise-in group overflow-hidden p-0" >
      <Link href={`/novels/${novel.id}`} className="block">
        <div
          className="relative flex h-52 items-end justify-between overflow-hidden p-4"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          {novel.hasCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/novels/${novel.id}/cover?v=${novel.coverVersion}`}
              alt={novel.title}
              className="absolute inset-0 h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-105 group-hover:opacity-95"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_20%_0%,rgba(200,255,77,.18),transparent_55%),linear-gradient(160deg,#15151b,#0b0b0f)]" />
          )}
          <div className="relative z-10 flex-1">
            <h3 className="line-clamp-2 text-lg font-semibold">{novel.title}</h3>
            <p className="mt-1 line-clamp-2 text-xs text-muted">{novel.description || t('shelf.noCover')}</p>
          </div>
        </div>
      </Link>
      <div className="flex items-center justify-between border-t border-line-soft px-4 py-3">
        <div className="flex items-center gap-2">
          {novel.genre ? <Badge tone="accent">{novel.genre}</Badge> : null}
          <span className="text-[11px] text-faint">
            {novel.lastOpenedAt
              ? t('shelf.lastOpened', { time: formatDateTime(novel.lastOpenedAt) })
              : t('shelf.neverOpened')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.delete')}
          onClick={() => setConfirming(true)}
        >
          <i className="fa-solid fa-trash-can" aria-hidden />
        </Button>
      </div>
      <Modal
        open={confirming}
        title={`${t('common.delete')} ${novel.title}`}
        onClose={() => setConfirming(false)}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" icon="fa-trash-can" onClick={remove}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('shelf.deleteConfirm')}</p>
      </Modal>
    </Card>
  );
}

function CreateNovelModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({ title: '', author: '', genre: '', pov: '', tone: '', description: '' });
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => titleRef.current?.focus(), 60);
  }, [open]);

  const submit = async () => {
    if (!form.title.trim()) {
      toast.push(t('novelForm.titlePlaceholder'), 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/novels', form);
      toast.push(t('common.saved'), 'success');
      setForm({ title: '', author: '', genre: '', pov: '', tone: '', description: '' });
      onCreated();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('shelf.create')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="fa-check" loading={saving} onClick={submit}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('novelForm.title')} className="sm:col-span-2">
          <Input
            ref={titleRef}
            value={form.title}
            placeholder={t('novelForm.titlePlaceholder')}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label={t('novelForm.author')}>
          <Input value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })} />
        </Field>
        <Field label={t('novelForm.genre')}>
          <Input value={form.genre} onChange={(event) => setForm({ ...form, genre: event.target.value })} />
        </Field>
        <Field label={t('novelForm.pov')}>
          <Input value={form.pov} onChange={(event) => setForm({ ...form, pov: event.target.value })} />
        </Field>
        <Field label={t('novelForm.tone')}>
          <Input value={form.tone} onChange={(event) => setForm({ ...form, tone: event.target.value })} />
        </Field>
        <Field label={t('novelForm.description')} className="sm:col-span-2">
          <Textarea
            rows={3}
            value={form.description}
            placeholder={t('novelForm.descriptionPlaceholder')}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}

function ImportNovelModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'txt' | 'bundle'>('txt');
  const [title, setTitle] = useState('');
  const [pattern, setPattern] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!file) {
      toast.push(t('import.pickFile'), 'error');
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('mode', mode);
      if (title) form.append('title', title);
      if (mode === 'txt' && pattern.trim()) form.append('pattern', pattern.trim());
      const result = await api.post<{ chapters: number }>('/api/novels/import', form);
      toast.push(`${t('import.ok')}（${result.chapters} ${t('common.chapters')}）`, 'success');
      setFile(null);
      setTitle('');
      onImported();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('import.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="fa-file-import" loading={saving} onClick={submit}>
            {t('common.import')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-xs text-muted">{t('import.hint')}</p>
        <Field label={t('common.type')}>
          <div className="flex gap-2">
            <Button
              variant={mode === 'txt' ? 'primary' : 'outline'}
              size="sm"
              icon="fa-file-lines"
              onClick={() => setMode('txt')}
            >
              {t('import.mode.txt')}
            </Button>
            <Button
              variant={mode === 'bundle' ? 'primary' : 'outline'}
              size="sm"
              icon="fa-box-archive"
              onClick={() => setMode('bundle')}
            >
              {t('import.mode.bundle')}
            </Button>
          </div>
        </Field>
        <Field label={t('import.pickFile')}>
          <input
            type="file"
            accept={mode === 'txt' ? '.txt,.md,text/plain' : '.json,application/json'}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="w-full cursor-pointer rounded-xl border border-line-soft bg-ink-soft/80 px-3 py-2 text-sm file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1 file:text-ink"
          />
        </Field>
        {mode === 'txt' ? (
          <>
            <Field label={t('import.asNovelTitle')}>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label={t('import.chapterPattern')} hint={t('import.chapterPatternHint')}>
              <Input
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                placeholder={'^\\s*第\\s*([0-9一二三四五六七八九十]+)\\s*[章回节]\\s*(.*)$'}
                className="font-mono text-xs"
              />
            </Field>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
