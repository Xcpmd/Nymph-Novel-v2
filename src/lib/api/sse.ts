import type { StreamEvent } from '../types';

/**
 * 把一段异步处理过程以 SSE 形式返回给浏览器。
 *
 * 处理函数通过 send 汇报增量；客户端断开连接时 abortSignal 会触发，
 * 上层据此把已经生成的内容保存下来。
 */
export function sseResponse(
  handler: (send: (event: StreamEvent) => void, signal: AbortSignal) => Promise<void>,
  request: Request,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // 连接已关闭，忽略后续写入
        }
      };
      try {
        await handler(send, request.signal);
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      } finally {
        try {
          controller.close();
        } catch {
          // 已关闭时忽略
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
