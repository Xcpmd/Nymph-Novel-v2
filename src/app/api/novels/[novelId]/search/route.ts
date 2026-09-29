import { searchChapters, searchTitles } from '@/lib/store/search';
import { listTags, listBookmarks } from '@/lib/store/tags';
import { handleError, ok, routeParams } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ novelId: string }>;
}

export async function GET(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const url = new URL(request.url);
    const query = url.searchParams.get('q') ?? '';
    const scope = url.searchParams.get('scope') ?? 'all';
    const limit = Number(url.searchParams.get('limit') ?? 40);

    const hits =
      scope === 'title'
        ? searchTitles(novelId, query, limit)
        : searchChapters(novelId, query || '', Number.isFinite(limit) ? limit : 40);

    return ok({
      query,
      hits,
      tags: listTags(novelId),
      bookmarks: listBookmarks(novelId),
    });
  } catch (error) {
    return handleError(error);
  }
}
