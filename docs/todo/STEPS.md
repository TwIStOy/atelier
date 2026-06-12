# Todo Extension — Implementation Checklist

可执行清单：按顺序勾选。每步标注对应的 [DESIGN.md](./DESIGN.md) 章节与 [SOURCE-ANALYSIS.md](./SOURCE-ANALYSIS.md) 文件，方便对照实现，不重复设计细节。

---

## Phase 0 — Prerequisites

- [ ] 读 [DESIGN.md](./DESIGN.md) 确认架构决策（§3 关键差异）。
- [ ] 读 [SOURCE-ANALYSIS.md](./SOURCE-ANALYSIS.md) 确认逐文件改动（§3 per-file、§4 summary 表）。
- [ ] 确认根 `tsconfig.json` 的 `references` 已含 `{ "path": "packages/todo" }`。
- [ ] 确认 `packages/common` 导出 `readConfig` 与 `isStaleCtxError`（`state/session-cache.ts`）。

## Phase 1 — Scaffold & 配置层（无 UI 依赖）

> ref: DESIGN §2 包结构 · §7/§8 package.json/tsconfig.json

- [ ] **S1.1** 创建目录 `packages/todo/{state,tool,view,test}/`。
- [ ] **S1.2** 写 `packages/todo/package.json`（`@htwang-contrib/todo`，`dependencies: @htwang-contrib/common`，`pi.extensions: ["./index.ts"]`）。
- [ ] **S1.3** 写 `packages/todo/tsconfig.json`（extends `tsconfig.base.json`，references → `../common`）。
- [ ] **S1.4** 根 `tsconfig.json` 的 `references` 追加 `{ "path": "packages/todo" }`。
- [ ] **S1.5** 写 `config.ts` — `readConfig("todo", { defaults: {} })`，导出 `GuidanceFields` / `TodoConfig` / `loadConfig`。
  > ref: SOURCE-ANALYSIS `config.ts`（before/after 代码块）

## Phase 2 — 核心数据层（纯端口）

> ref: SOURCE-ANALYSIS §2 核心类型 · §3 各 `state/*` 与 `tool/types.ts` 文件

- [ ] **S2.1** `tool/types.ts` — 类型 + schema。`@sinclair/typebox` 的 `Type.Union([Type.Literal(...)])` 替代 `StringEnum`；`description` 原样保留；`TOOL_NAME="todo"` / `TOOL_LABEL="Todo"` / `COMMAND_NAME="todos"`。
- [ ] **S2.2** `state/state.ts` — `TaskState` + `EMPTY_STATE`（import `Task` 用 `.ts`）。
- [ ] **S2.3** `state/invariants.ts` — `VALID_TRANSITIONS` + `isTransitionValid`。
- [ ] **S2.4** `state/task-graph.ts` — `detectCycle` + `deriveBlocks`。
- [ ] **S2.5** `state/store.ts` — `getState` / `getTodos` / `getNextId` / `commitState` / `replaceState` / `__resetState`。
- [ ] **S2.6** `state/state-reducer.ts` — `applyTaskMutation`（纯 reducer，错误时不改 state）。
- [ ] **S2.7** `state/selectors.ts` — 全部选择器（去掉 i18n import）。
- [ ] **S2.8** `tool/response-envelope.ts` — `buildToolResult` / `formatContent` / `formatListLine` / `formatGetLines`。
- [ ] **S2.9** `npx tsc --build` 通过（数据层无外部副作用）。

## Phase 3 — Replay + 注册层

> ref: SOURCE-ANALYSIS `state/replay.ts` · `todo.ts` · DESIGN §4 模块职责

- [ ] **S3.1** `state/replay.ts` — `isTaskDetails` 类型守卫 + `replayFromBranch(ctx)`（last-write-wins，不改 store）。
- [ ] **S3.2** `todo.ts` — 移除 backward-compat re-export 块与 `reconstructTodoState` shim；`registerTodoTool(pi)`（config → schema → execute: reducer → commit → envelope）；`registerTodosCommand(pi)`（内联英文 section header，`ctx.ui.notify`）。

## Phase 4 — UI 层

> ref: SOURCE-ANALYSIS `view/format.ts` · `todo-overlay.ts`

- [ ] **S4.1** `view/format.ts` — 去 `formatStatusLabel` import/re-export；内联英文 label；保留 `STATUS_GLYPH`/`STATUS_COLOR`/`ACTION_GLYPH` 表与各 render 函数。
- [ ] **S4.2** `todo-overlay.ts` — 去 i18n import；`OVERLAY_HEADING`/`OVERLAY_MORE` 内联；`formatStatusLabel(...)` → 字面量；`WIDGET_KEY` 保持 `"rpiv-todos"`；其余生命周期逻辑原样。
- [ ] **S4.3** `index.ts` — 入口：`isStaleCtxError` 从 common 导入；注册 tool+command；`session_start/compact/tree` → replay+replace（后两者 try/catch）；`tool_execution_end` → overlay.update；`agent_start` → hideCompleted；`session_shutdown` → dispose。无动态 i18n import。
  > ref: SOURCE-ANALYSIS `index.ts` 完整 after 代码块

## Phase 5 — 测试

> ref: DESIGN §5 测试策略

- [ ] **S5.1** `test/helpers.ts` — `createMockPi` / `createMockCtx` / `createMockUI` / `identityTheme`。
- [ ] **S5.2** `state-reducer.test.ts`（全 action + 状态转换）。
- [ ] **S5.3** `store.test.ts`（get/commit/replace/reset）。
- [ ] **S5.4** `task-graph.test.ts`（环检测 + 反向邻接）。
- [ ] **S5.5** `response-envelope.test.ts`（信封格式化）。
- [ ] **S5.6** `replay.test.ts`（branch mock + 类型守卫）。
- [ ] **S5.7** `todo.register.test.ts`（注册 + execute + render）。
- [ ] **S5.8** `todo.command.test.ts`（guard + 分组输出）。
- [ ] **S5.9** `todo-overlay.render.test.ts`（heading/溢出/width 截断）。
- [ ] **S5.10** `todo-overlay.lifecycle.test.ts`（注册/注销/重置）。
- [ ] **S5.11** `npm test` 全绿。

## Phase 6 — 集成与收尾

- [ ] **S6.1** `npx tsc --build` 全包通过。
- [ ] **S6.2** `npm run format`。
- [ ] **S6.3** 在 pi 中加载扩展，手测 create/update/list/get/delete/clear + `/todos` + overlay 渲染 + `/reload` 后 replay 恢复。
- [ ] **S6.4** 更新根 `AGENTS.md` 的包列表，追加 `packages/todo/` 一行说明。
- [ ] **S6.5** 写 `packages/todo/README.md`（功能、配置项、链接到本 docs）。

## 未来增强（首版不做）

- [ ] 通过 `@htwang-contrib/common` 的 `registerConfigItems` 注册配置项，接入 `/config` 编辑。
- [ ] i18n（目前刻意不做）。
