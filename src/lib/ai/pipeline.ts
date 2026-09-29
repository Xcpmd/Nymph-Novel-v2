import { assembleContext } from './context';
import { createContentExtractor, parseAiResponse } from './parse';
import { runChat, type ChatMessage, type TokenUsage } from './client';
import { isReasoningModel, resolveModelIdentity } from './model-icons';
import { listChapters, requireChapter, saveChapterContent, updateChapter } from '../store/chapters';
import { requireNovel } from '../store/novels';
import { resolveProviderForScene } from '../store/providers';
import { setOutlineLine, listOutline } from '../store/outline';
import { applyPayload } from '../rules/apply';
import { estimateTokens } from '../format';
import type {
  AiChapterPayload,
  DslOperationResult,
  GenScene,
  GenerationMeta,
  ProviderConfig,
  StreamEvent,
} from '../types';

/**
 * 生成链路。
 *
 * 组装上下文 → 调用模型 → 增量提取正文 → 解析固定 JSON → 落盘与数据回写。
 * 全过程通过事件回调对外汇报，便于接口以流式方式转发给界面。
 */

export interface GenerateOptions {
  novelId: string;
  chapterRef: string;
  direction?: string;
  /** 续写时已有的正文，会作为 assistant 前缀一并发送。 */
  prefix?: string;
  regenerate?: boolean;
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
}

export interface GenerateResult {
  content: string;
  /** 推理模型在正文之前输出的思考内容，普通模型为空 */
  reasoning: string;
  payload: AiChapterPayload;
  ops: DslOperationResult[];
  usage: TokenUsage;
  providerId: string;
  model: string;
  meta: GenerationMeta;
  aborted: boolean;
}

/** 汇总本次生成会用到的模型信息，随第一个事件下发给界面。 */
export function buildGenerationMeta(config: ProviderConfig): GenerationMeta {
  const identity = resolveModelIdentity({
    name: config.name,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  return {
    providerId: config.id,
    providerName: config.name,
    model: config.model,
    icon: identity.icon,
    color: identity.color,
    label: identity.label,
    reasoning: isReasoningModel(config.model),
  };
}

function buildMessages(
  system: string,
  userPrompt: string,
  assistantSeed: string,
  fallbackUser: string,
  prefix?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (system.trim()) messages.push({ role: 'system', content: system });
  if (assistantSeed.trim()) messages.push({ role: 'assistant', content: assistantSeed });
  messages.push({ role: 'user', content: userPrompt.trim() || fallbackUser });
  if (prefix && prefix.trim()) {
    messages.push({
      role: 'assistant',
      content: `${prefix}\n\n从上面正文的结尾继续写下去，不要重复已经写过的内容，直接接着写。`,
    });
    messages.push({ role: 'user', content: '继续。' });
  }
  return messages;
}

/** 查一下某个场景当前会用哪个模型，供页面在生成之前就显示模型标识。 */
export function currentModelMeta(scene: GenScene): GenerationMeta | null {
  const resolved = resolveProviderForScene(scene);
  if (!resolved) return null;
  return buildGenerationMeta(resolved.config);
}

export async function generateChapter(options: GenerateOptions): Promise<GenerateResult> {
  const chapter = requireChapter(options.novelId, options.chapterRef);
  const resolved = resolveProviderForScene('chapter');
  if (!resolved) {
    throw new Error('没有可用的模型配置，请先到设置里添加供应商与 API Key');
  }
  const { config } = resolved;

  const context = assembleContext({
    novelId: options.novelId,
    chapterRef: options.chapterRef,
    direction: options.direction ?? '',
  });

  const fallbackUser = options.regenerate
    ? `请重新写一遍第${chapter.indexNo}章，换一个展开方式，保持大纲要求不变。`
    : `请开始写第${chapter.indexNo}章。`;

  const messages = buildMessages(
    context.system,
    context.userPrompt,
    context.assistantSeed,
    fallbackUser,
    options.prefix,
  );

  const meta = buildGenerationMeta(config);
  options.onEvent({ type: 'meta', meta });

  // 上下文已经算好了，先把输入侧的 token 用量发出去，界面能立刻显示规模
  const promptTokens = estimateTokens(messages.map((message) => message.content).join('\n'));
  options.onEvent({
    type: 'usage',
    usage: { promptTokens, completionTokens: 0, totalTokens: promptTokens, estimated: true },
  });

  options.onEvent({ type: 'phase', phase: 'requesting' });

  const extractor = createContentExtractor();
  let buffer = '';
  let streamed = '';
  let reasoningText = '';
  let lastUsageTick = 0;

  let result: Awaited<ReturnType<typeof runChat>>;
  try {
    result = await runChat({
      providerId: config.id,
      messages,
      scene: 'chapter',
      novelId: options.novelId,
      signal: options.signal,
      onReasoning: (delta) => {
        reasoningText += delta;
        options.onEvent({ type: 'reasoning', text: delta });
      },
      onDelta: (delta) => {
        buffer += delta;
        const contentDelta = extractor(buffer);
        if (contentDelta) {
          streamed += contentDelta;
          options.onEvent({ type: 'delta', text: contentDelta });
        }
        // 每积累约 200 字汇报一次估算用量，避免事件过于密集
        if (streamed.length - lastUsageTick >= 200) {
          lastUsageTick = streamed.length;
          const completionTokens = estimateTokens(streamed);
          options.onEvent({
            type: 'usage',
            usage: {
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
              estimated: true,
            },
          });
        }
      },
    });
  } catch (error) {
    // 用户暂停时保留已经生成的部分，作为草稿继续留在章节里
    if (options.signal?.aborted) {
      options.onEvent({ type: 'phase', phase: 'aborted' });
      const partial = streamed.trim();
      const completionTokens = estimateTokens(partial);
      return {
        content: partial,
        reasoning: reasoningText.trim(),
        payload: partial ? { content: partial } : {},
        ops: [],
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          estimated: true,
        },
        providerId: config.id,
        model: config.model,
        meta,
        aborted: true,
      };
    }
    throw error;
  }

  options.onEvent({ type: 'phase', phase: 'parsing' });

  const parsed = parseAiResponse(result.content || buffer);
  const payload = parsed.payload;
  const content = (payload.content ?? '').trim() || streamed.trim();

  options.onEvent({ type: 'usage', usage: result.usage });

  return {
    content,
    reasoning: result.reasoning.trim() || reasoningText.trim(),
    payload,
    ops: [],
    usage: result.usage,
    providerId: config.id,
    model: config.model,
    meta,
    aborted: false,
  };
}

/**
 * 把生成结果落盘。
 * 生成过程与写入分开，界面可以先预览再决定是否写入正文。
 */
export function persistGeneration(
  novelId: string,
  chapterRef: string,
  content: string,
  payload: AiChapterPayload,
  status: 'draft' | 'done',
): { ops: DslOperationResult[]; chapter: ReturnType<typeof requireChapter> } {
  const chapter = requireChapter(novelId, chapterRef);
  const chapterTitle = payload.title?.trim();
  if (chapterTitle && chapter.status === 'idle') {
    updateChapter(novelId, chapterRef, { title: chapterTitle });
  }
  if (payload.summary?.trim()) {
    updateChapter(novelId, chapterRef, { summary: payload.summary.trim() });
  }
  saveChapterContent(novelId, chapterRef, content, {
    status,
    source: 'ai',
    silent: false,
  });
  const applied = applyPayload(novelId, payload, chapterRef, 'ai');
  if (payload.nextOutline?.trim()) {
    const indexNo = Number(chapterRef.split(':')[1] ?? 0) + 1;
    const exists = listOutline(novelId).some((line) => line.indexNo === indexNo);
    if (!exists) setOutlineLine(novelId, indexNo, payload.nextOutline.trim(), undefined, 'ai');
  }
  return { ops: applied.results, chapter: requireChapter(novelId, chapterRef) };
}

/* ------------------------------ 大纲相关的调用 ------------------------------ */

export interface OutlineAssistOptions {
  novelId: string;
  instruction: string;
  mode: 'rewrite' | 'generate';
  currentOutline: string;
  signal?: AbortSignal;
  /** 传入后会以流式方式汇报增量文本与思考内容 */
  onEvent?: (event: StreamEvent) => void;
}

export async function assistOutline(options: OutlineAssistOptions): Promise<{
  text: string;
  reasoning: string;
  usage: TokenUsage;
  meta: GenerationMeta;
}> {
  const novel = requireNovel(options.novelId);
  const resolved = resolveProviderForScene('outline');
  if (!resolved) throw new Error('没有可用的模型配置，请先到设置里添加供应商与 API Key');

  const chapters = listChapters(options.novelId).length;
  const system = [
    '你是一位网络小说的责任编辑，负责整理与打磨故事大纲。',
    `当前作品：《${novel.title}》${novel.genre ? `，题材 ${novel.genre}` : ''}${novel.tone ? `，基调 ${novel.tone}` : ''}`,
    novel.description ? `作品简介：${novel.description}` : '',
    '',
    '输出要求：',
    '只输出大纲本身，每章一行，行首写「第N章 」，不要输出任何解释与前后缀。',
    '每行包含本章的核心事件与推进节点，控制在 60 字以内。',
    chapters > 0 ? `当前已写到第 ${chapters} 章，请保证衔接。` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const user =
    options.mode === 'generate'
      ? [
          '现有大纲如下，如果为空就从头生成：',
          '```',
          options.currentOutline || '（空）',
          '```',
          `我的要求：${options.instruction || '按照作品设定生成一份完整的章节大纲'}`,
        ].join('\n')
      : [
          '现有大纲如下：',
          '```',
          options.currentOutline || '（空）',
          '```',
          `请按要求修改：${options.instruction || '润色并补齐缺失的章节'}`,
          '请返回修改后的完整大纲。',
        ].join('\n');

  const meta = buildGenerationMeta(resolved.config);
  options.onEvent?.({ type: 'meta', meta });
  options.onEvent?.({
    type: 'usage',
    usage: { promptTokens: estimateTokens(system + user), completionTokens: 0, totalTokens: estimateTokens(system + user), estimated: true },
  });
  options.onEvent?.({ type: 'phase', phase: 'requesting' });

  const result = await runChat({
    providerId: resolved.config.id,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    scene: 'outline',
    novelId: options.novelId,
    signal: options.signal,
    onDelta: options.onEvent ? (delta) => options.onEvent?.({ type: 'delta', text: delta }) : undefined,
    onReasoning: options.onEvent
      ? (delta) => options.onEvent?.({ type: 'reasoning', text: delta })
      : undefined,
  });

  options.onEvent?.({ type: 'usage', usage: result.usage });

  const text = result.content
    .replace(/^```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  return { text, reasoning: result.reasoning.trim(), usage: result.usage, meta };
}

/* ------------------------------ 自由对话与提取 ------------------------------ */

export interface ExtractionOptions {
  novelId: string;
  scene: 'character' | 'encyclopedia' | 'chat';
  instruction: string;
  source?: string;
  signal?: AbortSignal;
  onEvent?: (event: StreamEvent) => void;
}

/** 通用的提取类调用，返回原始文本，由调用方决定如何解析。 */
export async function runExtraction(options: ExtractionOptions): Promise<{
  text: string;
  reasoning: string;
  usage: TokenUsage;
  meta: GenerationMeta;
}> {
  const novel = requireNovel(options.novelId);
  const resolved = resolveProviderForScene(options.scene);
  if (!resolved) throw new Error('没有可用的模型配置，请先到设置里添加供应商与 API Key');

  const prompts: Record<ExtractionOptions['scene'], string> = {
    character:
      '从下面的小说正文中提取主要角色。只提取主角、配角与对剧情有推动作用的角色，龙套角色一律忽略。\n返回一个 JSON 数组，每项包含 name、role、aliases、identity、personality、abilities、foreshadowing、summary 字段。role 只能是 protagonist、major、supporting 之一。\n只返回 JSON 数组，不要任何解释。',
    encyclopedia:
      '从下面的小说正文中提取值得收录进百科全书的条目，包括地名、种族、动植物、器物、概念与事件。\n返回一个 JSON 数组，每项包含 title、category、tags、summary、content 字段。category 只能是 place、race、creature、item、concept、event、other 之一。\n只返回 JSON 数组，不要任何解释。',
    chat: '你是这部小说的创作助手，请根据作者的要求给出具体可用的建议。',
  };

  const user = [options.instruction, options.source ? `\n参考内容：\n${options.source}` : '']
    .join('\n')
    .trim();

  const meta = buildGenerationMeta(resolved.config);
  options.onEvent?.({ type: 'meta', meta });
  options.onEvent?.({ type: 'phase', phase: 'requesting' });

  const result = await runChat({
    providerId: resolved.config.id,
    messages: [
      { role: 'system', content: `${prompts[options.scene]}\n当前作品：《${novel.title}》` },
      { role: 'user', content: user || `请介绍一下《${novel.title}》目前的设定，并给出下一步写作建议。` },
    ],
    scene: options.scene,
    novelId: options.novelId,
    signal: options.signal,
    onDelta: options.onEvent ? (delta) => options.onEvent?.({ type: 'delta', text: delta }) : undefined,
    onReasoning: options.onEvent
      ? (delta) => options.onEvent?.({ type: 'reasoning', text: delta })
      : undefined,
  });

  options.onEvent?.({ type: 'usage', usage: result.usage });

  return { text: result.content.trim(), reasoning: result.reasoning.trim(), usage: result.usage, meta };
}
