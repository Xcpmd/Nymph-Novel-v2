import { DEFAULT_LOCALE, translate, type MessageKey } from './index';

/**
 * 服务端组件使用的翻译函数。
 * 语言固定取默认语言，与页面配置保持一致。
 */
export function getT(locale = DEFAULT_LOCALE) {
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}
