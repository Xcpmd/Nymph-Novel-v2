import {
  listOutline,
  replaceOutline,
  setOutlineLine,
  splitOutlineToChapters,
} from '@/lib/store/outline';
import { listChapters } from '@/lib/store/chapters';
import { assistOutline } from '@/lib/ai/pipeline';
import { handleError, ok, readJson, routeParams, fail } from '@/lib/api/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Context {
  params: Promise<{ novelId: string }>;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    return ok({ outline: listOutline(novelId) });
  } catch (error) {
    return handleError(error);
  }
}

interface OutlineBody {
  action?: 'save' | 'assist' | 'line' | 'sync' | 'split';
  text?: string;
  indexNo?: number;
  content?: string;
  instruction?: string;
  mode?: 'rewrite' | 'generate';
  indexes?: number[];
}

export async function POST(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const body = await readJson<OutlineBody>(request);

    if (body.action === 'assist') {
      const result = await assistOutline({
        novelId,
        instruction: body.instruction ?? '',
        mode: body.mode ?? 'rewrite',
        currentOutline: body.text ?? listOutline(novelId).map((line) => `第${line.indexNo}章 ${line.content}`).join('\n'),
        signal: request.signal,
      });
      return ok({ text: result.text, usage: result.usage });
    }

    // 把大纲拆分成章节：只处理选中的行，未选中的保持不变
    if (body.action === 'split') {
      const result = splitOutlineToChapters(novelId, body.indexes);
      return ok({ ...result, chapters: listChapters(novelId), outline: listOutline(novelId) });
    }

    if (body.action === 'sync') {
      const result = splitOutlineToChapters(novelId);
      return ok({ ...result, chapters: listChapters(novelId) });
    }

    if (body.action === 'line') {
      if (body.indexNo === undefined) return fail('缺少章节序号');
      setOutlineLine(novelId, body.indexNo, body.content ?? '');
      return ok({ outline: listOutline(novelId) });
    }

    if (typeof body.text !== 'string') return fail('缺少大纲文本');
    replaceOutline(novelId, body.text);
    return ok({ outline: listOutline(novelId) });
  } catch (error) {
    return handleError(error);
  }
}
