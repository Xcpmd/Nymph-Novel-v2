import {
  deleteIndependentRule,
  reorderBindings,
  resetBaseRules,
  saveIndependentRule,
  updateBaseRule,
  type BindingUpdate,
  type IndependentRuleInput,
} from '@/lib/store/rules';
import { handleError, ok, readJson, routeParams, fail } from '@/lib/api/http';
import { rulesPayload } from '@/lib/rules/payload';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ novelId: string }>;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    return ok(rulesPayload(novelId));
  } catch (error) {
    return handleError(error);
  }
}

interface RuleBody {
  action?: 'saveRule' | 'bindings' | 'baseRule' | 'resetBase';
  updates?: BindingUpdate[];
  slot?: string;
  id?: number;
  title?: string;
  content?: string;
  category?: 'system' | 'user' | 'assistant';
}

export async function POST(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const body = await readJson<RuleBody>(request);

    if (body.action === 'bindings') {
      if (!Array.isArray(body.updates)) return fail('缺少排序数据');
      reorderBindings(novelId, body.updates);
      return ok(rulesPayload(novelId));
    }

    if (body.action === 'baseRule') {
      if (!body.slot) return fail('缺少槽位');
      updateBaseRule(body.slot, body.content ?? '');
      return ok(rulesPayload(novelId));
    }

    if (body.action === 'resetBase') {
      resetBaseRules();
      return ok(rulesPayload(novelId));
    }

    if (!body.title?.trim()) return fail('规则标题不能为空');
    saveIndependentRule(novelId, {
      id: body.id,
      title: body.title,
      content: body.content ?? '',
      category: body.category,
    } satisfies IndependentRuleInput);
    return ok(rulesPayload(novelId));
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { novelId } = await routeParams(context);
    const url = new URL(request.url);
    const ruleId = Number(url.searchParams.get('ruleId'));
    if (!Number.isFinite(ruleId)) return fail('缺少规则编号');
    deleteIndependentRule(novelId, ruleId);
    return ok(rulesPayload(novelId));
  } catch (error) {
    return handleError(error);
  }
}
