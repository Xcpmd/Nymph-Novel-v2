import { assistOutline } from '@/lib/ai/pipeline';
import { handleError, readJson, routeParams } from '@/lib/api/http';
import { sseResponse } from '@/lib/api/sse';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Context {
  params: Promise<{ novelId: string }>;
}

interface AssistBody {
  instruction?: string;
  mode?: 'rewrite' | 'generate';
  text?: string;
}

/** 大纲改写与生成，以 SSE 推送增量文本与思考内容。 */
export async function POST(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const body = await readJson<AssistBody>(request);

    return sseResponse(async (send, signal) => {
      const result = await assistOutline({
        novelId,
        instruction: body.instruction ?? '',
        mode: body.mode ?? 'rewrite',
        currentOutline: body.text ?? '',
        signal,
        onEvent: send,
      });
      send({ type: 'done', text: result.text, usage: result.usage, meta: result.meta });
    }, request);
  } catch (error) {
    return handleError(error);
  }
}
