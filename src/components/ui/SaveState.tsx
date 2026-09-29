'use client';

import clsx from 'clsx';

import type { SaveStatus } from '@/hooks/useAutosave';
import { formatTime } from '@/lib/format';

/** 保存状态指示器。自动保存的界面靠它告诉用户内容是否已经落盘。 */

const PRESET: Record<SaveStatus, { icon: string; text: string; className: string }> = {
  idle: { icon: 'fa-circle', text: '', className: 'text-faint' },
  dirty: { icon: 'fa-circle-dot', text: '待保存', className: 'text-warn' },
  saving: { icon: 'fa-circle-notch fa-spin', text: '保存中', className: 'text-accent' },
  saved: { icon: 'fa-circle-check', text: '已保存', className: 'text-accent' },
  error: { icon: 'fa-triangle-exclamation', text: '保存失败', className: 'text-danger' },
};

export function SaveState({
  status,
  savedAt,
  className,
}: {
  status: SaveStatus;
  savedAt?: string;
  className?: string;
}) {
  const preset = PRESET[status];
  if (status === 'idle' || (!preset.text && !savedAt)) return null;
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap', preset.className, className)}
      aria-live="polite"
    >
      <i className={`fa-solid ${preset.icon}`} aria-hidden />
      {preset.text}
      {status === 'saved' && savedAt ? <span className="text-faint">{formatTime(savedAt)}</span> : null}
    </span>
  );
}
