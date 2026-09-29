'use client';

import type { StreamEvent } from '@/lib/types';

/**
 * 读取服务端返回的 SSE 流。
 *
 * 生成、大纲改写、资料提取都走同一套事件协议，客户端只需要关心事件本身。
 * 返回 Promise，正常结束或出错都会 resolve/reject，中止时会抛出 AbortError。
 */
export async function streamSse(
  url: string,
  body: unknown,
  options: {
    signal?: AbortSignal;
    onEvent: (event: StreamEvent) => void;
  },
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    let message = `请求失败（${response.status}）`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      // 保留默认提示
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((item) => item.startsWith('data:'));
      if (!line) continue;
      try {
        options.onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
      } catch {
        // 忽略无法解析的分片
      }
    }
  }
}
