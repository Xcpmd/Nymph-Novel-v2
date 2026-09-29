import { listChanges } from '@/lib/store/changelog';
import { handleError, ok, routeParams, parseNumber } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ novelId: string }>;
}

export async function GET(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const url = new URL(request.url);
    const limit = parseNumber(url.searchParams.get('limit'), 200);
    const offset = parseNumber(url.searchParams.get('offset'), 0);
    return ok({ entries: listChanges(novelId, limit, offset) });
  } catch (error) {
    return handleError(error);
  }
}
