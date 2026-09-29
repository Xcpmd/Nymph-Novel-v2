import { generateChapter, persistGeneration } from '@/lib/ai/pipeline';
import { getChapterByRef } from '@/lib/store/chapters';
import { fail, handleError, readJson, routeParams } from '@/lib/api/http';
import { sseResponse } from '@/lib/api/sse';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

interface Context {
  params: Promise<{ novelId: string }>;
}

interface GenerateBody {
  ref: string;
  direction?: string;
  prefix?: string;
  regenerate?: boolean;
  persist?: boolean;
  status?: 'draft' | 'done';
}

/**
 * 章节生成。
 *
 * 事件顺序：meta（本次使用的模型）→ usage（输入侧用量）→ phase →
 * reasoning（推理模型的思考内容）→ delta（正文增量）→ usage → ops → done。
 * 客户端中止连接即视为暂停，已生成的部分会保存成草稿。
 */
export async function POST(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const body = await readJson<GenerateBody>(request);
    if (!body.ref) return fail('缺少目标章节');

    return sseResponse(async (send, signal) => {
      const result = await generateChapter({
        novelId,
        chapterRef: body.ref,
        direction: body.direction,
        prefix: body.prefix,
        regenerate: body.regenerate,
        signal,
        onEvent: send,
      });

      let ops = result.ops;
      if (result.content.trim() && body.persist !== false) {
        const persisted = persistGeneration(
          novelId,
          body.ref,
          result.content,
          result.payload,
          result.aborted ? 'draft' : (body.status ?? 'draft'),
        );
        ops = persisted.ops;
        send({ type: 'ops', ops });
      }

      send({
        type: 'done',
        payload: result.payload,
        usage: result.usage,
        ops,
        meta: result.meta,
        message: result.aborted ? '已暂停' : '生成完成',
      });
    }, request);
  } catch (error) {
    return handleError(error);
  }
}

export async function GET(request: Request, context: Context) {
  // 供工作台回填当前章节的已有内容
  try {
    const { novelId } = await routeParams(context);
    const ref = new URL(request.url).searchParams.get('ref');
    if (!ref) return fail('缺少目标章节');
    const detail = getChapterByRef(novelId, ref);
    if (!detail) return fail('章节不存在', 404);
    return Response.json({ chapter: detail });
  } catch (error) {
    return handleError(error);
  }
}
