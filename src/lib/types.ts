/** 领域模型定义。数据库行、接口载荷与界面状态共用这里的类型。 */

/** 规则在提示词中扮演的角色，决定它被放进 system、user 还是 assistant 消息。 */
export type RuleCategory = 'system' | 'user' | 'assistant';

/** 基础规则的种类，提示词模板参与拼装，后续处理模板定义解析行为。 */
export type BaseRuleKind = 'prompt' | 'postprocess';

/** 角色在图鉴中的定位。龙套角色不进入图鉴。 */
export type CharacterRole = 'protagonist' | 'major' | 'supporting';

/** 章节状态。draft 表示已生成但未确认写入，done 表示正式正文。 */
export type ChapterStatus = 'idle' | 'draft' | 'done';

/** 百科条目分类。 */
export type EncyclopediaCategory =
  | 'place'
  | 'race'
  | 'creature'
  | 'item'
  | 'concept'
  | 'event'
  | 'other';

/** 修改日志里的动作类型。 */
export type ChangeAction = 'create' | 'update' | 'delete';

/** 修改日志的来源。 */
export type ChangeSource = 'ai' | 'user' | 'system';

/** 阅读模式。 */
export type ReadingMode = 'page' | 'instant' | 'scroll';

/** 上下文策略，控制注入内容的取舍力度。 */
export type ContextStrategy = 'balanced' | 'quality' | 'frugal';

/** 生成场景，可为不同场景指定不同模型。 */
export type GenScene = 'chapter' | 'outline' | 'character' | 'encyclopedia' | 'chat';

/**
 * 供应商使用的请求协议。
 * openai 走 /chat/completions，anthropic 走 /messages，两者的鉴权头、
 * 消息体结构与流式事件名都不同，统一在这一层分派。
 */
export type ProviderProtocol = 'openai' | 'anthropic';

/** 供应商是否支持原生的批量推理接口。 */
export type BatchSupport = 'none' | 'anthropic' | 'openai';

/* ------------------------------- 批量推理 ------------------------------- */

/**
 * 批量任务的执行方式。
 * provider 走供应商的原生批量接口（异步、通常有五折优惠）；
 * local 是在本地按并发受控地逐章调用，任何供应商都能用。
 */
export type BatchJobKind = 'provider' | 'local';

export type BatchJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
export type BatchItemStatus = 'pending' | 'running' | 'done' | 'failed';

export interface BatchJob {
  id: string;
  novelId: string;
  kind: BatchJobKind;
  protocol: ProviderProtocol;
  providerId: string;
  model: string;
  scene: string;
  status: BatchJobStatus;
  total: number;
  completed: number;
  failed: number;
  /** 供应商侧的批量任务编号 */
  remoteId: string;
  /** 结果文件地址，Anthropic 会直接给 */
  resultsUrl: string;
  options: {
    mode: 'auto' | 'provider' | 'local';
    direction?: string;
    concurrency?: number;
    thinking?: boolean;
    maxTokens?: number;
  };
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface BatchItem {
  jobId: string;
  ref: string;
  customId: string;
  status: BatchItemStatus;
  attempts: number;
  message: string;
  tokens: number;
  updatedAt: string;
}

export interface BatchJobDetail extends BatchJob {
  items: BatchItem[];
}

export interface Novel {
  id: string;
  title: string;
  author: string;
  description: string;
  genre: string;
  pov: string;
  tone: string;
  fontSize: number;
  lineHeight: number;
  dialogueHighlight: boolean;
  readingMode: ReadingMode;
  contextStrategy: ContextStrategy;
  tokenBudget: number;
  hasCover: boolean;
  coverVersion: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface NovelInput {
  title: string;
  author?: string;
  description?: string;
  genre?: string;
  pov?: string;
  tone?: string;
}

export interface Volume {
  index: number;
  title: string;
  summary: string;
}

export interface Chapter {
  novelId: string;
  ref: string;
  volIndex: number;
  indexNo: number;
  title: string;
  summary: string;
  status: ChapterStatus;
  wordCount: number;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterDetail extends Chapter {
  content: string;
}

/** 独立规则：标题与正文，正文为空时不发送。 */
export interface IndependentRule {
  id: number;
  novelId: string;
  title: string;
  file: string;
  content: string;
  category: RuleCategory;
  sortOrder: number;
  enabled: boolean;
  chars: number;
  updatedAt: string;
}

/** 基础规则：全局生效，包含提示词模板与后续处理模板。 */
export interface BaseRule {
  id: number;
  title: string;
  kind: BaseRuleKind;
  content: string;
  description: string;
  isBuiltin: boolean;
  updatedAt: string;
}

/**
 * 规则绑定：把某条规则（基础或独立）挂到某部小说的排序清单里。
 * 绑定决定角色分组、排序与是否发送，因此基础规则也能在单部小说里调整。
 */
export interface RuleBinding {
  id: number;
  novelId: string;
  kind: 'base' | 'independent';
  refId: number;
  title: string;
  preview: string;
  category: RuleCategory;
  sortOrder: number;
  enabled: boolean;
  chars: number;
}

export interface RuleChecklist {
  system: RuleBinding[];
  user: RuleBinding[];
  assistant: RuleBinding[];
}

export interface Relation {
  id: number;
  novelId: string;
  from: string;
  to: string;
  label: string;
  kind: string;
  strength: number;
  createdAt: string;
}

export interface Character {
  id: number;
  novelId: string;
  name: string;
  role: CharacterRole;
  aliases: string[];
  identity: string;
  personality: string;
  abilities: string;
  foreshadowing: string;
  summary: string;
  file: string;
  positionX: number;
  positionY: number;
  createdAt: string;
  updatedAt: string;
}

export interface EncyclopediaEntry {
  id: number;
  novelId: string;
  title: string;
  category: EncyclopediaCategory;
  tags: string[];
  summary: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: number;
  novelId: string;
  name: string;
  color: string;
  refs: string[];
}

export interface Bookmark {
  id: number;
  novelId: string;
  ref: string;
  chapterTitle: string;
  note: string;
  createdAt: string;
}

export interface ChangeLogEntry {
  id: number;
  novelId: string;
  target: string;
  targetId: string;
  action: ChangeAction;
  before: unknown;
  after: unknown;
  source: ChangeSource;
  note: string;
  restored: boolean;
  createdAt: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: ProviderProtocol;
  /** Anthropic 协议的扩展思考开关 */
  thinking: boolean;
  /** 批量推理能力，auto 表示按预设与协议推断 */
  batch: BatchSupport | 'auto';
  hasKey: boolean;
  keyMask: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  stream: boolean;
  maxRetries: number;
  timeoutMs: number;
  enabled: boolean;
  isDefault: boolean;
  isPreset: boolean;
  createdAt: string;
}

export interface ProviderInput {
  id?: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol?: ProviderProtocol;
  thinking?: boolean;
  batch?: BatchSupport | 'auto';
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface AppSettings {
  defaultProviderId: string | null;
  sceneProviders: Partial<Record<GenScene, string>>;
  locale: string;
  scene: string;
  tokenBudget: number;
  contextStrategy: ContextStrategy;
  dialogueHighlight: boolean;
  fontSize: number;
  lineHeight: number;
  autoSave: boolean;
}

export interface UsageRecord {
  id: number;
  novelId: string | null;
  providerId: string;
  model: string;
  scene: GenScene | 'test';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  createdAt: string;
}

export interface UsageSummary {
  totalPrompt: number;
  totalCompletion: number;
  totalTokens: number;
  calls: number;
  byModel: { model: string; tokens: number; calls: number }[];
  byScene: { scene: string; tokens: number; calls: number }[];
  recent: UsageRecord[];
}

/** AI 必须以固定 JSON 结构返回的补充数据，超出正文之外的内容都放在这里。 */
export interface AiChapterPayload {
  title?: string;
  summary?: string;
  content?: string;
  characters?: AiCharacterDraft[];
  relations?: AiRelationDraft[];
  encyclopedia?: AiEncyclopediaDraft[];
  tags?: string[];
  postprocess?: string[];
  nextOutline?: string;
}

export interface AiCharacterDraft {
  name: string;
  role?: CharacterRole;
  aliases?: string[];
  identity?: string;
  personality?: string;
  abilities?: string;
  foreshadowing?: string;
  summary?: string;
}

export interface AiRelationDraft {
  from: string;
  to: string;
  label?: string;
  kind?: string;
  strength?: number;
}

export interface AiEncyclopediaDraft {
  title: string;
  category?: EncyclopediaCategory;
  tags?: string[];
  summary?: string;
  content?: string;
}

/** 后续处理语法执行后的单条结果。 */
export interface DslOperationResult {
  ok: boolean;
  target: string;
  method: string;
  description: string;
  error?: string;
}

export interface DslExecutionResult {
  results: DslOperationResult[];
  applied: number;
  failed: number;
}

export interface ContextSegment {
  key: string;
  label: string;
  category: RuleCategory;
  tokens: number;
  chars: number;
  text: string;
  truncated: boolean;
  empty: boolean;
}

export interface ContextPreview {
  segments: ContextSegment[];
  totalTokens: number;
  budget: number;
  overBudget: boolean;
  strategy: ContextStrategy;
  tags: TagPreview[];
}

export interface TagPreview {
  name: string;
  purpose: string;
  sample: string;
  empty: boolean;
}

/** 一次请求的 token 用量。estimated 为真表示是本地估算而非接口返回。 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}

/** 本次生成实际使用的模型与供应商，用于在界面上显示模型标识。 */
export interface GenerationMeta {
  providerId: string;
  providerName: string;
  model: string;
  /** Font Awesome 图标类名，不含 fa-solid 前缀 */
  icon: string;
  color: string;
  label: string;
  /** 是否为推理模型，为真时界面会展示思考内容 */
  reasoning: boolean;
}

export interface StreamEvent {
  type: 'meta' | 'phase' | 'reasoning' | 'delta' | 'usage' | 'ops' | 'done' | 'error';
  text?: string;
  message?: string;
  meta?: GenerationMeta;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; estimated: boolean };
  phase?: string;
  ops?: DslOperationResult[];
  payload?: AiChapterPayload;
}

export interface SearchHit {
  ref: string;
  indexNo: number;
  title: string;
  snippet: string;
  score: number;
  matched: 'title' | 'content';
}
