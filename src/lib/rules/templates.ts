import type { BaseRuleKind } from '../types';

/**
 * 内置基础规则模板。
 *
 * 基础规则是全局生效的提示词模板，里面用 {{标签}} 引用运行时内容。
 * 用户可以在设置里改写模板，改坏了可以一键恢复默认。
 */

export interface BaseRuleSeed {
  slot: string;
  title: string;
  kind: BaseRuleKind;
  description: string;
  content: string;
  /** 新建小说时默认是否勾选。用于体积大、按需开启的注入项。 */
  enabledByDefault?: boolean;
}

/** 输出结构说明，供提示词模板中的 {{payload_schema}} 标签展开。 */
export const PAYLOAD_SCHEMA_DOC = `{
  "title": "字符串，本章标题，不含“第 N 章”前缀",
  "summary": "字符串，本章剧情摘要，120 字以内",
  "content": "字符串，本章正文，Markdown 格式，段落之间空一行",
  "characters": [
    {
      "name": "角色称呼，必填",
      "role": "protagonist 主角 / major 配角 / supporting 次要角色",
      "aliases": ["别称"],
      "identity": "身份",
      "personality": "性格",
      "abilities": "能力体系",
      "foreshadowing": "与该角色相关的伏笔与回收情况",
      "summary": "一句话简介"
    }
  ],
  "relations": [
    { "from": "角色甲", "to": "角色乙", "label": "关系描述", "kind": "关系类型", "strength": 0.8 }
  ],
  "encyclopedia": [
    {
      "title": "条目名",
      "category": "place 地名 / race 种族 / creature 动植物 / item 器物 / concept 概念 / event 事件 / other 其他",
      "tags": ["标签"],
      "summary": "一句话定义",
      "content": "条目正文"
    }
  ],
  "tags": ["本章内容标签"],
  "postprocess": ["后续处理语句，见后续处理语法说明"],
  "nextOutline": "字符串，下一章的一句话大纲，可选"
}`;

/** 后续处理语法说明，会作为 postprocess 类型的基础规则默认内容。 */
export const POSTPROCESS_DOC = `## 后续处理语法

后续处理是一段小型脚本，用来把 AI 生成的结果写回小说的结构化数据。
每条语句占一行，写成 对象.方法(参数) 的形式，不需要分号，不支持变量与循环。

### 对象与方法

chara.add({ name: "李四", role: "major", identity: "青云宗内门弟子", personality: "谨慎" })
chara.update("张三", { personality: "外冷内热", abilities: "御剑术" })
chara.rename("旧称呼", "新称呼")
chara.remove("王五")

relation.add({ from: "张三", to: "李四", label: "同门", kind: "师门", strength: 0.6 })
relation.remove({ from: "张三", to: "李四" })

wiki.add({ title: "青云山", category: "place", summary: "青云宗山门所在", content: "正文内容" })
wiki.update("青云山", { content: "补充后的正文内容" })
wiki.remove("青云山")

outline.set(12, "第十二章的一句话大纲")
outline.insert(13, "追加到第十三章的大纲")

tag.add("1:12", "转折")
tag.remove("1:12", "转折")

summary.set("1:12", "本章摘要")
log.note("本次生成补全了青云山的地貌设定")

### 注意

- 参数中的字符串使用双引号，对象使用花括号，数组使用方括号，数字与 true、false 直接写。
- 角色称呼必须与角色图鉴中的称呼一致，新的次要角色可以先用 chara.add 建条目。
- 龙套角色不要写入图鉴，只在正文里出现即可。
- 所有修改都会写入永久修改日志，可以据此还原。`;

export const DEFAULT_BASE_RULES: BaseRuleSeed[] = [
  {
    slot: 'system-prompt',
    title: '主提示词模板',
    kind: 'prompt',
    description: '章节生成时作为 system 消息发送的模板，其中可使用特殊标签。',
    content: `你是一位擅长中文网络小说的资深写手，负责续写下面这部作品。

## 作品信息
{{novel}}

## 写作要求
{{regulars}}

## 故事大纲
{{outline}}

## 角色图鉴
{{characters}}

## 角色关系
{{relations}}

## 世界观百科
{{encyclopedia}}

## 前文脉络
{{summaries}}

## 上一章结尾
{{previous}}

## 本章任务
{{chapter}}
{{direction}}

## 上下文预算
{{budget}}`,
  },
  {
    slot: 'output-format',
    title: '输出格式与 JSON 约束',
    kind: 'prompt',
    description: '规定正文之外的补充数据必须使用固定 JSON 结构，便于后续解析。',
    content: `## 输出格式

只返回一个 JSON 对象，不要输出任何额外解释，不要使用代码块围栏以外的内容。

{{payload_schema}}

正文之外的内容必须放进上述字段，不要自由发挥结构。
不需要写入的数组直接留空数组，不要省略字段。`,
  },
  {
    slot: 'postprocess',
    title: '后续处理语法',
    kind: 'postprocess',
    description: '定义如何把生成结果写回角色图鉴、关系网、百科全书、大纲与标签。',
    content: POSTPROCESS_DOC,
  },
  {
    slot: 'previous-chapter',
    title: '上一章全文',
    kind: 'prompt',
    description:
      '勾选后把上一章正文完整注入上下文，适合需要严格衔接的行文；不勾选时只保留上一章结尾片段。',
    enabledByDefault: false,
    content: `## 上一章正文

{{previous_full}}`,
  },
];
