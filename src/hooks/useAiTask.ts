'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { streamSse } from '@/lib/client/sse';
import type { GenerationMeta, StreamEvent, TokenUsage } from '@/lib/types';

/**
 * 一次性的 AI 任务（大纲改写、资料提取等你来我往的短请求）。
 *
 * 与章节生成共用同一套 SSE 事件协议，因此等待动画、思考内容、
 * 本次请求的 token 统计与模型标识可以复用同样的展示组件。
 */

export interface AiTaskState {
  running: boolean;
  /** 已接收到的正文（未完成时是增量文本） */
  text: string;
  reasoning: string;
  meta: GenerationMeta | null;
  usage: TokenUsage | null;
  phase: string;
  error: string;
  elapsed: number;
  finished: boolean;
}

const INITIAL: AiTaskState = {
  running: false,
  text: '',
  reasoning: '',
  meta: null,
  usage: null,
  phase: '',
  error: '',
  elapsed: 0,
  finished: false,
};

export function useAiTask(url: string, onDone?: (text: string) => void) {
  const [state, setState] = useState<AiTaskState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(() => {
      setState((previous) => ({ ...previous, elapsed: Date.now() - startedAtRef.current }));
    }, 200);
    return () => clearInterval(timer);
  }, [state.running]);

  const run = useCallback(
    async (body: unknown) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      startedAtRef.current = Date.now();
      setState({ ...INITIAL, running: true, phase: 'requesting' });

      try {
        await streamSse(url, body, {
          signal: controller.signal,
          onEvent: (event: StreamEvent) => {
            const { meta, text, usage, phase, message } = event;
            if (event.type === 'meta' && meta) {
              setState((previous) => ({ ...previous, meta }));
            } else if (event.type === 'delta' && text) {
              setState((previous) => ({ ...previous, text: previous.text + text }));
            } else if (event.type === 'reasoning' && text) {
              setState((previous) => ({ ...previous, reasoning: previous.reasoning + text }));
            } else if (event.type === 'phase' && phase) {
              setState((previous) => ({ ...previous, phase }));
            } else if (event.type === 'usage' && usage) {
              setState((previous) => ({ ...previous, usage }));
            } else if (event.type === 'done') {
              setState((previous) => ({
                ...previous,
                running: false,
                finished: true,
                text: text || previous.text,
                usage: usage ?? previous.usage,
                meta: meta ?? previous.meta,
                elapsed: Date.now() - startedAtRef.current,
              }));
              onDone?.(text ?? '');
            } else if (event.type === 'error') {
              setState((previous) => ({ ...previous, running: false, error: message ?? '调用失败' }));
            }
          },
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setState((previous) => ({ ...previous, running: false }));
        } else {
          setState((previous) => ({
            ...previous,
            running: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      } finally {
        controllerRef.current = null;
      }
    },
    [url, onDone],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const reset = useCallback(() => setState(INITIAL), []);

  return { state, run, cancel, reset };
}
