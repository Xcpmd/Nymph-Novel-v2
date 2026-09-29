import fs from 'node:fs';

import { fail, handleError, routeParams } from '@/lib/api/http';
import { coverFile } from '@/lib/paths';
import { getNovel } from '@/lib/store/novels';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ novelId: string }>;
}

/** 输出封面图片。没有封面时返回 404，由界面自行渲染占位封面。 */
export async function GET(_request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const novel = getNovel(novelId);
    if (!novel) return fail('小说不存在', 404);
    const file = coverFile(novelId);
    if (!fs.existsSync(file)) return fail('没有封面', 404);
    const buffer = fs.readFileSync(file);
    const type = buffer.subarray(0, 8).toString('hex').startsWith('89504e47')
      ? 'image/png'
      : buffer.subarray(0, 3).toString('hex') === 'ffd8ff'
        ? 'image/jpeg'
        : 'application/octet-stream';
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
