'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 防抖自动保存。
 *
 * 值变化后等一小段时间再提交，期间继续变化就重新计时；提交过程中若又有新改动，
 * 完成后会自动再存一次。配合保存状态指示器使用，用户不需要手动点保存。
 */

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface UseAutosaveOptions<T> {
  value: T;
  onSave: (value: T) => Promise<void>;
  /** 停止输入多久后提交，默认 1200ms */
  delay?: number;
  enabled?: boolean;
  equals?: (a: T, b: T) => boolean;
}

export interface UseAutosaveResult<T> {
  status: SaveStatus;
  savedAt: string;
  /** 立即提交，用于切换章节、关闭编辑模式等场景 */
  flush: () => Promise<void>;
  /** 服务端回写后同步基线，避免刚保存的内容又被判定为改动 */
  markSaved: (value: T) => void;
}

export function useAutosave<T>({
  value,
  onSave,
  delay = 1200,
  enabled = true,
  equals = Object.is,
}: UseAutosaveOptions<T>): UseAutosaveResult<T> {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [savedAt, setSavedAt] = useState('');

  const savedRef = useRef<T>(value);
  const latestRef = useRef<T>(value);
  const saveRef = useRef(onSave);
  const equalsRef = useRef(equals);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 在副作用里同步最新值，避免渲染期间写 ref
  useEffect(() => {
    latestRef.current = value;
    saveRef.current = onSave;
    equalsRef.current = equals;
  }, [value, onSave, equals]);

  const run = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (inFlightRef.current) return;
    const target = latestRef.current;
    if (equalsRef.current(target, savedRef.current)) {
      setStatus((current) => (current === 'dirty' ? 'saved' : current));
      return;
    }
    inFlightRef.current = true;
    setStatus('saving');
    try {
      await saveRef.current(target);
      savedRef.current = target;
      setSavedAt(new Date().toISOString());
      // 保存期间又改了，就继续标记为待保存
      setStatus(equalsRef.current(latestRef.current, target) ? 'saved' : 'dirty');
    } catch {
      setStatus('error');
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (equalsRef.current(value, savedRef.current)) return;
    setStatus((current) => (current === 'saving' ? current : 'dirty'));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void run();
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };
  }, [value, enabled, delay, run]);

  // 关掉页面前把还没提交的内容补上
  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      if (!equalsRef.current(latestRef.current, savedRef.current)) void run();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [enabled, run]);

  const markSaved = useCallback((next: T) => {
    savedRef.current = next;
    latestRef.current = next;
    setStatus('saved');
    setSavedAt(new Date().toISOString());
  }, []);

  return { status, savedAt, flush: run, markSaved };
}
