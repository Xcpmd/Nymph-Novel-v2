# Nymph Novel v2 项目记忆

## 定位

按 `main.md` 从零重建的 AI 网络小说生成与管理系统。本地运行、单用户、全部数据留在本机。
与上一版（`H:\workbuddy\Nymph Novel`，端口 5180）并存，本项目端口 **5400**。

## 技术栈与版本（已验证可用）

- Next.js 16.3.6（App Router + Turbopack）、React 19.3、TypeScript 6.0.3
- Tailwind CSS 4.3.3（`@import 'tailwindcss'` + `@theme` 令牌，无 tailwind.config）
- better-sqlite3 13（SQLite 3.53.4，FTS5 trigram 可用）、Vitest 5、ESLint 9（扁平配置）
- Font Awesome 7、react-markdown 10 + rehype-sanitize + remark-gfm、zod、clsx

## 数据布局

- `novel/{novelId}/` —— 每部小说独立目录：`cover.png`、`vols/vol-XXX/{序号}.md`、`setting/{规则标题}.md`、`data/chara/{称呼}.md`、`data/base/`
- `data/nymph.db` —— 元数据、配置、加密后的 API Key、章节检索索引（chapter_index + chapter_fts）
- `data/secret.key` —— AES-256-GCM 主密钥，权限 0600
- 废稿章节：序号 ≤ -100000，存放于 `vols/vol-000/`
- 章节引用格式 `volIndex:indexNo`，如 `1:12`

## 前端约定

- **数据都在服务端算**：各页 `page.tsx` 是服务端组件，直接读仓库层把首屏数据传给客户端组件；
  筛选、排序、分页、目录生成、token 估算都在服务端完成，客户端只负责渲染与上报操作。
- **不做整页刷新**：改动后由接口回传最新数据（规则、章节、角色、百科等都是整份返回），
  客户端 `setState` 替换即可；没有任何 `router.refresh()`。
- **下拉菜单统一用 `@/components/ui/Dropdown`**，`primitives` 里已不再导出原生 `Select`。
- **实时保存**：`useAutosave`（防抖 1.5s 左右）+ `SaveState` 指示器，用于正文与大纲；
  组件库里的基础类带 `w-full`，需要固定宽度时要在外层套一个定宽 div。
- **AI 过程可视化**：`components/novel/AiStatus.tsx` 提供 `ModelBadge` / `TokenMeter` /
  `ThinkingPanel` / `AiWaiting`；SSE 事件协议为 meta → usage → phase → reasoning → delta → done。
- **AI 调用统一走 `useAiTask` / `useGeneration`**，都基于 `lib/client/sse.ts` 的 `streamSse`。
- **协议分派**：`ProviderConfig.protocol` 决定走 OpenAI 兼容（`/chat/completions`）还是
  Anthropic（`/messages`）。两者鉴权头、消息体、流式事件名都不同，分派集中在 `lib/ai/client.ts`：
  Anthropic 的 system 要提到顶层且消息必须 user/assistant 交替，由 `normalizeAnthropicMessages` 整理。
  扩展思考走 `thinking` 开关，开启后温度固定为 1。
- **批量推理**：`lib/ai/batch.ts` 一套任务模型两种执行方式——`provider` 走供应商原生批量
  （Anthropic `messages/batches`；OpenAI「上传 JSONL → 建 batch → 下载结果」），
  `local` 是本地并发受控队列。任务与逐条进度落 `batch_jobs` / `batch_items`，
  **调度靠客户端轮询 `/api/batches` 触发**（`advanceBatches`），因此刷新页面或重启服务都不会卡死。
  供应商是否有原生批量由 `resolveBatchSupport` 决定：显式声明优先，否则按预设与协议推断。

## 数据库结构变更须知

- 建表语句只在首次创建时生效，**给已有表补列必须同时改 `schema.ts` 与 `db/index.ts` 的 `ensureColumn`**。
- `migrate()` 每个进程只跑一次，连接缓存在 `globalThis`。**改完结构要重启 dev/prod 进程**，
  热重载不会重新执行迁移——遇到「列不存在 / 表不存在」先确认是不是旧进程。

## 关键设计

- **规则**：基础规则全局存数据库（`base_rules`，槽位：system-prompt / output-format / postprocess / previous-chapter）；
  独立规则正文写 `setting/{标题}.md`；`rule_bindings` 把两类规则统一挂到某部小说的排序清单，
  分 system / user / assistant 三组，支持跨组拖动与勾选。**基础规则同样受勾选控制**，
  同一分组内基础与独立规则按 sortOrder 交错；模板里的 `{{regulars}}` 只展开本分组的独立规则，
  且模板出现过该标签时不再重复追加一次。
- **特殊标签**：`{{novel}}`、`{{regulars}}`（本分组独立规则）、`{{outline}}`、`{{characters}}`、`{{relations}}`、
  `{{encyclopedia}}`、`{{summaries}}`、`{{previous}}`（上一章结尾）、`{{previous_full}}`（上一章全文，默认不勾选）、
  `{{chapter}}`、`{{direction}}`、`{{budget}}`、`{{payload_schema}}` 等，定义在 `src/lib/ai/context.ts`，
  支持 hover 预览替换结果。
- **章节排序**：序号即位置。`reorderChapters` 全局重编号并搬迁正文文件、章节行、标签、书签、检索索引与对应大纲行；
  拖拽语义在 `src/lib/chapters/order.ts`（纯函数，可单测）。标题里的「第N章」前缀会重编号。
- **AI 返回**：固定 JSON（title/summary/content/characters/relations/encyclopedia/tags/postprocess/nextOutline）。
  流式过程中用 `createContentExtractor` 从半截 JSON 里增量提取 content，实现正文实时显示。
- **后续处理 DSL**：`src/lib/rules/dsl.ts` 自研词法+语法分析（**不使用 eval**），
  `apply.ts` 把语句映射到仓库层写操作；所有写入自动进 changelog。
  目标与方法：`chara/relation/wiki/outline/tag/summary/log` × `add/update/remove/rename/set/insert`。
- **上下文预算**：按 novel.contextStrategy（quality/balanced/frugal）控制摘要分级与百科条数，
  `previewContext` 对外暴露每个片段的 token 估算。
- **关系网**：`src/components/novel/RelationGraph.tsx` 自研力导向布局 + SVG，
  `initialNodes` / `step` / `centerNodes` 是纯函数，可单测。

## 踩过的坑

- **Tailwind 类缺失**：Turbopack dev 下 CSS 按需编译，未访问过的路由里用到的
  `sm:grid-cols-[...]` 之类任意值类可能暂时没生成，导致布局看起来是单列。
  已在 `globals.css` 用 `@source "../**/*.{ts,tsx}"` 显式声明源码范围，
  并把工作台两栏、侧栏两栏写成 `.split-pane` / `.side-pane` 样式类，不依赖扫描。
- **组件库宽度冲突**：`Input`/`Select` 基础类里带 `w-full`，在 className 里传 `w-48` 不生效，
  需要外层套一个固定宽度的 div。
- **vitest 配置**：`vitest.config.ts` 在无 `"type":"module"` 的包里会被当成 CJS 加载并告警，
  改名为 `vitest.config.mts` 并把 `__dirname` 换成 `import.meta.dirname`。
- **DSL 死循环点**：两个节点初始坐标完全重合时斥力为 0，永远分不开；
  已在 `step` 里对 <1 的距离加确定性抖动，并让主角初始分布在小圆周上。

## 常用命令

```
npm run dev          # 5450 端口（端口由 package.json 决定）
npm run verify       # typecheck + lint + test + check:i18n
npm run smoke        # 端到端冒烟：需要服务已启动，建临时小说跑通排序/拆分/注入后自动清理
npm run smoke:ai     # AI 链路冒烟：本地 mock 一个流式模型，校验事件协议与落盘后自动清理
npm run smoke:batch  # 批量与协议冒烟：mock 双协议 + 批量接口，验证两条批量路径后自动清理
npm run check:css    # 检查生产构建产物里响应式类是否齐全
npm run seed         # 写入《啥龙》演示数据（幂等）
```

## 约定

- 所有界面文案集中在 `src/lib/i18n/zh.ts`，`scripts/check-i18n.mjs` 会校验缺失与废弃键。
- 数据访问层之外的代码不允许出现 `any`；DSL 不用 eval。
- 本机 Bash 工具的 PATH 不完整，命令前需显式补 PortableGit 的路径。
