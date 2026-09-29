import { runExtraction } from '@/lib/ai/pipeline';
import { handleError, readJson, routeParams } from '@/lib/api/http';
import { sseResponse } from '@/lib/api/sse';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Context {
  params: Promise<{ novelId: string }>;
}

interface ExtractBody {
  scene?: 'character' | 'encyclopedia' | 'chat';
  instruction?: string;
  source?: string;
}

/** 角色与百科的资料提取，以 SSE 推送增量文本与思考内容。 */
export async function POST(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const body = await readJson<ExtractBody>(request);

    return sseResponse(async (send, signal) => {
      const result = await runExtraction({
        novelId,
        scene: body.scene ?? 'character',
        instruction: body.instruction ?? '',
        source: body.source,
        signal,
        onEvent: send,
      });
      send({ type: 'done', text: result.text, usage: result.usage, meta: result.meta });
    }, request);
  } catch (error) {
    return handleError(error);
  }
}
