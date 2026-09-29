'use client';

import clsx from 'clsx';

/**
 * 骨架屏与加载动画。
 *
 * 首屏数据在服务端出，客户端只在等待局部刷新时使用这里的占位与动画，
 * 避免出现整页空白或跳动。
 */

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-xl bg-line-soft/70', className)} aria-hidden />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={clsx('h-3.5', index === lines - 1 ? 'w-2/3' : index % 2 === 0 ? 'w-full' : 'w-11/12')}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx('rounded-3xl border border-line-soft bg-surface/80 p-5', className)}>
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 flex flex-col gap-2.5">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonList({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** 页面级加载占位，配合各路由的 loading.tsx 使用。 */
export function PageSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      {Array.from({ length: cards }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}

/** 三点跳动，用于「正在等待模型响应」这类短时等待。 */
export function DotsLoader({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <span className="inline-flex items-end gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 rounded-full bg-accent"
            style={{ animation: 'dot-bounce 1.1s ease-in-out infinite', animationDelay: `${index * 0.16}s` }}
          />
        ))}
      </span>
      {label ? <span className="text-xs text-muted">{label}</span> : null}
    </span>
  );
}

/** 打字机式的光标，接在流式输出末尾。 */
export function TypingCaret() {
  return <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-middle" aria-hidden />;
}
