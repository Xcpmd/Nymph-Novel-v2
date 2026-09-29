import { getAllSettings, setSetting } from '@/lib/store/providers';
import { usageSummary } from '@/lib/store/usage';
import { isFtsEnabled } from '@/lib/db';
import { handleError, ok, readJson } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/** 全局设置。所有取值都以字符串存放，界面负责转换。 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const novelId = url.searchParams.get('novelId');
    return ok({
      settings: getAllSettings(),
      usage: usageSummary(novelId ?? undefined),
      fts: isFtsEnabled(),
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJson<Record<string, string | number | boolean | null>>(request);
    for (const [key, value] of Object.entries(body)) {
      setSetting(key, value === null || value === undefined ? '' : String(value));
    }
    return ok({ settings: getAllSettings() });
  } catch (error) {
    return handleError(error);
  }
}
