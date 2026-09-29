import { listTagDefinitions } from '../ai/context';
import { POSTPROCESS_DOC } from './templates';
import { listBaseRules, listChecklist, listIndependentRules } from '../store/rules';
import type { RuleCategory } from '../types';

/**
 * 规则页面与生成工作台共用的一份载荷。
 *
 * 排序、分组、字数统计全部在服务端算好，前端只负责渲染与上报用户操作。
 */

export interface RulePayload {
  checklist: ReturnType<typeof listChecklist>;
  baseRules: ReturnType<typeof listBaseRules>;
  independent: ReturnType<typeof listIndependentRules>;
  tags: ReturnType<typeof listTagDefinitions>;
  postprocessDoc: string;
  /** 每个分组的规则条数，用于界面上直接显示 */
  counts: Record<RuleCategory, number>;
}

export function rulesPayload(novelId: string): RulePayload {
  const checklist = listChecklist(novelId);
  return {
    checklist,
    baseRules: listBaseRules(),
    independent: listIndependentRules(novelId),
    tags: listTagDefinitions(),
    postprocessDoc: POSTPROCESS_DOC,
    counts: {
      system: checklist.system.length,
      user: checklist.user.length,
      assistant: checklist.assistant.length,
    },
  };
}
