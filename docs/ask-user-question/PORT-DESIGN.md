# 将 `rpiv-ask-user-question` Port 到 hawtian-pi-extensions 的设计说明

本文分析上游 [juicesharp/rpiv-mono/packages/rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) 的结构与实现要点，并对照本仓库扩展形态，给出可执行的 port 方案（非逐步改码清单，而是架构与阶段划分）。

**按顺序执行的步骤清单**（与本文 Phase / §7 对齐）：[EXECUTION-STEPS.md](./EXECUTION-STEPS.md)。

**实现原则（必守）**：port 时避免整文件拷贝上游；对齐本仓库结构与既有包；可复用逻辑优先用 `@htwang-contrib/common`，新共享能力放进 `packages/common`。见根目录 [AGENTS.md](../../AGENTS.md) **「Porting upstream code」**。

**源码阅读范围（2026-02）：**在本地 sparse clone 的 `packages/rpiv-ask-user-question` 下通读了全部**非测试** `.ts` 实现（`tool/`、`state/`、`view/` 下生产文件及根目录 `ask-user-question.ts`、`config.ts`、`events.ts`、`index.ts`），并**单独精读**了 `view/components/preview/*`（Markdown 预览）与 `view/components/multi-select-view.ts`（多选列表）。`*test.ts` / `*.test.ts` 未逐行复读（占行数多，但行为以生产代码与 README 为准）。

## 1. 上游扩展做什么

- 向 Pi 注册工具 **`ask_user_question`**：在需要澄清时，由模型发起**结构化问卷**（多题、多 Tab、单选/多选、选项说明、可选 Markdown `preview` 侧栏、提交前 Review、`Other`/聊天逃逸等）。
- **强依赖交互式 TUI**：`execute` 里检查 `ctx.hasUI`，否则返回 `details.error: "no_ui"`。
- **上游 rpiv 的 UI 挂载**：`ctx.ui.custom(..., { overlay: true, overlayOptions: { … } })`，在全屏浮层里跑自建的 `pi-tui` 组件树（问卷会话状态机 + 视图层）。
- **本仓库实现**：只使用 **`ctx.ui.custom(factory)`**（不传第二参数），组件落在 **编辑器槽**（`editorContainer`），与 [ghoseb/pi-askuserquestion](https://github.com/ghoseb/pi-askuserquestion) 一致；从 rpiv 迁视图时需按**单槽高度**重做布局，不维护浮层代码路径。

能力细节以 [上游 README](https://github.com/juicesharp/rpiv-mono/blob/main/packages/rpiv-ask-user-question/README.md) 为准（多 Tab、预览、备注、本地化、`pi.events` 通知等）。

## 2. 通读源码后的实现架构（细节级）

### 2.1 启动与依赖

- **`index.ts`**：`export default` 仅调用 `registerAskUserQuestionTool`；模块顶层 **`await import("@juicesharp/rpiv-i18n/loader")`**，成功则 `registerLocalesFromDir(I18N_NAMESPACE, import.meta.url)` 把包内 `locales/*.json` 挂到 SDK；失败则静默英文。**ESM 顶层 await** 保证任何下游在同步调用 `t()` 前 `scopeImpl` 已就绪。
- **`config.ts`**：唯一依赖 **`@juicesharp/rpiv-config`** 的 `configPath("rpiv-ask-user-question")` + `loadJsonConfig`，读出可选 `guidance`（`promptSnippet` / `promptGuidelines`），在 `ask-user-question.ts` 里经 `validateGuidanceFields` 合并进 `registerTool`。
- **`state/i18n-bridge.ts`**：另一条动态 **`await import("@juicesharp/rpiv-i18n")`** 得到 `scope(namespace)`；失败则 `t(key,fallback)=fallback`。`displayLabel(sentinelKind)` 用 `t(\`sentinel.${kind}\`, ROW_INTENT_META[kind].label)`。**校验保留字标签**用的是英文 canonical `ROW_INTENT_META`，不用 `displayLabel`，避免 locale 绕过保留字检测。
- **hawtian-pi-extensions**：无 **`i18n-bridge.ts`**；sentinel 与 UI 字面量直接使用 **`ROW_INTENT_META`** 或各文件内英文常量。

### 2.2 工具 `execute` 主路径（`ask-user-question.ts`）

1. `!ctx.hasUI` → `buildToolResult` + `details.error: "no_ui"`。
2. `validateQuestionnaire`（纯函数，不含 schema 解析）→ 失败则 `cancelled: true` + 具体 `error` 枚举。
3. **`pi.events.emit(ASK_USER_PROMPT_EVENT, payload)`**：payload 只含题面摘要（`hasPreview` 布尔，不含 preview 正文），见 `events.ts` 稳定性注释。
4. **`itemsByTab`**：`typed.questions.map((q) => buildItemsForQuestion(q))`；`buildItemsForQuestion` 先把作者 `options` 映射为 `WrappingSelectItem` 的 `kind:"option"`，再按 `sentinelsToAppend(question, hasAnyPreview)` 追加 **`other` / `next`**（`chat` 因 `livesInMainList:false` 不会进主列表）。
5. （上游 rpiv）**`await ctx.ui.custom<QuestionnaireResult>(factory, { overlay: true, overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: … } })`**：factory 内 `new QuestionnaireSession({ tui, theme, params, itemsByTab, done })`，返回 **`session.component`**（实现 `render` / `invalidate` / `handleInput`）。**本仓库**改为 **`await ctx.ui.custom<QuestionnaireResult>(factory)`**（仅编辑器槽），会话组件与 `done` 语义不变。
6. **`buildQuestionnaireResponse(result, typed)`**：把 `QuestionnaireResult` 转成 LLM 可见 `content[0].text`（`ENVELOPE_PREFIX` + 各题 `buildAnswerSegment` + `ENVELOPE_SUFFIX`）；取消或空段统一 **`DECLINE_MESSAGE`** 文案策略在 `response-envelope.ts` 注释中写明。

### 2.3 行协议与类型（`state/row-intent.ts` + `tool/types.ts` + `view/components/wrapping-select.ts`）

- **`WrappingSelectItem`** 四态：`option` | `other` | `chat` | `next`\*\*，与 reducer 动作、列表渲染、多选行为强绑定。
- **`ROW_INTENT_META`** 是**单一真相表**：描述每类的 `reserved`、`livesInMainList`、`numbered`、`activatesInputMode`、`blocksMultiToggle`、`autoSubmitsInMulti`、以及何种问卷模式下自动追加 sentinel（`autoAppendOnSingleSelectNoPreview` / `autoAppendOnMultiSelect`）。**新增 sentinel 必须同时改 union + META**，编译器用 `Record<RowKind, …>` 强制成对修改。
- **`RESERVED_LABELS` / `RESERVED_LABEL_SET`**：`types.ts` 显式包含 `"Other"`（与 CC 习惯对齐但运行时拒绝）+ 三 sentinel 的 canonical 英文 label；`validateQuestionnaire` **必须先判 reserved 再判 duplicate**（文件注释写明顺序）。

### 2.4 键盘路由（`state/key-router.ts`）

- 产出 **`QuestionnaireAction`** 判别联合（`nav`、`tab_switch`、`confirm`、`toggle`、`multi_confirm`、`cancel`、`notes_enter`/`exit`、`submit`、`submit_nav`、`focus_chat`、`focus_options`、`notes_forward`、`ignore`）。**hawtian-pi-extensions**：无上游的 **`toggle_collapsed`**。
- **（仅上游 rpiv）** **最外层拦截**：`Ctrl+]` → `toggle_collapsed`；**hawtian-pi-extensions 已删除**。
- **（仅上游 rpiv）`collapsed`**：`routeKey` 在折叠态几乎吞掉所有键，仅 **`KEYBIND_CANCEL` → `cancel`**；`QuestionnaireSession` 折叠时只渲染单行 hint。**hawtian-pi-extensions 已删除折叠态与 `Ctrl+]`**。
- **焦点优先级**与 **`selectActiveView`（`state/selectors/focus.ts`）** 一致：`notes` > `submit` tab > `chat` > `options`\*\*。
- **单选列表**：`UP/DOWN` 在顶/底与 **`focus_chat` 闭环**（注释描述 `[chat, option0, …, optionLast]` 循环）；`Enter` 在 `chatFocused` / 普通列表都会走 `buildSingleSelectAnswer` → `confirm`（可带 `autoAdvanceTab`）。
- **多选**：`Space` / `Enter` 在选项行上 **toggle**；在 **`ROW_INTENT_META.autoSubmitsInMulti`** 的行（即 `next`）上 `Enter` → `multi_confirm` 并带 `autoAdvanceTab`；`Space` 在 `blocksMultiToggle` 行被吞掉。
- **`notes`**：`n` 键入口在「单选 + `focusedOptionHasPreview`」分支；`notesVisible` 时大部分键 `notes_forward` 进 notes `Input`。

### 2.5 纯 reducer + 副作用（`state/state-reducer.ts` + `state/questionnaire-session.ts`）

- **`reduce(state, action, ctx)`**：表驱动 **`HANDLERS`**，保证 **`QuestionnaireAction` 穷尽**；返回 `{ state, effects }`，**无副作用**。
- **`Effect` 闭集**：`set_input_buffer` / `clear_input_buffer` / `set_notes_value` / `set_notes_focused` / `forward_notes_keystroke` / **`done`**。`QuestionnaireSession.runEffect` 里 **`done` 调 `this.done(result)`** 结束 `ctx.ui.custom` 会话并恢复主编辑器。
- **笔记与答案分离**：`notesByTab` 在 reducer 里维护；在 `confirm` / `multi_confirm` 时把 pending notes 合并进 `QuestionAnswer.notes`（避免「只加笔记就算答完」）。
- **`handleIgnoreInline`**：`action.kind === "ignore"` 且 **`inputMode`** 时，把按键交给 headless **`inlineInput.handleInput`**（支持 bracketed paste、CSI-u 等），然后 **`viewAdapter.apply` 不走 reducer**——注释称为低延迟路径。

### 2.6 视图组装（`state/build-questionnaire.ts`）

- **`QuestionnaireBuilder`**（一次性 builder 类）：`buildTabFor` 每题构造 **`OptionListView` + `PreviewBlockRenderer` + `PreviewPane`**；若 `question.multiSelect` 则多一个 **`MultiSelectView`**（勾选与 Next/Submit 行的纯展示，见 **§2.9**）；`bodyHeights` 在单选走 preview 自然高度、多选走 `MultiSelectView.naturalHeight`。
- **`injectGlobalLeftWidth`**：调用 **`crossTabLeftWidthWithDonation`**，让所有 tab 的 `PreviewPane` 共享同一套「左侧选项列宽度」逻辑，保证多 tab 切换时侧栏对齐。
- **多题 UI**：**`isMulti = questions.length > 1`**（不是 `multiSelect`）；为 true 时才有 **`TabBar` + `SubmitPicker` + Submit 策略**。
- **`buildDialog`**：`DialogView` + `QuestionTabStrategy` / `SubmitTabStrategy`；`globalBinding` 绑定 dialog、chatRow、submitPicker、tabBar；`perTabBinding` 绑定 optionList、preview、multiSelect。
- **`QuestionnairePropsAdapter`**：每 tick 计算 **`BindingContext`**（含从 **`inlineInput.getValue()`** 读入的 `inputBuffer`、以及通过 **非公开 `cursor` 字段** 反射读取的 `inputCursorOffset`），再对 global / per-tab bindings `setProps`；**`invalidate`** 遍历所有 binding 与 `extraInvalidatables`（含 `notesInput`）。

### 2.7 布局与溢出（`view/dialog-builder.ts` + `view/tab-content-strategy.ts`）

- **`DialogView.render`**：先按策略生成「自然高度」行数组；若 **`natural + spacer ≤ terminalRows`** 则底部补 **residual spacer** 使各 tab 总高度一致；否则做 **三区（顶固定 / 中间滚动 / 底固定）**，中间按 **`focusedItemRowRange`** 垂直居中滚动，边界用 `↑` `↓` `↕` 提示。
- **`QuestionTabStrategy.footerRowCount = 4` 不变量**：底部 hint 必须用 **`OneLineClippedText` + `truncateToWidth`**，避免 `Text` 自动换行破坏 footer 行数假设（代码注释明确写出这是 regression 根因类约束）。
- **`SubmitTabStrategy`**：展示每题 `formatAnswerScalar(..., "summary")`；Submit/Cancel 行为：**不再用「全答完才能提交」门闩**（`key-router` 注释 D1：警告条仅信息性，部分答案仍提交）。

### 2.8 Markdown 预览链路（`view/components/preview/*`）

- **数据与主题**：`QuestionnaireBuilder` 每题构造 **`PreviewBlockRenderer`**（入参 `question`、`theme`、`getMarkdownTheme()` 的 **`MarkdownTheme`**）。`MarkdownContentCache` 在构造时扫描 `question.options[i].preview`，非空则记入 `previewTexts: Map<optionIndex, string>`；**每个有 preview 的选项懒建一个 `pi-tui` 的 `Markdown` 实例**，放入 `markdownCache`，**构造次数语义被测试冻结**（注释写明）。
- **宽度与失效**：`bodyFor(optionIndex, innerWidth)` 以 **`innerWidth` 为键**；宽度变化时对已存在的每个 `Markdown` 调 **`invalidate()`**，再 `render(innerWidth)`。`pi-tui` 的 Markdown 在换列宽时会重排，因此必须整表失效而非单格更新。
- **渲染后处理**：`stripFenceMarkers` 过滤 fenced code 的三反引号围栏起止行（保留高亮代码体；行内 code 不受影响）。`preview-box-renderer` 的 **`renderBorderedBox`** 画四边 ASCII 框；内容被截断时底边用 **`✂ ── N lines hidden ──`** 指示被裁掉的行数。
- **高度上限与 affordance**：侧栏 **`MAX_PREVIEW_HEIGHT_SIDE_BY_SIDE = 20`**，堆叠 **`MAX_PREVIEW_HEIGHT_STACKED = 15`**。`blockHeight` 与 `renderBlock` 行数一致：`BORDER_VERTICAL_OVERHEAD + min(原文行数, contentBudget) + NOTES_AFFORDANCE_OVERHEAD`（**affordance 行恒占 1 行槽位**，无文案时发空串，避免 focus/notes 切换时块高度抖动）。**「Notes: press n…」** 仅在 **`focused && !notesVisible &&` 当前选项有 preview** 时上色显示，文案走 `t("preview.notes_affordance", …)`。
- **无 preview 的选项**：`bodyFor` 返回一行 **`theme.fg("dim", t("preview.no_preview", …))`** 占位（仍参与框内排版）。**整题无任何 option 带 `preview`** 时 `hasAnyPreview()` 为 false —— 见下一项。
- **`PreviewPane`（组合器）**：**`question.multiSelect === true` 或 `!previewBlock.hasAnyPreview()`** 时，`render` / `naturalHeight` / `focusedItemRowRange` **完全退化为只调 `OptionListView`**（多选题**不展示** Markdown 侧栏/堆叠预览，与 `buildTabFor` 仍挂 `PreviewBlockRenderer` 但不绘制一致）。否则用 **`decideLayout(terminalColumns, paneWidth)`**：**终端宽与 pane 宽均 ≥ `PREVIEW_MIN_WIDTH`（100）** 为 **`side-by-side`**，否则 **`stacked`**（中间隔 **`STACKED_GAP_ROWS`（1）** 行空行）。`mode` **只算一次**并传入 `previewBlock`（注释强调避免「用已 split 的列宽再推导 sideBySide」导致高度 cap 过短的 bug class）。
- **并排（side-by-side）列宽**：`injectGlobalLeftWidth` 在每扇 `PreviewPane` 上注入 **`globalLeftWidth(paneWidth)`**（未注入则 `render` 抛错，避免静默常量）。实现为 **`crossTabLeftWidthWithDonation`**：`labelDriven = crossTabMaxLeftWidth`（各 tab 的 `adaptiveLeftWidth` 取 max，含编号前缀、`✔` 预留宽）；`previewBudget = crossTabPreviewBudget`（按各题 **源码行 `visibleWidth` 启发式**估 preview 欲宽 + 框与 padding）；**`slackDonation`** 把窄 preview 省下的宽度还给左列（有 **`labelDriven <= MIN_LEFT` 时不捐赠** 的紧凑守卫）。`columnWidths` / `bodyWidths` 产出左列表宽、右栏宽（右栏再扣 **`PREVIEW_PADDING_LEFT`** 给预览内容垫列）。
- **与本仓库 port**：预览全链路依赖 **`Markdown` + `getMarkdownTheme`**；侧栏 donated 宽度与 **ANSI 可见宽**（`visibleWidth`、`truncateToWidth`）强绑定，port 时应用同版本 `pi-tui` 回归窄终端与 code fence 长行。

### 2.9 多选列表视图（`multi-select-view.ts` 与组装关系）

- **与单选路径分工**：多选题在 `buildTabFor` 中 **`MultiSelectView` 与 `OptionListView` + `PreviewPane` 并存**；**题体高度** `bodyHeights` 走 **`multiSelectBodyHeights`**（`current`/`max` 都等于 `MultiSelectView.naturalHeight(width)`），不再用 `PreviewPane` 的 preview 自然高度。键盘与答案仍由 **`WrappingSelect` 所在列表**（`OptionListView` + `key-router`）驱动；**`MultiSelectView` 只做「勾选状态 + Next/Submit 行」的只读渲染**，不处理 `handleInput`（空实现），`invalidate` 亦为空（无内部 cache）。
- **行模型**：每选项一行 **`pointer + 序号 + "[✔]/[ ]" + label`**（label 可 `truncateToWidth`；**`description` 用 `wrapTextWithAnsi` 续行**，续行缩进 **`CONTINUATION_INDENT`（两空格）**，与 CC 对齐注释写明）。最后一行是 **sentinel「Next」行**：`nextPointer + nextLabel`；**无 description**、不参与与选项相同的 prefix 宽度推导（注释认为 Next 宽度不超过 canonical prefix 的安全假设）。
- **样式语义**：**选中 checkbox 与当前 active 行 label** 都用 **`theme.fg("accent", …)`**（与「成功绿」区分，和对话框其余 accent 节奏一致）。
- **Props 投影（`selectMultiSelectProps`）**：**每个 tab 每 tick 都会执行**（`perTabBinding` **无 `predicate`**；`resolve` 为 `tab.multiSelect`，单选题 tab 为 `undefined` 则跳过 `setProps`）。`rows[i]`：`checked` 来自 **`state.multiSelectChecked.has(i)`**；`active` 来自 **`ctx.activeView === "options"` 且 `i === state.optionIndex`**。**`nextActive`**：`focused && state.optionIndex === question.options.length`（即焦点在 **Next 行**，与列表索引「选项数 + 1 槽位」对齐）。**`nextLabel`**：最后一题 **`MULTI_SUBMIT_LABEL`（`"Submit"`）**，否则 **`displayLabel("next")`**（i18n sentinel）。
- **高度契约**：**`naturalHeight(width)` 显式声明与 props 无关**，只依赖 `question.options`、theme 字形宽与 `width`，且 **`naturalHeight(w) === render(w).length`**（便于 `DialogView` 算全局稳定高度）。**`focusedItemRowRange`** 按当前 `rows` 的 active 行在 `render` 输出中的 **[start, end)** 计算，含 description 折行占行。
- **与 reducer / `ROW_INTENT_META` 的衔接**：多选下列表仍含 **`next` sentinel**（`Enter` 在 `autoSubmitsInMulti` 行触发 `multi_confirm` 等，见 §2.4）；`MultiSelectView` 的 Submit 文案是 **最后一题 Next 行的 UI 标签**，与单题内「确认多选并可能 auto-advance」同一套状态机。

### 2.10 与本仓库 port 直接相关的「硬耦合点」

| 耦合点                                          | 说明                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **`ctx.ui.custom`（编辑器槽）**                 | 行为与 Pi 版本绑定；Phase 0 用同版本 `pi-coding-agent` 实测 `custom` + `done`。                                                 |
| **`getMarkdownTheme`（`build-questionnaire`）** | 预览 Markdown 依赖 Pi 暴露的主题 API。                                                                                          |
| **`Input` 私有 `cursor` 反射**                  | `props-adapter.ts` 已标注希望将来换公共 API；port 后 Pi 升级需回归。                                                            |
| **`@juicesharp/rpiv-config` / `rpiv-i18n`**     | 可替换/可选，但 **`index.ts` / `i18n-bridge.ts` 的顶层 await 与动态 import 模式**要在本仓库 tsconfig / Pi loader 下验证仍合法。 |

## 3. 上游包结构与职责划分（总表）

依据 `package.json` 的 `files` 与入口逻辑，可抽象为四层：

| 层级             | 路径（概念）                                                                             | 职责                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **入口**         | `index.ts`                                                                               | `export default (pi) => registerAskUserQuestionTool(pi)`；可选 `try { await import("@juicesharp/rpiv-i18n/loader") }` 注册 `locales/*.json`。                                                    |
| **工具注册**     | `ask-user-question.ts`                                                                   | `pi.registerTool`：name / label / description / `promptSnippet` / `promptGuidelines` / TypeBox `QuestionParamsSchema`；`execute` 内校验 → `ctx.ui.custom` → 把结果封装为 `content` + `details`。 |
| **领域与校验**   | `tool/types.ts`, `validate-questionnaire.ts`, `response-envelope.ts`, `format-answer.ts` | 问卷参数 schema、业务校验、返回结构、与用户选择对齐的 envelope。                                                                                                                                 |
| **状态与视图**   | `state/*`, `view/*`                                                                      | 问卷会话（reducer/selector）、键盘路由、Tab/多选/预览/提交选择器等 **纯 TUI 实现**；体量最大，与 Pi 核心无强耦合，只依赖 `ExtensionContext.ui` + `pi-tui` + `Theme`。                            |
| **配置与国际化** | `config.ts`, `state/i18n-bridge.ts`, `locales/`                                          | 通过 `@juicesharp/rpiv-config` 拉 guidance；UI 文案走可选 `@juicesharp/rpiv-i18n`。                                                                                                              |
| **可观测**       | `events.ts`                                                                              | `pi.events.emit(ASK_USER_PROMPT_EVENT, payload)` 供其它插件订阅。                                                                                                                                |

**依赖关系（port 时需对齐）：**

- **peer**：`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox`（与本仓库一致）。
- **optional peer**：`@juicesharp/rpiv-i18n`（无则全英文 UI）。
- **dependency**：`@juicesharp/rpiv-config`（port 时可替换为本地 JSON/YAML 或本 monorepo 小模块，避免引入整条 rpiv 配置链）。

## 4. 与本仓库扩展结构的对比

本仓库（见根目录 `AGENTS.md`）约定：

- 每个能力一个 **`packages/<name>/`**，入口 **`index.ts`** 默认导出 `(pi: ExtensionAPI) => void`。
- **无构建步骤**，Pi 直接加载 `.ts`；ESM + `tsconfig` project references；工具名 **`snake_case`**。
- 已有模式举例：
  - **纯工具 + 无 UI**：`extra-tools`、`protect-secrets`。
  - **事件 + 会话**：`subagents`（`createAgentSession`、`before_agent_start` 等）。
  - **轻量 UI 条件**：`statusline`、`user-message` 使用 `ctx.hasUI` 守卫。
  - **深度改 TUI**：`tool-display` 通过 patch `ToolExecutionComponent.prototype.render` 定制工具行渲染。

**对照结论：**`ask_user_question` 属于 **「注册工具 + 重度 `ctx.ui.custom`（编辑器槽）」**；与本仓库多数包相比，**代码量与 TUI 状态机更接近一个独立子项目**，适合单独 `packages/ask-user-question/`（或 `packages/user-question/`），而不是塞进现有 `user-message`（除非刻意做大而全的「用户交互」聚合包）。

## 5. Port 目标与原则

| 目标         | 说明                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **功能**     | 至少支持 README 中的 schema 子集：多题、单选/多选、选项 label/description、可选 preview、提交前确认、无 UI 时明确错误。                                                                       |
| **API 对齐** | 以本机锁定的 `@earendil-works/pi-coding-agent` 为准，验证 **`ctx.ui.custom` 工厂签名、`done`、编辑器恢复**；若有不兼容，在实现阶段做薄适配层而非 fork 全量 view。                             |
| **依赖**     | 优先去掉 `@juicesharp/rpiv-config` / `@juicesharp/rpiv-i18n`；`promptSnippet` / `promptGuidelines` 写在 **`tool.ts`**（包根，与 `tool/` 目录区分）常量中；i18n 第二阶段再引入或对接自有方案。 |
| **仓库规范** | 新包 `package.json` 加入 workspace；根 `tsconfig.json` references；`AGENTS.md` 列表更新；工具 `promptSnippet` / `promptGuidelines` 与上游语义对齐。                                           |
| **合规**     | 上游 MIT；port 时保留版权与来源说明（README / 文件头按团队规范）。                                                                                                                            |

## 6. 分阶段设计方案

### Phase 0 — API 与行为探测（1–2 天）

- 在当前 Pi 版本上写最小 extension：`ctx.ui.custom` 返回 `Text`/`Box`，**键盘与 `done` 生命周期**与工具假设一致。
- **挂载位置**：只使用 **`ctx.ui.custom(factory)`**（**编辑器槽**），与 [ghoseb/pi-askuserquestion](https://github.com/ghoseb/pi-askuserquestion/blob/main/README.md) 一致；见 [PHASE0.md](./PHASE0.md)。
- 对照 `ExtensionContext` 类型定义，列出与 rpiv `ask-user-question.ts` 的差异清单（若有）。

### Phase 1 — MVP 包落地（核心路径）

- 新增 **`packages/ask-user-question/`**（名称可与工具名对应，便于发现）。
- **直接迁移**（复制后改 import 路径）：`tool/types.ts`、`validate-questionnaire.ts`、`response-envelope.ts`、`format-answer.ts` 及与 schema 强相关的逻辑。
- **入口**：`index.ts` 只负责 `registerTool`；**暂不接** `rpiv-i18n` 动态 import，UI 字符串硬编码英文或抽 `strings.ts`。
- **`config`**：用本仓库包根 **`tool.ts`** 中的 `DEFAULT_PROMPT_*` 替代 `rpiv-config` 拉取的 guidance。
- **验收**：非交互 `hasUI === false` 返回 `no_ui`；交互下一题单选 + 提交成功，`details` 形状与上游 README 一致或文档化差异。

### Phase 2 — UI 与状态机完整 parity

- 迁移 **`state/`**、**`view/`** 全量或按 Tab 逐步合并；统一 import 后缀为 `.ts`（本仓库惯例）。
- 恢复 **`events.ts`** 及 `pi.events.emit`，便于 statusline / 日志类扩展订阅（与本仓库 `subagents` 的 `pi.events` 用法一致）。
- **`tool-display`**：若希望工具行展示与 `read`/`grep` 同级体验，可为 `ask_user_question` 增加专用 adapter（折叠显示题数/是否已答等）；属增强项，非 port 阻塞。

### Phase 3 — 可选能力

- **i18n**：复制 `locales/` 并二选一：(a) 最小自研 `t(key)`；(b) 继续 optional 依赖 `rpiv-i18n`（若愿意拉一条外部链）。
- **配置热更**：与 `user-message` / `settings` 模式对齐（若需要）。

## 7. Monorepo 集成步骤（检查清单）

1. `packages/ask-user-question/package.json`：`name: "@htwang-contrib/ask-user-question"`，`pi.extensions` 指向 `./index.ts`，`peerDependencies` 对齐其它包。
2. `packages/ask-user-question/tsconfig.json`：`composite`、`references` 到 `common`（若需）及与 `pi-coding-agent` 类型兼容。
3. 根 `package.json` `workspaces` / `tsconfig.json` references 纳入新包。
4. 用户侧：`pi.extensions`（或项目 `package.json` 的 pi 扩展列表）增加 **`@htwang-contrib/ask-user-question`**。
5. `npx tsc --build`、`npm run format`、手动在 TUI 下跑一轮问卷回归。

## 8. 风险与注意事项

| 风险                                                | 缓解                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| **`ctx.ui.custom` 行为差异**（不同 Pi 版本 / fork） | Phase 0 用最小 **编辑器槽** `custom` 探测；差异集中在适配层。                   |
| **TUI 体量与维护成本**                              | 保持 `state` / `view` 边界清晰；单测优先覆盖 reducer 与校验。                   |
| **与 `user-message` 职责重叠**                      | 本包专注「模型发起的结构化选择题」；自由文本用户输入仍属会话主流程，不必合并。  |
| **子 agent / 无 UI 会话**                           | 子会话若 `hasUI` 为 false，行为应与上游一致：工具返回错误信息，不阻塞整条链路。 |

## 9. 小结

上游 **`rpiv-ask-user-question`** 是一个 **以 `registerTool` + `ctx.ui.custom`（历史上为全屏浮层）为核心的重型 TUI 扩展**；逻辑上可拆为 **类型/校验/响应封装（薄）** + **问卷状态机与视图（厚）**。Port 到 **hawtian-pi-extensions** 时固定为 **编辑器槽 `custom`**，推荐 **新建独立 package**，先替换 **配置与 i18n 依赖**，再分阶段迁移 **工具层 → 全量 UI**，并在 Phase 0 **锁定 Pi 的 UI API** 与本仓库约定一致。
