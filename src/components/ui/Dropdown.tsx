'use client';

import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * 下拉选择。
 *
 * 原生 select 无法定制外观，这里做一个新的列表选择器：
 * 支持图标与分组、键盘上下键与首字母跳转、点击外部关闭，面板带出现动画。
 */

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  icon?: string;
  hint?: string;
  group?: string;
}

export interface DropdownProps<T extends string = string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** 面板最小宽度，默认与触发器同宽 */
  panelClassName?: string;
}

const SIZES = {
  sm: 'h-8 px-2.5 text-xs rounded-lg gap-1.5',
  md: 'h-10 px-3 text-sm rounded-xl gap-2',
} as const;

export function Dropdown<T extends string = string>({
  value,
  options,
  onChange,
  placeholder = '请选择',
  size = 'md',
  className,
  disabled,
  ariaLabel,
  panelClassName,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const commit = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown')) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit(activeIndex);
    } else if (event.key.length === 1) {
      // 输入首字母跳到匹配项
      const letter = event.key.toLowerCase();
      const index = options.findIndex((option) => option.label.toLowerCase().startsWith(letter));
      if (index >= 0) setActiveIndex(index);
    }
  };

  let lastGroup: string | undefined;

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onKeyDown}
        className={clsx(
          'flex w-full cursor-pointer items-center justify-between border border-line-soft bg-ink-soft/80 text-left',
          'hover:border-line focus:border-accent/70 focus:ring-2 focus:ring-accent/20 focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open && 'border-accent/70 ring-2 ring-accent/20',
          SIZES[size],
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {current?.icon ? <i className={clsx('fa-solid', current.icon, 'text-accent')} aria-hidden /> : null}
          <span className={clsx('truncate', current ? 'text-text' : 'text-faint')}>
            {current?.label ?? placeholder}
          </span>
        </span>
        <i
          className={clsx(
            'fa-solid fa-chevron-down shrink-0 text-[9px] text-faint transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className={clsx(
            'rise-in absolute top-full left-0 z-70 mt-1.5 max-h-72 min-w-full overflow-y-auto rounded-2xl',
            'border border-line bg-surface/98 p-1.5 shadow-soft backdrop-blur',
            panelClassName,
          )}
        >
          {options.length === 0 ? (
            <p className="px-2.5 py-3 text-center text-xs text-faint">没有可选项</p>
          ) : (
            options.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;
              const showGroup = option.group && option.group !== lastGroup;
              lastGroup = option.group ?? lastGroup;
              return (
                <div key={option.value}>
                  {showGroup ? (
                    <p className="px-2.5 pt-2 pb-1 text-[10px] tracking-widest text-faint uppercase">
                      {option.group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(index)}
                    className={clsx(
                      'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm',
                      selected ? 'bg-accent/15 text-accent' : 'text-muted',
                      active && !selected && 'bg-white/6 text-text',
                    )}
                  >
                    {option.icon ? (
                      <i className={clsx('fa-solid', option.icon, 'w-4 text-center text-xs')} aria-hidden />
                    ) : (
                      <span className="w-4" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.hint ? <span className="shrink-0 text-[10px] text-faint">{option.hint}</span> : null}
                    {selected ? <i className="fa-solid fa-check text-[10px]" aria-hidden /> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 下拉面板里嵌自定义内容的场景，例如带开关的条目。 */
export function DropdownItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon?: string;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm',
        danger ? 'text-danger hover:bg-danger/10' : 'text-muted hover:bg-white/6 hover:text-text',
      )}
    >
      {icon ? <i className={clsx('fa-solid', icon, 'w-4 text-center text-xs')} aria-hidden /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
