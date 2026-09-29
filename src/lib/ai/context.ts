import { estimateTokens } from '../format';
import { isDraftIndex } from '../paths';
import { getChapterByRef, listChapters } from '../store/chapters';
import { listCharacters, listRelations } from '../store/characters';
import { listEntries } from '../store/encyclopedia';
import { outlineForChapter, listOutline } from '../store/outline';
import { requireNovel } from '../store/novels';
import { activeRules, listBaseRules, renderIndependentRules } from '../store/rules';
import { tagsOfChapter } from '../store/tags';
import { PAYLOAD_SCHEMA_DOC } from '../rules/templates';
import type {
  ContextPreview,
  ContextSegment,
  ContextStrategy,
  ContextStrategy as Strategy,
  RuleCategory,
  TagPreview,
} from '../types';

/**
 * 上下文管理。
 *
 * 以效果优先为原则，采用分层与按需加载结合：
 * 基础规则与独立规则、主角与配角、故事大纲、角色图鉴与关系网片段、
 * 百科全书相关片段始终注入；摘要按情节重要性分级；超出预算时先压缩
 * 相关性最低的内容并给出提醒。
 */

export interface ContextOptions {
  chapterRef?: string;
  direction?: string;
  strategy?: ContextStrategy;
  budget?: number;
}

/** 规则清单的三个分组，顺序固定，界面上也按这个顺序排列。 */
const CATEGORIES: RuleCategory[] = ['system', 'user', 'assistant'];

/** 标签定义的上下文。 */
interface TagContext {
  novelId: string;
  novel: ReturnType<typeof requireNovel>;
  chapterRef: string;
  indexNo: number;
  direction: string;
  query: string;
  budget: number;
  segments: ContextSegment[];
}

export interface TagDefinition {
  name: string;
  purpose: string;
  category: RuleCategory;
  resolve: (ctx: TagContext) => string;
  emphasis?: 'always' | 'onDemand';
}

const STRATEGY_RATIO: Record<ContextStrategy, { recent: number; mid: number; encyclopedia: number; previous: number }> = {
  quality: { recent: 8, mid: 12, encyclopedia: 18, previous: 2500 },
  balanced: { recent: 5, mid: 8, encyclopedia: 10, previous: 1500 },
  frugal: { recent: 3, mid: 4, encyclopedia: 6, previous: 800 },
};

function joinLines(lines: (string | undefined | null)[]): string {
  return lines
    .map((line) => (line ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

/** 取相对当前章节的上一章正文。废稿章节不参与衔接。 */
function previousChapter(novelId: string, indexNo: number) {
  const chapters = listChapters(novelId).filter(
    (chapter) => chapter.indexNo < indexNo && !isDraftIndex(chapter.indexNo),
  );
  const previous = chapters[chapters.length - 1];
  if (!previous) return null;
  return getChapterByRef(novelId, previous.ref);
}

/** 把文本裁剪到指定 token 上限，尽量在段落边界断开。 */
export function truncateToTokens(text: string, maxTokens: number): { text: string; truncated: boolean } {
  if (maxTokens <= 0) return { text: '', truncated: text.length > 0 };
  if (estimateTokens(text) <= maxTokens) return { text, truncated: false };
  const budgetChars = Math.max(40, Math.floor(maxTokens * 1.6));
  const head = text.slice(0, budgetChars);
  const boundary = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('。'));
  const cut = boundary > budgetChars * 0.5 ? head.slice(0, boundary + 1) : head;
  return { text: `${cut.trimEnd()}\n……`, truncated: true };
}

/** 取上一章结尾的若干字符，保证续写衔接。 */
function tail(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const budgetChars = Math.max(40, Math.floor(maxTokens * 1.6));
  return `……${text.slice(-budgetChars)}`;
}

function novelInfo(novel: ReturnType<typeof requireNovel>): string {
  return joinLines([
    `标题：${novel.title}`,
    novel.author ? `作者：${novel.author}` : '',
    novel.genre ? `题材：${novel.genre}` : '',
    novel.pov ? `叙事视角：${novel.pov}` : '',
    novel.tone ? `整体基调：${novel.tone}` : '',
    novel.description ? `简介：${novel.description}` : '',
  ]);
}

const TAG_DEFINITIONS: TagDefinition[] = [
  {
    name: 'novel',
    purpose: '小说基本信息，包含标题、题材、视角、基调与简介。',
    category: 'system',
    emphasis: 'always',
    resolve: (ctx) => novelInfo(ctx.novel),
  },
  {
    name: 'regulars',
    purpose: '勾选的独立规则文本，按 ## 标题 的格式拼接，正文为空的规则不发送。',
    category: 'system',
    emphasis: 'always',
    resolve: (ctx) => renderIndependentRules(ctx.novelId),
  },
  {
    name: 'rules',
    purpose: 'regulars 的别名，展开结果相同。',
    category: 'system',
    emphasis: 'always',
    resolve: (ctx) => renderIndependentRules(ctx.novelId),
  },
  {
    name: 'base_rules',
    purpose: '除当前模板之外的基础规则文本。',
    category: 'system',
    resolve: (ctx) => {
      const current = ctx.segments.find((segment) => segment.key === 'base-current')?.text ?? '';
      void current;
      return listBaseRules()
        .filter((rule) => rule.kind === 'postprocess')
        .map((rule) => `## ${rule.title}\n\n${rule.content.trim()}`)
        .join('\n\n');
    },
  },
  {
    name: 'outline',
    purpose: '当前章节的大纲，缺失时回退到整体大纲的末尾部分。',
    category: 'system',
    emphasis: 'always',
    resolve: (ctx) => {
      const current = outlineForChapter(ctx.novelId, ctx.indexNo);
      if (current) return `第${ctx.indexNo}章：${current}`;
      const all = listOutline(ctx.novelId).filter((line) => line.indexNo <= ctx.indexNo);
      return all
        .slice(-5)
        .map((line) => `第${line.indexNo}章：${line.content}`)
        .join('\n');
    },
  },
  {
    name: 'characters',
    purpose: '角色图鉴片段，主角与配角保留完整信息。',
    category: 'system',
    emphasis: 'always',
    resolve: (ctx) => {
      const ratio = STRATEGY_RATIO[ctx.novel.contextStrategy as Strategy] ?? STRATEGY_RATIO.balanced;
      void ratio;
      return characterText(ctx.novelId);
    },
  },
  {
    name: 'relations',
    purpose: '角色关系网。',
    category: 'system',
    emphasis: 'always',
    resolve: (ctx) => {
      const relations = listRelations(ctx.novelId);
      if (relations.length === 0) return '';
      const byName = new Map<string, string[]>();
      for (const relation of relations) {
        const list = byName.get(relation.from) ?? [];
        list.push(`${relation.to}${relation.label ? `（${relation.label}）` : ''}`);
        byName.set(relation.from, list);
      }
      return Array.from(byName.entries())
        .map(([name, targets]) => `- ${name} → ${targets.join('、')}`)
        .join('\n');
    },
  },
  {
    name: 'encyclopedia',
    purpose: '与本章相关的百科条目片段，按相关性挑选。',
    category: 'system',
    resolve: (ctx) => encyclopediaText(ctx.novelId, ctx.query, ctx.novel.contextStrategy as Strategy),
  },
  {
    name: 'summaries',
    purpose: '前文脉络，按情节重要性分级：近期章节保留完整摘要，较远的只保留标题。',
    category: 'system',
    emphasis: 'always',
    resolve: (ctx) => summaryText(ctx.novelId, ctx.indexNo, ctx.novel.contextStrategy as Strategy),
  },
  {
    name: 'previous',
    purpose: '上一章正文的结尾片段。',
    category: 'assistant',
    resolve: (ctx) => {
      const ratio = STRATEGY_RATIO[ctx.novel.contextStrategy as Strategy] ?? STRATEGY_RATIO.balanced;
      const detail = previousChapter(ctx.novelId, ctx.indexNo);
      if (!detail?.content) return '';
      return `### 第${detail.indexNo}章 ${detail.title}\n\n${tail(detail.content, ratio.previous)}`;
    },
  },
  {
    name: 'previous_full',
    purpose:
      '上一章正文全文，用于需要严格衔接的行文。内容较长，默认不注入，请在规则清单里勾选「上一章全文」。',
    category: 'assistant',
    resolve: (ctx) => {
      const detail = previousChapter(ctx.novelId, ctx.indexNo);
      if (!detail?.content) return '';
      return `### 第${detail.indexNo}章 ${detail.title}\n\n${detail.content.trim()}`;
    },
  },
  {
    name: 'chapter',
    purpose: '本章的基本信息，包含序号、标题与目标字数。',
    category: 'user',
    emphasis: 'always',
    resolve: (ctx) => {
      const chapters = listChapters(ctx.novelId);
      const current = chapters.find((chapter) => chapter.indexNo === ctx.indexNo);
      const label = `第${ctx.indexNo}章`;
      const title = current?.title ?? '';
      const heading = title.startsWith('第') ? title : `${label} ${title}`.trim();
      return joinLines([
        `章节：${heading}`,
        current?.summary ? `已知摘要：${current.summary}` : '',
        '字数：正文 2000 到 3500 字，情节完整，不要在句中断开。',
      ]);
    },
  },
  {
    name: 'direction',
    purpose: '本次生成时填写的额外要求。',
    category: 'user',
    resolve: (ctx) => ctx.direction,
  },
  {
    name: 'tags',
    purpose: '本章已有的标签。',
    category: 'user',
    resolve: (ctx) => tagsOfChapter(ctx.novelId, ctx.chapterRef).join('、'),
  },
  {
    name: 'budget',
    purpose: '当前上下文预算与用量提醒。',
    category: 'system',
    resolve: (ctx) => {
      const used = ctx.segments.reduce((total, segment) => total + segment.tokens, 0);
      const percent = ctx.budget > 0 ? Math.round((used / ctx.budget) * 100) : 0;
      return joinLines([
        `上下文上限：${ctx.budget} token`,
        `当前估算：${used} token，占比 ${percent}%`,
        percent > 100 ? '已超出上限，请精简勾选的规则或缩小上下文策略。' : '',
      ]);
    },
  },
  {
    name: 'payload_schema',
    purpose: '正文之外补充数据必须遵守的固定 JSON 结构。',
    category: 'system',
    resolve: () => PAYLOAD_SCHEMA_DOC,
  },
];

export const TAG_NAMES = TAG_DEFINITIONS.map((tag) => tag.name);

export function listTagDefinitions(): { name: string; purpose: string; category: RuleCategory }[] {
  return TAG_DEFINITIONS.map((tag) => ({
    name: tag.name,
    purpose: tag.purpose,
    category: tag.category,
  }));
}

/** 角色图鉴文本：主角与配角保留完整字段，其余角色只保留一句简介。 */
function characterText(novelId: string): string {
  const characters = listCharacters(novelId);
  if (characters.length === 0) return '';
  return characters
    .map((character) => {
      if (character.role === 'supporting') {
        return `- ${character.name}${character.summary ? `：${character.summary}` : ''}`;
      }
      return joinLines([
        `### ${character.name}${character.role === 'protagonist' ? '（主角）' : '（配角）'}`,
        character.aliases.length > 0 ? `别称：${character.aliases.join('、')}` : '',
        character.identity ? `身份：${character.identity}` : '',
        character.personality ? `性格：${character.personality}` : '',
        character.abilities ? `能力体系：${character.abilities}` : '',
        character.foreshadowing ? `伏笔：${character.foreshadowing}` : '',
        character.summary ? `简介：${character.summary}` : '',
      ]);
    })
    .join('\n');
}

/** 摘要分级：近期完整，中期保留首句，远期只留标题。 */
function summaryText(novelId: string, currentIndex: number, strategy: Strategy): string {
  const ratio = STRATEGY_RATIO[strategy] ?? STRATEGY_RATIO.balanced;
  const chapters = listChapters(novelId).filter(
    (chapter) => chapter.indexNo < currentIndex && chapter.indexNo > -100000,
  );
  if (chapters.length === 0) return '';
  const prioritized = [...chapters].sort((a, b) => {
    const scoreA = importanceScore(a.ref, a.summary) - a.indexNo * 0.01;
    const scoreB = importanceScore(b.ref, b.summary) - b.indexNo * 0.01;
    return scoreB - scoreA;
  });
  const keepRecent = new Set(chapters.slice(-ratio.recent).map((chapter) => chapter.ref));
  const keepMid = new Set(prioritized.slice(0, ratio.mid).map((chapter) => chapter.ref));
  return chapters
    .map((chapter) => {
      if (keepRecent.has(chapter.ref)) {
        return `- 第${chapter.indexNo}章 ${chapter.title}${chapter.summary ? `：${chapter.summary}` : ''}`;
      }
      if (keepMid.has(chapter.ref)) {
        const firstSentence = chapter.summary.split(/[。！？]/)[0] ?? '';
        return `- 第${chapter.indexNo}章 ${chapter.title}${firstSentence ? `：${firstSentence}。` : ''}`;
      }
      return `- 第${chapter.indexNo}章 ${chapter.title}`;
    })
    .join('\n');
}

/** 情节重要性：带转折、高潮等标签的章节优先保留细节。 */
function importanceScore(ref: string, summary: string): number {
  const chapterTags = summary ? 2 : 0;
  const boost = /(转折|高潮|关键|伏笔|真相|决战)/.test(summary) ? 3 : 0;
  return chapterTags + boost + ref.length * 0;
}

function encyclopediaText(novelId: string, query: string, strategy: Strategy): string {
  const ratio = STRATEGY_RATIO[strategy] ?? STRATEGY_RATIO.balanced;
  const entries = listEntries(novelId);
  if (entries.length === 0) return '';
  const scored = entries.map((entry) => {
    let score = 0;
    if (query.includes(entry.title)) score += 6;
    for (const tag of entry.tags) {
      if (query.includes(tag)) score += 2;
    }
    if (entry.summary && query.includes(entry.summary.slice(0, 6))) score += 1;
    return { entry, score };
  });
  const sorted = scored.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
  return sorted
    .slice(0, ratio.encyclopedia)
    .map(({ entry }) => {
      const body = entry.content.trim();
      const compact = body.length > 0 ? body : entry.summary;
      return `### ${entry.title}\n${entry.summary ? `${entry.summary}\n` : ''}${compact}`;
    })
    .join('\n\n');
}

/** 解析出各标签的实际文本。 */
export function resolveTags(options: ContextOptions & { novelId: string }): {
  values: Map<string, string>;
  previews: TagPreview[];
  query: string;
} {
  const novel = requireNovel(options.novelId);
  const chapterRef = options.chapterRef ?? '';
  const indexNo = chapterRef ? Number(chapterRef.split(':')[1] ?? 0) : 0;
  const direction = options.direction ?? '';
  const budget = options.budget ?? novel.tokenBudget;

  const segments: ContextSegment[] = [];
  const ctx: TagContext = {
    novelId: options.novelId,
    novel,
    chapterRef,
    indexNo,
    direction,
    query: '',
    budget,
    segments,
  };

  // 先算出查询文本，供百科相关性判断使用
  const currentOutline = indexNo ? outlineForChapter(options.novelId, indexNo) : '';
  const recent = listChapters(options.novelId).filter((chapter) => chapter.indexNo < indexNo);
  const previousTitle = recent[recent.length - 1]?.summary ?? '';
  ctx.query = joinLines([
    currentOutline,
    previousTitle,
    direction,
    tagsOfChapter(options.novelId, chapterRef).join(' '),
  ]);

  const values = new Map<string, string>();
  const previews: TagPreview[] = [];
  for (const tag of TAG_DEFINITIONS) {
    let text = '';
    try {
      text = tag.resolve(ctx) ?? '';
    } catch {
      text = '';
    }
    values.set(tag.name, text);
    previews.push({
      name: tag.name,
      purpose: tag.purpose,
      sample: text,
      empty: text.trim() === '',
    });
  }
  return { values, previews, query: ctx.query };
}

/** 把模板里的 {{标签}} 替换成实际文本。未知标签替换为空串并保留原样提示。 */
export function renderTemplate(template: string, values: Map<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => {
    const key = name.toLowerCase();
    if (!values.has(key)) return match;
    return values.get(key) ?? '';
  });
}

export interface AssembledContext {
  system: string;
  userPrompt: string;
  assistantSeed: string;
  segments: ContextSegment[];
  previews: TagPreview[];
  totalTokens: number;
  budget: number;
  overBudget: boolean;
}

/**
 * 组装一次生成所需的全部消息内容。
 *
 * 规则清单里的每一项都受勾选与排序控制：
 * 基础规则模板渲染后进入它被拖到的分组，独立规则按同一个分组顺序拼接；
 * 模板里出现的 {{regulars}} 会展开为「同一分组」的独立规则，
 * 这种情况下该分组的独立规则不再重复追加一次。
 */
export function assembleContext(options: ContextOptions & { novelId: string }): AssembledContext {
  const novel = requireNovel(options.novelId);
  const budget = options.budget ?? novel.tokenBudget;
  const resolved = resolveTags({ ...options, budget });
  const baseValues = resolved.values;
  const baseRules = listBaseRules();

  const segments: ContextSegment[] = [];
  const push = (key: string, label: string, category: RuleCategory, text: string) => {
    segments.push({
      key,
      label,
      category,
      text,
      chars: text.length,
      tokens: estimateTokens(text),
      truncated: false,
      empty: text.trim() === '',
    });
  };

  const checklist = activeRules(options.novelId);
  const byCategory: Record<RuleCategory, string> = { system: '', user: '', assistant: '' };
  const consumedRegulars: Record<RuleCategory, boolean> = {
    system: false,
    user: false,
    assistant: false,
  };

  for (const category of CATEGORIES) {
    const parts: string[] = [];
    // 每个分组单独给出一份标签取值，让 {{regulars}} 展开成本分组的独立规则
    const regularsText = renderIndependentRules(options.novelId, category);
    const values = new Map(baseValues);
    values.set('regulars', regularsText);
    values.set('rules', regularsText);

    for (const binding of checklist[category]) {
      if (binding.kind === 'base') {
        const rule = baseRules.find((item) => item.id === binding.refId);
        if (!rule) continue;
        if (/\{\{\s*(regulars|rules)\s*\}\}/i.test(rule.content)) consumedRegulars[category] = true;
        const rendered = renderTemplate(rule.content, values);
        parts.push(rendered);
        push(`base-${rule.slot}`, rule.title, category, rendered);
        continue;
      }
      // 独立规则：正文为空的规则不发送
      if (binding.preview.trim() === '') continue;
      const rendered = `## ${binding.title}\n\n${renderTemplate(binding.preview, values).trim()}`;
      if (!consumedRegulars[category]) parts.push(rendered);
    }

    if (!consumedRegulars[category] && regularsText.trim() !== '') {
      parts.push(regularsText);
      push(`rules-${category}`, `独立规则（${category}）`, category, regularsText);
    }

    byCategory[category] = parts.filter((part) => part.trim() !== '').join('\n\n');
  }

  const { system, user: userPrompt, assistant: assistantSeed } = byCategory;
  const totalTokens = estimateTokens(system) + estimateTokens(userPrompt) + estimateTokens(assistantSeed);

  return {
    system,
    userPrompt,
    assistantSeed,
    segments,
    previews: resolved.previews,
    totalTokens,
    budget,
    overBudget: totalTokens > budget,
  };
}

/** 供接口使用的上下文预览。 */
export function previewContext(options: ContextOptions & { novelId: string }): ContextPreview {
  const novel = requireNovel(options.novelId);
  const assembled = assembleContext(options);
  const budget = options.budget ?? novel.tokenBudget;
  return {
    segments: assembled.segments,
    totalTokens: assembled.totalTokens,
    budget,
    overBudget: assembled.totalTokens > budget,
    strategy: (options.strategy ?? novel.contextStrategy) as ContextStrategy,
    tags: assembled.previews,
  };
}

export { STRATEGY_RATIO, TAG_DEFINITIONS };
