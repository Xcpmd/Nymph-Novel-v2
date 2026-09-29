'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES, translate, type Locale, type MessageKey } from '@/lib/i18n';

/**
 * 语言上下文。
 * 当前只提供中文；把 zh.ts 复制翻译后注册进 locales 即可在这里切换。
 */
interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  available: Locale[];
  labels: Record<Locale, string>;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        if (typeof document !== 'undefined') document.documentElement.lang = next === 'zh' ? 'zh-CN' : next;
      },
      t: (key, vars) => translate(locale, key, vars),
      available: LOCALES,
      labels: LOCALE_LABELS,
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) {
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => undefined,
      t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
      available: LOCALES,
      labels: LOCALE_LABELS,
    };
  }
  return context;
}
