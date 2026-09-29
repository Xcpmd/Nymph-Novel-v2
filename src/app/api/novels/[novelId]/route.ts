import { deleteNovel, getNovel, touchNovel, updateNovel, type NovelPatch } from '@/lib/store/novels';
import { chapterStats, rescanChapters } from '@/lib/store/chapters';
import { countCharacters } from '@/lib/store/characters';
import { countEntries } from '@/lib/store/encyclopedia';
import { fail, handleError, ok, readJson, routeParams } from '@/lib/api/http';
import { setCover } from '@/lib/store/novels';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ novelId: string }>;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const novel = getNovel(novelId);
    if (!novel) return fail('小说不存在', 404);
    rescanChapters(novelId);
    return ok({
      novel,
      stats: {
        ...chapterStats(novelId),
        characters: countCharacters(novelId),
        entries: countEntries(novelId),
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const body = await readJson<NovelPatch & { touch?: boolean }>(request);
    if (body.touch) touchNovel(novelId);
    const novel = updateNovel(novelId, body);
    return ok({ novel });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    deleteNovel(novelId);
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  // 通过 PUT 提交 multipart 表单来更换封面
  try {
    const { novelId } = await routeParams(context);
    const form = await request.formData();
    const file = form.get('cover');
    if (form.get('remove') === '1') {
      const novel = setCover(novelId, null);
      return ok({ novel });
    }
    if (!(file instanceof File)) return fail('没有收到封面文件');
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > 8 * 1024 * 1024) return fail('封面不能超过 8MB');
    const novel = setCover(novelId, buffer);
    return ok({ novel });
  } catch (error) {
    return handleError(error);
  }
}
