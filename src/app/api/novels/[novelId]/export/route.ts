import {
  getChapterByRef,
  listChapters,
  listVolumes,
} from '@/lib/store/chapters';
import { listCharacters, listRelations } from '@/lib/store/characters';
import { listEntries } from '@/lib/store/encyclopedia';
import { listOutline } from '@/lib/store/outline';
import { requireNovel } from '@/lib/store/novels';
import { listBaseRules, listIndependentRules } from '@/lib/store/rules';
import { chapterLabel } from '@/lib/format';
import { handleError, routeParams } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ novelId: string }>;
}

function download(body: string, filename: string, type: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': `${type}; charset=utf-8`,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}

function bodyOf(novelId: string, ref: string): string {
  return getChapterByRef(novelId, ref)?.content ?? '';
}

/**
 * 导出小说。
 * txt 按卷与章的顺序输出章节标题与正文；bundle 输出完整数据包，可用于导入迁移。
 */
export async function GET(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const url = new URL(request.url);
    const format = url.searchParams.get('format') ?? 'txt';
    const includeOutline = url.searchParams.get('outline') === '1';
    const includeEncyclopedia = url.searchParams.get('encyclopedia') === '1';
    const novel = requireNovel(novelId);
    const chapters = listChapters(novelId).filter((chapter) => !chapter.isDraft);
    const volumes = listVolumes(novelId);

    if (format === 'bundle') {
      const payload = {
        kind: 'nymph-novel-bundle',
        version: 1,
        exportedAt: new Date().toISOString(),
        novel,
        volumes,
        outline: listOutline(novelId),
        chapters: chapters.map((chapter) => ({
          volIndex: chapter.volIndex,
          indexNo: chapter.indexNo,
          title: chapter.title,
          summary: chapter.summary,
          status: chapter.status,
          content: bodyOf(novelId, chapter.ref),
        })),
        characters: listCharacters(novelId),
        relations: listRelations(novelId),
        encyclopedia: listEntries(novelId),
        rules: {
          base: listBaseRules(),
          independent: listIndependentRules(novelId),
        },
      };
      return download(
        JSON.stringify(payload, null, 2),
        `${novel.title}-数据包.json`,
        'application/json',
      );
    }

    const parts: string[] = [];
    parts.push(novel.title);
    if (novel.author) parts.push(`作者：${novel.author}`);
    if (novel.description) parts.push('', novel.description);
    parts.push('', `共 ${chapters.length} 章`, '', '');

    let currentVol = -1;
    for (const chapter of chapters) {
      if (chapter.volIndex !== currentVol) {
        currentVol = chapter.volIndex;
        const volume = volumes.find((item) => item.index === currentVol);
        if (volume && volumes.length > 1) parts.push('', volume.title, '');
      }
      parts.push('', chapterLabel(chapter.indexNo, chapter.title), '', bodyOf(novelId, chapter.ref).trim(), '');
    }

    if (includeOutline) {
      parts.push('', '附：大纲', '');
      for (const line of listOutline(novelId)) parts.push(`第${line.indexNo}章 ${line.content}`);
    }

    if (includeEncyclopedia) {
      parts.push('', '附：百科全书', '');
      for (const entry of listEntries(novelId)) {
        parts.push('', `### ${entry.title}`, '', entry.summary, '', entry.content);
      }
    }

    const text = parts.join('\n').replace(/\n{4,}/g, '\n\n\n');
    return download(text, `${novel.title}.txt`, 'text/plain');
  } catch (error) {
    return handleError(error);
  }
}
