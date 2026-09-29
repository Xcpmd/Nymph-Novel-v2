import { listBaseRules, resetBaseRules, updateBaseRule } from '@/lib/store/rules';
import { listTagDefinitions } from '@/lib/ai/context';
import { POSTPROCESS_DOC } from '@/lib/rules/templates';
import { handleError, ok, readJson, fail } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/** 基础规则的全局读写。基础规则对所有小说生效，因此不挂在某一部小说下面。 */
export async function GET() {
  try {
    return ok({
      baseRules: listBaseRules(),
      tags: listTagDefinitions(),
      postprocessDoc: POSTPROCESS_DOC,
    });
  } catch (error) {
    return handleError(error);
  }
}

interface BaseRuleBody {
  action?: 'save' | 'reset';
  slot?: string;
  content?: string;
}

export async function POST(request: Request) {
  try {
    const body = await readJson<BaseRuleBody>(request);
    if (body.action === 'reset') {
      resetBaseRules();
      return ok({ baseRules: listBaseRules() });
    }
    if (!body.slot) return fail('缺少槽位');
    updateBaseRule(body.slot, body.content ?? '');
    return ok({ baseRules: listBaseRules() });
  } catch (error) {
    return handleError(error);
  }
}
