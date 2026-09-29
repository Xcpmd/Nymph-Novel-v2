'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { streamSse } from '@/lib/client/sse';
import type {
  AiChapterPayload,
  DslOperationResult,
  GenerationMeta,
  StreamEvent,
  TokenUsage,
} from '@/lib/types';

/**
 * 生成过程的状态管理。
 *
 * 请求以 SSE 返回：meta 给出本次使用的模型，usage 持续更新 token 统计，
 * reasoning 是推理模型的思考过程，delta 是正文增量。
 * 暂停通过中止连接实现，服务端会把已生成的部分存成草稿；
 * 恢复时把当前正文作为前缀一并发送，模型接着往下写。
 */

export interface GenerationState {
  running: boolean;
  paused: boolean;
  content: string;
  reasoning: string;
  ops: DslOperationResult[];
  payload: AiChapterPayload | null;
  phase: string;
  error: string;
  meta: GenerationMeta | null;
  usage: TokenUsage | null;
  /** 已等待时长（毫秒），用于等待动画 */
  elapsed: number;
  /** 首字到达耗时（毫秒），完成后保留 */
  firstTokenMs: number | null;
}

const INITIAL: GenerationState = {
  running: false,
  paused: false,
  content: '',
  reasoning: '',
  ops: [],
  payload: null,
  phase: '',
  error: '',
  meta: null,
  usage: null,
  elapsed: 0,
  firstTokenMs: null,
};

export interface StartOptions {
  ref: string;
  direction?: string;
  prefix?: string;
  regenerate?: boolean;
  status?: 'draft' | 'done';
}

export function useGeneration(novelId: string, onSettled?: () => void) {
  const [state, setState] = useState<GenerationState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  const lastOptionsRef = useRef<StartOptions | null>(null);
  const startedAtRef = useRef(0);
  const firstTokenRef = useRef<number | null>(null);

  const patch = useCallback((next: Partial<GenerationState>) => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  /** 运行期间走一个计时器，让等待动画能显示已经等了多久。 */
  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(() => {
      setState((previous) => ({ ...previous, elapsed: Date.now() - startedAtRef.current }));
    }, 200);
    return () => clearInterval(timer);
  }, [state.running]);

  const start = useCallback(
    async (options: StartOptions) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      lastOptionsRef.current = options;
      startedAtRef.current = Date.now();
      firstTokenRef.current = null;
      setState({ ...INITIAL, running: true, content: options.prefix ?? '', phase: 'requesting' });

      try {
        await streamSse(
          `/api/novels/${novelId}/generate`,
          {
            ref: options.ref,
            direction: options.direction,
            prefix: options.prefix,
            regenerate: options.regenerate,
            status: options.status ?? 'draft',
          },
          {
            signal: controller.signal,
            onEvent: (event: StreamEvent) => {
              if (event.type === 'meta' && event.meta) {
                patch({ meta: event.meta });
                return;
              }
              if (event.type === 'delta' && event.text) {
                if (firstTokenRef.current === null) firstTokenRef.current = Date.now();
                setState((previous) => ({ ...previous, content: previous.content + event.text }));
                return;
              }
              if (event.type === 'reasoning' && event.text) {
                if (firstTokenRef.current === null) firstTokenRef.current = Date.now();
                setState((previous) => ({ ...previous, reasoning: previous.reasoning + event.text }));
                return;
              }
              if (event.type === 'phase' && event.phase) {
                patch({ phase: event.phase });
                return;
              }
              if (event.type === 'usage' && event.usage) {
                patch({ usage: event.usage });
                return;
              }
              if (event.type === 'ops' && event.ops) {
                patch({ ops: event.ops });
                return;
              }
              if (event.type === 'done') {
                patch({
                  payload: event.payload ?? null,
                  ops: event.ops ?? [],
                  usage: event.usage ?? null,
                  meta: event.meta ?? null,
                  running: false,
                  paused: false,
                  phase: 'done',
                  elapsed: Date.now() - startedAtRef.current,
                  firstTokenMs:
                    firstTokenRef.current === null ? null : firstTokenRef.current - startedAtRef.current,
                });
                return;
              }
              if (event.type === 'error') {
                patch({ error: event.message ?? '生成失败', running: false });
              }
            },
          },
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          patch({ running: false, paused: true, phase: 'aborted' });
        } else {
          patch({
            running: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        controllerRef.current = null;
        onSettled?.();
      }
    },
    [novelId, onSettled, patch],
  );

  /** 暂停：中止连接，服务端把已生成内容保存为草稿。 */
  const pause = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  /** 恢复：以当前正文为前缀继续生成。 */
  const resume = useCallback(
    (direction?: string) => {
      const options = lastOptionsRef.current;
      const prefix = state.content.trim();
      if (!options || !prefix) return;
      void start({ ...options, prefix, direction: direction ?? options.direction });
    },
    [start, state.content],
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState(INITIAL);
  }, []);

  const setContent = useCallback((content: string) => {
    setState((previous) => ({ ...previous, content }));
  }, []);

  return { state, start, pause, resume, reset, setContent };
}
