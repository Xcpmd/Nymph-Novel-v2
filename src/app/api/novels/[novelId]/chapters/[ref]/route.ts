import {
  deleteChapter,
  getChapterByRef,
  listChapters,
  listVolumes,
  moveToDraft,
  requireChapter,
  restoreFromDraft,
  saveChapterContent,
  updateChapter,
  type ChapterPatch,
} from '@/lib/store/chapters';
import { addBookmark, isBookmarked, removeBookmark, listBookmarks, tagsOfChapter } from '@/lib/store/tags';
import { fail, handleError, ok, readJson, routeParams } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ novelId: string; ref: string }>;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { novelId, ref } = await routeParams(context);
    const detail = getChapterByRef(novelId, decodeURIComponent(ref));
    if (!detail) return fail('章节不存在', 404);
    return ok({
      chapter: detail,
      tags: tagsOfChapter(novelId, detail.ref),
      bookmarked: isBookmarked(novelId, detail.ref),
      bookmarks: listBookmarks(novelId).filter((item) => item.ref === detail.ref),
    });
  } catch (error) {
    return handleError(error);
  }
}

interface PatchBody extends ChapterPatch {
  content?: string;
  action?: 'toDraft' | 'restore' | 'toggleBookmark';
  bookmarkNote?: string;
  source?: 'ai' | 'user';
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { novelId, ref: rawRef } = await routeParams(context);
    const ref = decodeURIComponent(rawRef);
    const body = await readJson<PatchBody>(request);

    if (body.action === 'toDraft') {
      const chapter = moveToDraft(novelId, ref);
      return ok({ chapter, ref: chapter.ref, moved: true, ...structureOf(novelId) });
    }
    if (body.action === 'restore') {
      const chapter = restoreFromDraft(novelId, ref);
      return ok({ chapter, ref: chapter.ref, ...structureOf(novelId) });
    }
    if (body.action === 'toggleBookmark') {
      const existing = listBookmarks(novelId).find((item) => item.ref === ref);
      if (existing) removeBookmark(novelId, existing.id);
      else addBookmark(novelId, ref, body.bookmarkNote ?? '');
      return ok({ bookmarked: !existing, bookmarks: listBookmarks(novelId) });
    }

    if (body.content !== undefined) {
      saveChapterContent(novelId, ref, body.content, {
        status: body.status,
        source: body.source ?? 'user',
      });
    }
    const patch: ChapterPatch = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.summary !== undefined) patch.summary = body.summary;
    if (body.status !== undefined) patch.status = body.status;
    if (body.volIndex !== undefined) patch.volIndex = body.volIndex;
    const chapter = Object.keys(patch).length > 0 ? updateChapter(novelId, ref, patch) : requireChapter(novelId, ref);
    const detail = getChapterByRef(novelId, chapter.ref);
    return ok({ chapter: detail ?? chapter, tags: tagsOfChapter(novelId, chapter.ref) });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { novelId, ref } = await routeParams(context);
    deleteChapter(novelId, decodeURIComponent(ref));
    return ok({ deleted: true, ...structureOf(novelId) });
  } catch (error) {
    return handleError(error);
  }
}

/** 结构性变动之后顺手把最新目录带回去，前端直接替换状态即可。 */
function structureOf(novelId: string) {
  return { chapters: listChapters(novelId), volumes: listVolumes(novelId) };
}
