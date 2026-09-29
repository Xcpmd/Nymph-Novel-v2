import { NextResponse } from 'next/server';

/** 接口层公共工具：统一响应格式与错误处理。 */

export interface ApiError {
  error: string;
  detail?: string;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, detail?: string): NextResponse {
  return NextResponse.json({ error: message, detail } satisfies ApiError, { status });
}

/** 把内部异常转成约定的响应，同时保留原始信息便于排查。 */
export function handleError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('不存在')) return fail(message, 404, message);
  if (message.includes('非法') || message.includes('不能为空') || message.includes('已存在')) {
    return fail(message, 400, message);
  }
  if (message.includes('模型') || message.includes('API Key')) return fail(message, 503, message);
  console.error('[api]', error);
  return fail('服务端处理失败', 500, message);
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export async function routeParams<T extends Record<string, string>>(
  context: { params: Promise<T> },
): Promise<T> {
  return context.params;
}

export function parseNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
