# Todo 扩展 — 实施清单

可执行 checklist，按 Phase 顺序勾选。每步标注对应模块（[MODULES.md](./MODULES.md)）、设计章节（[DESIGN.md](./DESIGN.md)）与上游改动（[SOURCE-ANALYSIS.md](./SOURCE-ANALYSIS.md)），不重复设计细节。

---

## 总进度 TODO

每完成一个 Phase 把 `[ ]` 改 `[x]`。「阻塞 / 备注」写一行备忘。

| Phase | 目标                                                                                    | → MODULES.md                                   | → DESIGN.md | 状态 |
| ----- | --------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------- | ---- |
| 0     | 前置确认：common 符号、tsconfig reference、设计决策                                     | —                                              | §3          | [x]  |
| 1     | 脚手架 + 配置层：目录、package.json、tsconfig、`config.ts`                              | config                                         | §2/§7/§8    | [x]  |
| 2     | 核心数据层：types → state → invariants → graph → reducer → store → selectors → envelope | tool/types · state/\* · tool/response-envelope | §4          | [x]  |
| 3     | Replay + 注册层：`replay.ts` · `todo.ts`                                                | replay · todo                                  | §4          | [x]  |
| 4     | UI 层：`view/format.ts` · `todo-overlay.ts` · `index.ts`                                | view/format · todo-overlay · index             | §4          | [x]  |
| 5     | 测试：helpers + 9 个测试文件                                                            | 测试矩阵                                       | §5          | [x]  |
| 6     | 集成收尾：tsc / format / 手测 / AGENTS.md / README                                      | —                                              | —           | [x]  |
| 7     | tool-display 适配：渲染层从 todo 包迁移到 `packages/tool-display/adapters/todo.ts`      | [tool-display adapter](./MODULES.md#tool-display-adapter--new) | —  | [x]  |

**当前停在哪一 Phase：** Phase 7 完成（2026-06-13）。Phase 6 仅剩 S6.3 手测。

> **Phase 7 说明（渲染层迁移）：** 首版完成后为对齐 monorepo 风格（goal / memory / read / bash 等都走 tool-display adapter），把 `todo.ts` 的 `renderCall`/`renderResult` 与 `view/format.ts` 的 `renderTodoCall`/`renderTodoResult`/`STATUS_GLYPH`/`STATUS_COLOR`/`ACTION_GLYPH` 全部删除，新建 `packages/tool-display/adapters/todo.ts` 接管渲染。详见 [MODULES.md § tool-display adapter](./MODULES.md#tool-display-adapter--new) 与 [SOURCE-ANALYSIS.md §6](./SOURCE-ANALYSIS.md#6-tooldisplayadapterstodots--tool-callresult-rendering-adapter-new)。

---

## Phase 0 — 前置确认

- [x] **P0.1** 读 [DESIGN.md](./DESIGN.md) §3 关键差异表（i18n 删 / config 替换 / typebox 替换 / stale guard 复用 / re-export 删）。
- [x] **P0.2** 读 [MODULES.md](./MODULES.md) 全文，确认每个模块的**移植动作**（PORT/ADAPT/REWRITE）与目标签名。
- [x] **P0.3** 读 [SOURCE-ANALYSIS.md](./SOURCE-ANALYSIS.md) §4 summary 表 + §5 stale guard。
- [x] **P0.4** 确认 `packages/common` 导出 `readConfig` 与 `isStaleCtxError`：
  ```bash
  node -e "import('@htwang-contrib/common').then(m=>console.log(typeof m.readConfig, typeof m.isStaleCtxError))"
  ```
- [x] **P0.5** 确认根 `tsconfig.json` 的 `references` 尚未含 todo（Phase 1 加）。

---

## Phase 1 — 脚手架 & 配置层（无 UI 依赖）

> 模块：[`config.ts`](./MODULES.md#configts--rewrite) · DESIGN §2 包结构 / §7 package.json / §8 tsconfig.json

- [x] **S1.1** 建目录 `packages/todo/{tool,state,view,test}/`。
- [x] **S1.2** 写 `packages/todo/package.json`：
  - `name: "@htwang-contrib/todo"`、`version: "0.1.0"`、`type: "module"`、`main/types: "index.ts"`。
  - `dependencies: { "@htwang-contrib/common": "*" }`。
  - `devDependencies`: `@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`@sinclair/typebox: "^0.34.0"`、`@types/node`、`typescript`、`vitest`（均 latest 对齐 root）。
  - `pi.extensions: ["./index.ts"]`。
  - 参考 `packages/goal/package.json`。
- [x] **S1.3** 写 `packages/todo/tsconfig.json`：`extends: "../../tsconfig.base.json"`、`compilerOptions.outDir: "dist"`、`include: ["./**/*.ts"]`、`exclude: ["node_modules","dist"]`、`references: [{ "path": "../common" }]`。参考 `packages/goal/tsconfig.json`。
- [x] **S1.4** 根 `tsconfig.json` 的 `references` 追加 `{ "path": "packages/todo" }`。
- [x] **S1.5** 实现 `config.ts`（**REWRITE**）：
  - 导出 `GuidanceFields`（`promptSnippet?: string; promptGuidelines?: string[]`）、`TodoConfig`（`guidance?: GuidanceFields`）、`loadConfig()`。
  - `loadConfig` → `readConfig<TodoConfig>("todo", { defaults: {} })`（从 `@htwang-contrib/common`）。
  - **不**导出 `validateGuidanceFields`（校验下沉到 `todo.ts` 的 `?? DEFAULT`）。
- [x] **S1.6** `npx tsc --build` 通过（此时仅 config.ts，无外部副作用）+ `npm run format`。

---

## Phase 2 — 核心数据层（纯端口）

> 模块：[`tool/types`](./MODULES.md#tooltypes--adapt) · [`state/state`](./MODULES.md#statestatets--port) · [`state/invariants`](./MODULES.md#stateinvariantsts--port) · [`state/task-graph`](./MODULES.md#statetask-graphts--port) · [`state/state-reducer`](./MODULES.md#statestate-reducerts--port) · [`state/store`](./MODULES.md#statestorets--port) · [`state/selectors`](./MODULES.md#stateselectorst--port) · [`tool/response-envelope`](./MODULES.md#toolresponse-envelopets--port)

- [x] **S2.1** `tool/types.ts`（**ADAPT**）：
  - `import { type Static, Type } from "@sinclair/typebox"`（替换 `typebox` + `StringEnum`）。
  - 身份常量 `TOOL_NAME="todo"` / `TOOL_LABEL="Todo"` / `COMMAND_NAME="todos"`（**不可改名**，TOOL_NAME 是 replay 过滤键）；`ERR_REQUIRES_INTERACTIVE` / `MSG_NO_TODOS`。
  - 类型：`TaskStatus`（4 态）/ `TaskAction`（6 动作）/ `Task` / `TaskDetails` / `TaskMutationParams`（带索引签名）。
  - `TodoParamsSchema`：action/status 用 `Type.Union([Type.Literal(...)])` 替换 `StringEnum`；**逐字保留**所有 `description`（LLM prompt 文案）。
- [x] **S2.2** `state/state.ts`（**PORT**）：`TaskState`（tasks + nextId）+ `EMPTY_STATE`（`{tasks:[], nextId:1}`）；`Task` import 用 `.ts`。
- [x] **S2.3** `state/invariants.ts`（**PORT**）：`VALID_TRANSITIONS` 表 + `isTransitionValid(from,to)`（same→same 合法）。表见 MODULES。
- [x] **S2.4** `state/task-graph.ts`（**PORT**）：`detectCycle(taskList, taskId, newBlockedBy)`（合并依赖集后三色 DFS）+ `deriveBlocks(taskList)`（反向邻接 Map）。
- [x] **S2.5** `state/state-reducer.ts`（**PORT**）：
  - 导出 `Op` 联合（7 变体含 error）、`ApplyResult`、`applyTaskMutation(state, action, params)`。
  - 6 action 分支按 MODULES 行为实现；error 路径返回 `{ state: <入参原 state>, op:{kind:"error",message} }`（**state 不变**）。
  - 校验全部内联：create 要 subject、update 要 id+可变字段、转换合法性、blockedBy 存在/非 deleted/非自指、metadata null 删 key、addBlockedBy 后 `detectCycle`。
  - `Op` 闭合 union——下一步 envelope 的 `formatContent` 对它 exhaustive switch。
- [x] **S2.6** `state/store.ts`（**PORT**）：模块级 `let state`；导出 `getState` / `getTodos`（readonly）/ `getNextId` / `commitState` / `replaceState` / `__resetState`（双下划线测试约定保留）。
- [x] **S2.7** `state/selectors.ts`（**PORT**）：`selectVisibleTasks` / `selectTasksByStatus`（顺序 pending/inProgress/completed）/ `selectTodoCounts` / `selectShowTaskIds` / `selectTaskSubjectById` / `selectOverlayLayout(state, budget)`（先留 1 行给摘要，再丢 completed，再裁 pending 尾）/ `selectHasActive` / `ACTIVE_STATUSES`。无 i18n import。
- [x] **S2.8** `tool/response-envelope.ts`（**PORT**）：`formatContent(op, state)`（exhaustive switch，6 种输出）+ `buildToolResult(action, params, state, op)`（`details` 是完整快照 `{action,params,tasks,nextId,error?}`）。`get` 的 blocks 用 `deriveBlocks` 反查。
- [x] **S2.9** `npx tsc --build` 通过（数据层全纯函数，无副作用）+ `npm run format`。

---

## Phase 3 — Replay + 注册层

> 模块：[`state/replay`](./MODULES.md#statereplayts--port) · [`todo`](./MODULES.md#todots--adapt) · DESIGN §4 模块职责

- [x] **S3.1** `state/replay.ts`（**PORT**）：
  - `isTaskDetails(value)`（防御性守卫：tasks 是数组 + nextId 是 number）。
  - `replayFromBranch(ctx)`：遍历 `ctx.sessionManager.getBranch()`，取**最后一条** `type==="message" && role==="toolResult" && toolName==="todo" && isTaskDetails(details)`，拷贝其 `tasks`/`nextId`；无命中 → `EMPTY_STATE`。**纯函数，不碰 store**。
- [x] **S3.2** `todo.ts`（**ADAPT**）：
  - **删**：整块 backward-compat re-export（`isTransitionValid`/`applyTaskMutation`/`store` 符号/`task-graph` 符号/类型/`TOOL_NAME`）、`reconstructTodoState` shim、`import { formatStatusLabel, t } from "./state/i18n-bridge.ts"`。
  - 内联常量：`SECTION_PENDING` / `SECTION_IN_PROGRESS` / `SECTION_COMPLETED`、`DEFAULT_PROMPT_SNIPPET`、`DEFAULT_PROMPT_GUIDELINES`（7 条，逐字保留）。
  - `registerTodoTool(pi)`：`guidance = loadConfig().guidance`（**不**过 `validateGuidanceFields`）→ `pi.registerTool({ name, label, description, promptSnippet: guidance?.promptSnippet ?? DEFAULT, promptGuidelines: guidance?.promptGuidelines ?? DEFAULT, parameters: TodoParamsSchema, execute })`。**不传 `renderCall` / `renderResult`**（渲染迁移到 tool-display adapter，见 Phase 7）。
    - `execute`：`result = applyTaskMutation(getState(), params.action, params)` → `commitState(result.state)` → `return buildToolResult(...)`。三步固定管线。
  - `registerTodosCommand(pi)`：无 UI → `notify(ERR_REQUIRES_INTERACTIVE,"error")`；空 → `notify(MSG_NO_TODOS,"info")`；否则三段（section 顺序 pending→in_progress→completed）+ header 计数（顺序 completed·in_progress·pending）+ `formatCommandTaskLine`，`notify(lines.join("\n"),"info")`。`t(...)`/`formatStatusLabel(...)` 全替换为字面量。
  - 从 `./view/format.ts` 只 import `formatCommandTaskLine`（不 import `renderTodoCall`/`renderTodoResult`）。
- [x] **S3.3** `npx tsc --build` 通过 + `npm run format`。

---

## Phase 4 — UI 层

> 模块：[`view/format`](./MODULES.md#viewformatts--adapt) · [`todo-overlay`](./MODULES.md#todo-overlayts--adapt) · [`index`](./MODULES.md#indexts--adapt)

- [x] **S4.1** `view/format.ts`（**ADAPT**）：
  - **删** `import { formatStatusLabel } from "../state/i18n-bridge.ts"` 与 `export { formatStatusLabel }` 再导出。
  - 现在文件只剩 3 个导出函数：`overlayStatusGlyph(status, theme)`（overlay 字形：pending○/in_progress◐/completed✓/deleted✗）、`formatOverlayTaskLine(t, theme, showId)`、`formatCommandTaskLine(t, glyph)`。
  - **删** `renderTodoCall` / `renderTodoResult`（渲染迁移到 tool-display adapter，见 Phase 7）。
  - **删** 颜色/字形表 `STATUS_GLYPH` / `STATUS_COLOR` / `ACTION_GLYPH`（overlay 字形内联进 `overlayStatusGlyph`；ACTION_GLYPH 不再需要——tool-display adapter 的 header 直接用 action 名字）。
- [x] **S4.2** `todo-overlay.ts`（**ADAPT**）：
  - **删** `import { formatStatusLabel, t } from "./state/i18n-bridge.ts"`。
  - `WIDGET_KEY = "rpiv-todos"`（**保留**，迁移用户不丢 widget）；`MAX_WIDGET_LINES = 12`；`OVERLAY_HEADING = "Todos"`；`OVERLAY_MORE = "more"`。
  - `t("overlay.heading", OVERLAY_HEADING)` → `OVERLAY_HEADING`；`t("overlay.more", OVERLAY_MORE)` → `OVERLAY_MORE`；`formatStatusLabel("completed"|"pending")` → 字面量。
  - 其余生命周期逻辑原样：`setUICtx`（身份比较幂等）/ `update`（空则注销，否则注册或 requestRender）/ `resetCompletedDisplayState` / `hideCompletedTasksFromPreviousTurn` / `renderWidget`（heading + selectOverlayLayout + `├─/└─` + withTrailingSpacer）/ `dispose`。
- [x] **S4.3** `index.ts`（**ADAPT**）：
  - `import { isStaleCtxError } from "@htwang-contrib/common"`（替换内联正则）。
  - **删** 顶层 `await import("@juicesharp/rpiv-i18n/loader")` 块 + `import { I18N_NAMESPACE }`。
  - 默认导出：注册 tool+command；`session_start` → replay+replace + overlay 接管；`session_compact`/`session_tree` → try replay（stale 吞、其他抛）+ overlay reset/update；`session_shutdown` → dispose；`tool_execution_end`（仅本工具且非 error）→ overlay.update；`agent_start` → hideCompleted。
  - 参照 MODULES index 行为代码块。
- [x] **S4.4** `npx tsc --build` 通过 + `npm run format`。

---

## Phase 5 — 测试

> 模块：[测试基础设施](./MODULES.md#测试基础设施) · DESIGN §5 测试策略

- [x] **S5.1** `test/helpers.ts`：`createMockPi`（捕获 tools/commands/events）/ `createMockCtx`（hasUI/ui/sessionManager.getBranch）/ `createMockUI`（setWidget/notify）/ `identityTheme`（透传，去 ANSI）。
- [x] **S5.2** `state-reducer.test.ts`：6 action happy + 全 error 分支 + 转换矩阵 + metadata null 删 key + blockedBy add/remove/成环。
- [x] **S5.3** `store.test.ts`：get→commit→get、replace 整替、\_\_reset、getTodos 返回值不可 mutate。
- [x] **S5.4** `task-graph.test.ts`：环检测（含反向成环）、无环、deriveBlocks 反向邻接。
- [x] **S5.5** `response-envelope.test.ts`：6 种 op 输出 + list 过滤 + get 的 blocks 反查 + error。
- [x] **S5.6** `replay.test.ts`：mock branch（混杂非 todo toolResult）→ 取最后一条 todo 快照；空 → EMPTY_STATE；损坏 details 跳过。
- [x] **S5.7** `config.test.ts`：临时 XDG 目录 → 写 `{"todo":{...}}` → 读；空目录 → `{}`。
- [x] **S5.8** `todo.register.test.ts`：注册后 schema 形状、execute 三步管线、guidance `?? DEFAULT` 兜底（renderCall/renderResult 已不再测——见 Phase 7）。
- [x] **S5.9** `todo.command.test.ts`：无 UI guard、空、分组输出（section 顺序 pending→inProgress→completed,header 计数顺序相反）。
- [x] **S5.10** `todo-overlay.render.test.ts`：heading（有/无 active）、溢出摘要行、width 截断、空状态注销。
- [x] **S5.11** `todo-overlay.lifecycle.test.ts`：setUICtx 幂等、reset、dispose、agent_start 折叠、/reload 身份变化重注册。
- [x] **S5.12** `npm test` 全绿 + `npx tsc --build` + `npm run format`。

---

## Phase 6 — 集成与收尾

- [x] **S6.1** `npx tsc --build` 全包零错误。
- [x] **S6.2** `npm run format`。
- [ ] **S6.3** 手测（`pi -e packages/todo/index.ts`）：
  - create/update/list/get/delete/clear 各 action + 各 error。
  - `/todos`（无 UI / 空 / 三段分组）。
  - overlay 渲染（heading/折叠/溢出/空注销）。
  - `/reload` 后 replay 恢复（TOOL_NAME 不变是前提）。
  - compact 后状态不丢。
- [x] **S6.4** 更新根 `AGENTS.md` 包列表，追加 `packages/todo/` 一行。
- [x] **S6.5** 写 `packages/todo/README.md`：功能、`/todos` 用法、`todo` 工具 action 表、配置项（`extensions.json` 的 `"todo"` 段）、链接到本 docs。
- [x] **S6.6** 更新本文件总进度表：Phase 0–6 全 `[x]` + 填完成日期。

---

## Phase 7 — tool-display 适配（渲染层迁移）

> 完成日期：2026-06-13。首版完成后，为对齐 monorepo 风格（goal / memory / read / bash 等工具都走 tool-display adapter 统一渲染），把 todo 工具的调用/结果渲染从 todo 包内部迁出到 `packages/tool-display/`。规格见 [MODULES.md § tool-display adapter](./MODULES.md#tool-display-adapter--new)，上游对照见 [SOURCE-ANALYSIS.md §6](./SOURCE-ANALYSIS.md#6-tooldisplayadapterstodots--tool-callresult-rendering-adapter-new)。

- [x] **S7.1** 新建 `packages/tool-display/adapters/todo.ts`：导出 `todoAdapter: ToolDisplayAdapter<TodoArgs>`（`TodoArgs = {action?, subject?, id?, status?}`），实现 `formatCallHeader` / `formatCollapsedContent` / `formatExpandedContent`（header 直接用 action 名字，不再用字形符号）。
- [x] **S7.2** `packages/tool-display/registry.ts`：`globalToolDisplayRegistry.register("todo", todoAdapter)`。
- [x] **S7.3** `packages/tool-display/index.ts`：导出 `todoAdapter`。
- [x] **S7.4** 删除 `packages/todo/todo.ts` 的 `renderCall` / `renderResult`：`registerTool` 对象不再传这两个字段；从 `./view/format.ts` 只 import `formatCommandTaskLine`。
- [x] **S7.5** 删除 `packages/todo/view/format.ts` 的 `renderTodoCall` / `renderTodoResult` / `STATUS_GLYPH` / `STATUS_COLOR` / `ACTION_GLYPH`，文件只剩 `overlayStatusGlyph` / `formatOverlayTaskLine` / `formatCommandTaskLine` 三个导出。
- [x] **S7.6** `npx tsc --build` 通过 + `npm run format`。
- [x] **S7.7** 手测：todo 工具调用头（action 名字 + 关键参数）、折叠摘要（`└ ...`）、error 路径、list 计数，均由 tool-display adapter 渲染。

---

## 未来增强（首版不做）

- [ ] 用 `@htwang-contrib/common` 的 `registerConfigItems` 把 `promptSnippet`/`promptGuidelines` 接入 `/config` TUI 编辑。
- [ ] i18n（目前刻意不做，内联英文）。
- [ ] `validateConfigShape` 提升到 common（≥2 扩展需要时再做）。
