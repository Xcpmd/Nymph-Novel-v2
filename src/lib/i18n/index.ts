import { zh, type MessageKey, type Messages } from './zh';

/**
 * 语言注册表。
 * 新增语言时把 zh.ts 复制为对应文件并翻译取值，然后在这里登记。
 */
export const locales = { zh } as const;

export type Locale = keyof typeof locales;

/** 当前唯一可用的语言。 */
export const DEFAULT_LOCALE: Locale = 'zh';

export const LOCALE_LABELS: Record<Locale, string> = {
  zh: '中文',
};

export type { MessageKey, Messages };

/**
 * 取值并做占位符替换。占位符写法为 {name}。
 * 找不到键时返回键名本身，便于在界面上一眼看出缺失项。
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const table = (locales[locale] ?? zh) as Messages;
  const raw = (table as Record<string, string | undefined>)[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/** 服务端与默认场景下使用的翻译函数。 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(DEFAULT_LOCALE, key, vars);
}

export const LOCALES = Object.keys(locales) as Locale[];

export { zh };
