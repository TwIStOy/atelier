# `ask_user_question` Port 执行步骤（Step-by-step）

本文是 [PORT-DESIGN.md](./PORT-DESIGN.md) 的**可执行顺序清单**：按步骤做，有依赖处已标明。与 PORT-DESIGN 中的 Phase 0–3、§7 集成清单、§2 硬耦合与预览/多选细节一致。

**实现原则（必守）**：迁移时不要大段拷贝上游仓库；优先复用本 monorepo（含 `@htwang-contrib/common`）；新出现的跨包可复用逻辑放入 `packages/common`。详见仓库根目录 [AGENTS.md](../../AGENTS.md) 末尾 **「Porting upstream code」** 一节。

## 如何使用本页的 todo

- 未完成：`- [ ]`
- 已完成：把方括号内改成 `x`，即 `- [x]`（在编辑器里点任务列表或使用查找替换均可）。
- **建议**：完成一大段后把本节上方**进度摘要**里的计数顺手改一下（可选，便于扫一眼）。

### 进度摘要（可选，自行维护）

| 区块     | 已完成 / 总数 |
| -------- | ------------- |
| Phase 0  | 3 / 3         |
| 脚手架   | 7 / 7         |
| Phase 1  | 5 / 5         |
| Phase 2  | 11 / 13       |
| Phase 3  | 0 / 2         |
| 收尾     | 1 / 2         |
| **合计** | **27 / 32**   |

---

## Phase 0 — 锁 API、做最小验证（阻塞后续一切）

- [x] **P0-1** 锁定本机 Pi / `@earendil-works/pi-coding-agent` 版本；打开 `ExtensionContext` 中与 **`ctx.ui.custom`**、`ctx.hasUI` 相关的类型定义。
- [x] **P0-2** 写最小临时 extension（或脚本化入口）：`hasUI === true` 时 **`ctx.ui.custom(factory)`**（不传第二参数，**编辑器槽**，对齐 [ghoseb/pi-askuserquestion](https://github.com/ghoseb/pi-askuserquestion)）只返回简单 `Text`/`Box`，调 `done(...)`；验证 **焦点、键盘、`done` 与编辑器恢复**。
- [x] **P0-3** 输出差异清单：签名、泛型返回值、`done` 与 rpiv 挂载差异等记入「适配层」todo（薄封装优先，不 fork 全量 view）。

---

## 脚手架 — 新包进 monorepo（可与 Phase 0 后半并行）

- [x] **S-1** 新建目录 **`packages/ask-user-question/`**（独立包，不并入 `user-message`）。
- [x] **S-2** **`package.json`**：`name`（如 `@htwang-contrib/ask-user-question`）、`pi.extensions` → `./index.ts`，**peerDependencies** 与仓库其它包对齐（`pi-coding-agent`、`pi-tui`、`typebox`）。
- [x] **S-3** **`tsconfig.json`**：`composite`、references（按需连 `common`），**import 使用 `.ts` 后缀**。
- [x] **S-4** 根 **`package.json`** `workspaces` 纳入新包。
- [x] **S-5** 根 **`tsconfig.json`** `references` 纳入新包。
- [x] **S-6** 根 **`AGENTS.md`** 扩展包列表更新。
- [x] **S-7** 验证 **ESM**：若入口有 **顶层 `await` / 动态 `import`**，在本仓库 Pi 加载路径下空跑一轮，确认不报错。

---

## Phase 1 — MVP：工具层 + 最薄可跑通路径

- [x] **P1-1** 迁移薄层（改 import 路径）：`tool/types.ts`、`validate-questionnaire.ts`、`response-envelope.ts`、`format-answer.ts` 及 schema 强相关逻辑。
- [x] **P1-2** 替换 **`rpiv-config`**：**`tool.ts`** 顶层 **`DEFAULT_PROMPT_*` 常量**；`promptSnippet` / `promptGuidelines` 合并进 `registerTool`，语义与上游一致（改文案时直接改代码）。
- [x] **P1-3** **`index.ts`**：默认导出注册函数；**不接 `rpiv-i18n`**；UI 字符串英文硬编码或 `strings.ts`。
- [x] **P1-4** **`execute` 骨架**：`!ctx.hasUI` → `details.error: "no_ui"`；`validateQuestionnaire` 失败路径与上游枚举对齐；若 Phase 1 不接 `pi.events.emit`，在 README 写明与上游差异。
- [x] **P1-5** **MVP 验收**：至少一题单选（可无 preview 或极简 preview）；**`ctx.ui.custom` → `done` → `buildQuestionnaireResponse`** 跑通；`content`/`details` 与上游 README 一致或差异已文档化。

---

## Phase 2 — UI / 状态机 parity（大块，建议按模块合入）

**本仓库合入说明**：已从上游 **`rpiv-ask-user-question`** 迁入 **`state/`**、**`view/`**（含 Markdown 预览链）、**`build-questionnaire`**、**`QuestionnaireSession`**；import 改为 **`.ts` 后缀**；**无 `rpiv-i18n`**，文案为内联英文 + **`ROW_INTENT_META`**；**已移除折叠（`Ctrl+]`）与 `i18n-bridge` 模块**。**`execute`** 仍只用 **`ctx.ui.custom(factory)`**（**无 overlay**）。事件名为 **`ask_user_question:prompt`**，payload 含每题 **`options[].hasPreview`**、**不含 preview 正文**。

**P2-12** 仍需在本机 Pi TUI 下做人工回归（窄/宽终端、长行、多 Tab、编辑器槽布局）。

- [x] **P2-1** 迁移 **`state/`**：`reduce` + `Effect`、`QuestionnaireSession`、`key-router`、`selectors`；`QuestionnaireAction` 穷尽、Effect 闭集与上游一致。
- [x] **P2-2** 迁移 **`view/`** 与 **`build-questionnaire.ts`**：`QuestionnaireBuilder`、`QuestionnairePropsAdapter`、bindings、`DialogView` / tab 策略。
- [x] **P2-3** 确认 **`injectGlobalLeftWidth` 在首帧 `PreviewPane.render` 之前**已注入（否则会按设计抛错）。
- [x] **P2-4** 预览回归：**`getMarkdownTheme()`** 可用；列宽变化时 Markdown 缓存**整表失效**（PORT-DESIGN §2.8）。
- [x] **P2-5** 预览回归：**`decideLayout`** 的 `mode` **只算一次**并贯穿高度与渲染；终端与 pane **双 ≥100** 并排，否则堆叠。
- [x] **P2-6** 预览回归：**多选题**下 `PreviewPane` 退化为仅选项列；**`bodyHeights`** 使用 **`MultiSelectView.naturalHeight`**。
- [x] **P2-7** 多选回归：**`selectMultiSelectProps`** 无 predicate、每 tab 每 tick；最后一题 Next 行为 **Submit** 文案；**`naturalHeight(w) === render(w).length`**；与 **`multi_confirm` / `next` sentinel** 一致（§2.9）。
- [x] **P2-8** 手测高风险：**Input `cursor` 反射**、notes / **`inlineInput`** 低延迟路径、Submit 页**部分作答仍可提交**（**`Ctrl+]` 折叠已按本仓库需求移除**）。
- [x] **P2-9** 恢复 **`events.ts`**：**`ask_user_question:prompt`** payload **不含 preview 正文**，与上游稳定性策略一致（频道名按本仓库工具命名）。
- [x] **P2-10** **`npx tsc --build`** 通过。
- [x] **P2-11** **`npm run format`**（或项目约定格式化命令）已跑。
- [ ] **P2-12** 人工问卷回归：**窄终端 / 宽终端 / code fence 长行 / 多 Tab**。
- [ ] **P2-13（可选）** **`tool-display`**：为 `ask_user_question` 增加专用 adapter（非阻塞）。

---

## Phase 3 — 可选增强

- [ ] **P3-1** **i18n**：`locales/` + 最小 `t(key)`，或 optional **`rpiv-i18n`**；校验路径仍用英文 canonical 标签（§2.1 / §2.3）。
- [ ] **P3-2** **配置热更**（若需要）：对齐本仓库其它扩展的 settings 模式。

---

## 收尾与合规

- [x] **Z-1** **MIT / 来源**：README 已注明 UI/state/view 源自 **`juicesharp/rpiv-mono`**（MIT）。
- [ ] **Z-2** **发布前复查**：Pi 升级后重跑 **P0-2** 级别探测；复查 **`ctx.ui.custom`、`getMarkdownTheme`、`Input`（含 cursor）** API。

---

## 执行顺序上的硬规则（从 PORT-DESIGN 抽象）

- **未通过 Phase 0 不要大规模迁 `view/`**（避免在错误 API 假设上堆代码）。
- **`injectGlobalLeftWidth` 早于任何 `PreviewPane.render`**。
- **多选与预览**：先保证「多选无侧栏预览 + 高度来自 `MultiSelectView`」再抠并排预览的 donated 列宽。
- **子 agent / 无 UI**：全程保持 **`hasUI === false` → `no_ui`**，与上游一致。

---

## 另见

- Phase 0 结论与适配表：[PHASE0.md](./PHASE0.md)
- 架构、阶段划分原文：[PORT-DESIGN.md](./PORT-DESIGN.md)
- 上游 README：<https://github.com/juicesharp/rpiv-mono/blob/main/packages/rpiv-ask-user-question/README.md>
