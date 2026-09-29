import { previewContext } from '@/lib/ai/context';
import { handleError, ok, routeParams } from '@/lib/api/http';
import { listTagDefinitions } from '@/lib/ai/context';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ novelId: string }>;
}

/** 上下文预览：查看标签实际替换后的文本与 token 估算。 */
export async function GET(_request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const url = new URL(_request.url);
    const preview = previewContext({
      novelId,
      chapterRef: url.searchParams.get('ref') ?? undefined,
      direction: url.searchParams.get('direction') ?? '',
    });
    return ok({ preview, tags: listTagDefinitions() });
  } catch (error) {
    return handleError(error);
  }
}
