/**
 * 模型标识。
 *
 * 界面上需要一眼看出当前用的是哪家模型，这里按供应商地址与名称匹配一个图标与配色。
 * 匹配失败时退回通用图标，不会因为新增供应商而找不到展示。
 */

export interface ModelIdentity {
  /** Font Awesome 图标类名，不含 fa-solid 前缀 */
  icon: string;
  /** 主题色，取自全局令牌 */
  color: string;
  /** 展示用的短名 */
  label: string;
}

interface Rule extends ModelIdentity {
  match: RegExp;
}

const RULES: Rule[] = [
  { match: /deepseek/i, icon: 'fa-water', color: 'var(--color-accent-2)', label: 'DeepSeek' },
  { match: /bigmodel|zhipu|(^|[^a-z])glm/i, icon: 'fa-brain', color: '#8b7bff', label: 'GLM' },
  { match: /xiaomimimo|mimo/i, icon: 'fa-mobile-screen-button', color: '#ff9f43', label: 'MiMo' },
  { match: /openai|gpt-/i, icon: 'fa-robot', color: '#7bd88f', label: 'OpenAI' },
  { match: /ollama|127\.0\.0\.1|localhost/i, icon: 'fa-server', color: '#b6b6c4', label: '本地' },
  { match: /moonshot|kimi/i, icon: 'fa-moon', color: '#7aa2ff', label: 'Moonshot' },
  { match: /dashscope|qwen|aliyun/i, icon: 'fa-cloud', color: '#5ce1ff', label: '通义' },
  { match: /siliconflow/i, icon: 'fa-layer-group', color: '#c8ff4d', label: 'SiliconFlow' },
  { match: /anthropic|claude/i, icon: 'fa-feather', color: '#e0a06a', label: 'Claude' },
  { match: /gemini|google/i, icon: 'fa-gem', color: '#6aa9ff', label: 'Gemini' },
];

const FALLBACK: ModelIdentity = { icon: 'fa-plug', color: 'var(--color-muted)', label: '自定义' };

/** 判断某个模型是否属于推理模型，用于在界面上提示「思考中」。 */
export function isReasoningModel(model: string): boolean {
  return /reasoner|thinking|r1|o1|o3|qwq|deepseek-r/i.test(model);
}

export function resolveModelIdentity(input: {
  name?: string;
  baseUrl?: string;
  model?: string;
}): ModelIdentity {
  const haystack = [input.baseUrl ?? '', input.name ?? '', input.model ?? ''].join(' ');
  for (const rule of RULES) {
    if (rule.match.test(haystack)) {
      return { icon: rule.icon, color: rule.color, label: rule.label };
    }
  }
  return FALLBACK;
}
