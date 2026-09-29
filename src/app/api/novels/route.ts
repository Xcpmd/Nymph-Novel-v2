import { createNovel, listNovels } from '@/lib/store/novels';
import { fail, handleError, ok, readJson } from '@/lib/api/http';
import { ensureBaseRules } from '@/lib/store/rules';
import type { NovelInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    ensureBaseRules();
    return ok({ novels: listNovels() });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<NovelInput>(request);
    if (!body?.title?.trim()) return fail('小说标题不能为空');
    const novel = createNovel(body);
    return ok({ novel }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
