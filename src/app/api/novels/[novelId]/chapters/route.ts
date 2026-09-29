import {
  createChapter,
  listChapters,
  listVolumes,
  reorderChapters,
  rescanChapters,
  upsertVolume,
  type CreateChapterInput,
  type ReorderEntry,
} from '@/lib/store/chapters';
import { listOutline, splitOutlineToChapters } from '@/lib/store/outline';
import { fail, handleError, ok, readJson, routeParams } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ novelId: string }>;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    rescanChapters(novelId);
    return ok({
      volumes: listVolumes(novelId),
      chapters: listChapters(novelId),
      outline: listOutline(novelId),
    });
  } catch (error) {
    return handleError(error);
  }
}

interface CreateBody extends CreateChapterInput {
  action?: 'create' | 'syncOutline' | 'reorder';
  volumeTitle?: string;
  volumeSummary?: string;
  order?: ReorderEntry[];
}

export async function POST(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const body = await readJson<CreateBody>(request);

    if (body.action === 'syncOutline') {
      const result = splitOutlineToChapters(novelId);
      return ok({ ...result, chapters: listChapters(novelId) });
    }

    // 手动排序：章节跟着位置走，正文与相关引用一起搬
    if (body.action === 'reorder') {
      if (!Array.isArray(body.order) || body.order.length === 0) return fail('缺少排序数据');
      const result = reorderChapters(novelId, body.order);
      return ok({
        ...result,
        chapters: listChapters(novelId),
        volumes: listVolumes(novelId),
      });
    }

    if (body.volIndex !== undefined && (body.volumeTitle !== undefined || body.volumeSummary !== undefined)) {
      upsertVolume(novelId, body.volIndex, body.volumeTitle, body.volumeSummary);
    }

    const chapter = createChapter(novelId, body);
    return ok({ chapter, chapters: listChapters(novelId) }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  // 更新卷信息
  try {
    const { novelId } = await routeParams(context);
    const body = await readJson<{ volIndex: number; title?: string; summary?: string }>(request);
    upsertVolume(novelId, body.volIndex, body.title, body.summary);
    return ok({ volumes: listVolumes(novelId) });
  } catch (error) {
    return handleError(error);
  }
}
