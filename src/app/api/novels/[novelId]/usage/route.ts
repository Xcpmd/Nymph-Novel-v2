import { clearUsage, usageSummary } from '@/lib/store/usage';
import { handleError, ok, routeParams } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ novelId: string }>;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    return ok({ summary: usageSummary(novelId) });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    clearUsage(novelId);
    return ok({ summary: usageSummary(novelId) });
  } catch (error) {
    return handleError(error);
  }
}
