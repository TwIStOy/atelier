# Todo 扩展 — 模块规格（Per-Module Spec）

本文是 `packages/todo/` 每个模块的**实现规格**：导出什么、签名、行为、校验规则、依赖、相对上游的改动、测试覆盖。逐文件的上游 before/after 见 [SOURCE-ANALYSIS.md](./SOURCE-ANALYSIS.md)；高层决策见 [DESIGN.md](./DESIGN.md)；可执行清单见 [STEPS.md](./STEPS.md)。

> 约定：本文所有签名是**本 monorepo 落地后的目标签名**（ESM、`.ts` 扩展名、`@sinclair/typebox`、`@htwang-contrib/common`），不是上游逐字复制。每个模块顶部标注**移植动作**：`PORT`（原样照搬，只改 import 路径）/ `ADAPT`（改 import + 删 i18n + 内联英文）/ `REWRITE`（基于 common 重写）。

---

## 目录

| 层次 | 模块                                                          | 移植动作 | 一句话职责                                                  |
| ---- | ------------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| 配置 | [`config.ts`](#configts--rewrite)                             | REWRITE  | 从 `~/.config/pi/extensions.json` 的 `"todo"` 段读 guidance |
| 类型 | [`tool/types.ts`](#tooltypes--adapt)                          | ADAPT    | 任务类型 + TypeBox 参数 schema + 身份常量                   |
| 状态 | [`state/state.ts`](#statestatets--port)                       | PORT     | `TaskState` 接口 + `EMPTY_STATE`                            |
| 状态 | [`state/invariants.ts`](#stateinvariantsts--port)             | PORT     | 四态状态机转换表                                            |
| 状态 | [`state/task-graph.ts`](#statetask-graphts--port)             | PORT     | 依赖图：环检测 + 反向邻接                                   |
| 状态 | [`state/state-reducer.ts`](#statestate-reducerts--port)       | PORT     | 纯 reducer `(state, action, params) → { state, op }`        |
| 状态 | [`state/store.ts`](#statestorets--port)                       | PORT     | 模块级状态单元（唯一可变点）                                |
| 状态 | [`state/selectors.ts`](#stateselectorst--port)                | PORT     | 过滤/分组/计数/布局选择器                                   |
| 状态 | [`state/replay.ts`](#statereplayts--port)                     | PORT     | 从 session branch 回放状态                                  |
| 工具 | [`tool/response-envelope.ts`](#toolresponse-envelopets--port) | PORT     | `(op, state) → LLM 返回信封`                                |
| 视图 | [`view/format.ts`](#viewformatts--adapt)                      | ADAPT    | renderCall/renderResult/命令行/overlay 格式化               |
| 视图 | [`todo-overlay.ts`](#todo-overlayts--adapt)                   | ADAPT    | above-editor widget 生命周期控制器                          |
| 注册 | [`todo.ts`](#todots--adapt)                                   | ADAPT    | Tool + Command 注册外壳                                     |
| 入口 | [`index.ts`](#indexts--adapt)                                 | ADAPT    | 扩展入口 + 生命周期 hook                                    |

---

## `config.ts` — REWRITE

**职责**：读取用户可覆盖的 prompt guidance（`promptSnippet` / `promptGuidelines`），让 `/config` 或手编 `extensions.json` 能替换默认 prompt 文案。

### 导出

```ts
export interface GuidanceFields {
  promptSnippet?: string;
  promptGuidelines?: string[];
}
export interface TodoConfig {
  guidance?: GuidanceFields;
}
export function loadConfig(): TodoConfig;
```

### 行为

- `loadConfig()` → `readConfig<TodoConfig>("todo", { defaults: {} })`（来自 `@htwang-contrib/common`）。
- 配置文件：`$XDG_CONFIG_HOME/pi/extensions.json`（无 XDG 则 `~/.config/pi/extensions.json`）的 `"todo"` 段。缺失/坏文件返回空对象（`readConfig` 内部已 try/catch）。

### 依赖

- `@htwang-contrib/common` 的 `readConfig`。

### 与上游差异（rewrite 原因）

上游用 `@juicesharp/rpiv-config`（`configPath("rpiv-todo")` + `loadJsonConfig` + `validateGuidanceFields`）。我们：

- 用 common 的 `readConfig("todo", ...)`（section key 从 `"rpiv-todo"` 改成 `"todo"`，与本 monorepo 命名一致）。
- **删除 `validateGuidanceFields` 的再导出**。上游它做两个字段（snippet 是 string、guidelines 是 string[]）的轻校验，调用方 `todo.ts` 实际拿到后用 `guidance.promptSnippet ?? DEFAULT` 的 nullish 合并兜底，校验价值有限。本版直接让 `todo.ts` 读 `loadConfig().guidance` 后用 `?? DEFAULT` 兜底——若用户配错类型，行为是「回退到默认」，可接受。

> 决策记录：若后续需要严格校验，回写到 `common` 做一个通用的 `validateConfigShape`（满足「≥2 个扩展可共享才提升」原则），不要在本包内手搓。

### 测试

- `config.test.ts`：mock `XDG_CONFIG_HOME` 到临时目录 → 写 `{"todo":{"guidance":{"promptSnippet":"x"}}}` → 断言 `loadConfig()` 返回值；空目录 → 返回 `{}`。

---

## `tool/types.ts` — ADAPT

**职责**：任务域类型 + LLM 面向的 TypeBox 参数 schema + 工具/命令身份常量。

### 导出

```ts
// 身份常量 —— TOOL_NAME 是 replay 的过滤键，不可改名
export const TOOL_NAME = "todo";
export const TOOL_LABEL = "Todo";
export const COMMAND_NAME = "todos";
// 用户可见文案常量（/todos 用）
export const ERR_REQUIRES_INTERACTIVE = "/todos requires interactive mode";
export const MSG_NO_TODOS = "No todos yet. Ask the agent to add some!";

// 域类型
export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";
export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";
export interface Task { id; subject; description?; activeForm?; status; blockedBy?; owner?; metadata? }
export interface TaskDetails { action; params; tasks; nextId; error? } // replay 快照
export interface TaskMutationParams { [key:string]:unknown; subject?; description?; ... } // 开放输入袋

// TypeBox schema
export const TodoParamsSchema: TObject;
export type TodoParams = Static<typeof TodoParamsSchema>;
```

### 行为

- **`Task`**：`id: number` / `subject: string` / `description?: string` / `activeForm?: string`（in_progress 时显示的现在进行时标签）/ `status: TaskStatus` / `blockedBy?: number[]` / `owner?: string` / `metadata?: Record<string, unknown>`。
- **`TaskDetails`**：每次成功的 `todo` 调用把**完整快照**放进 toolResult 的 `details`，replay 读最后一条恢复。字段名/顺序被跨版本兼容**钉死**。
- **`TaskMutationParams`**：保持 interface（带索引签名 `[key:string]:unknown`）而非纯 TypeBox `Static`，让 reducer 能宽松接收运行时入参，免去 `as` 强转。
- **`TodoParamsSchema`**：每个字段的 `description` 同时是 LLM prompt 文案，**逐字保留**上游措辞（见 SOURCE-ANALYSIS §3 `tool/types.ts`）。

### 关键改动（adapt）

```ts
// before
import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
action: StringEnum(["create","update","list","get","delete","clear"] as const)
status:  StringEnum(["pending","in_progress","completed","deleted"] as const, {...})

// after
import { type Static, Type } from "@sinclair/typebox";
action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("list"),
                    Type.Literal("get"), Type.Literal("delete"), Type.Literal("clear")])
status:  Type.Union([Type.Literal("pending"), Type.Literal("in_progress"),
                     Type.Literal("completed"), Type.Literal("deleted")], {...})
```

> `Type.Union([Type.Literal(...)])` 是本 monorepo 替代 `StringEnum` 的既定模式（goal 等扩展已用）。`@sinclair/typebox` 已是根 devDependency，不新增依赖。

### 依赖

- `@sinclair/typebox`。

### 测试

- 无独立测试文件（schema 由 `todo.register.test.ts` 间接覆盖：注册后参数 schema 形状正确）。

---

## `state/state.ts` — PORT

**职责**：定义状态形状与空状态。

### 导出

```ts
import type { Task } from "../tool/types.ts";
export interface TaskState {
  tasks: Task[];
  nextId: number; // 下一个新建 task 的 id（单调递增，clear 重置为 1）
}
export const EMPTY_STATE: TaskState = { tasks: [], nextId: 1 };
```

### 行为

- 纯类型 + 常量，无逻辑。`EMPTY_STATE` 是 `replay.ts` / `store.__resetState` 的公共起点。

### 改动

仅把 `Task` import 改成 `../tool/types.ts`（上游 `.js`，我们 `.ts`）。其余原样。

---

## `state/invariants.ts` — PORT

**职责**：四态状态机的合法转换表。

### 导出

```ts
export const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>>;
export function isTransitionValid(from: TaskStatus, to: TaskStatus): boolean;
```

### 行为

| from          | 可转到                                  |
| ------------- | --------------------------------------- |
| `pending`     | `in_progress` / `completed` / `deleted` |
| `in_progress` | `pending` / `completed` / `deleted`     |
| `completed`   | `deleted`（单向，不能回 `in_progress`） |
| `deleted`     | （终态，无出边）                        |

- `isTransitionValid`：**same→same 一律合法**（幂等），其余查表。reducer 的 update 分支用它判非法转换。

### 改动

原样（import 改 `.ts`）。

### 测试

- 由 `state-reducer.test.ts` 的转换用例间接覆盖；可选单独 `invariants.test.ts` 覆盖全 4×4 矩阵。

---

## `state/task-graph.ts` — PORT

**职责**：依赖图的纯算法。

### 导出

```ts
export function detectCycle(
  taskList: readonly Task[],
  taskId: number,
  newBlockedBy: readonly number[],
): boolean;
export function deriveBlocks(taskList: readonly Task[]): Map<number, number[]>;
```

### 行为

- **`detectCycle`**：判断「把 `newBlockedBy` 并入 `taskId` 的依赖集后是否成环」。构造邻接表（用合并后的依赖集替换 `taskId` 原值），三色 DFS（visiting/visited）判环。**纯函数、不读 store**——reducer 用它在提交前问「这次 update 会不会成环」。
- **`deriveBlocks`**：反向邻接——对每个 task T，列出所有「依赖了 T」的 task id。`selectShowTaskIds`（overlay 是否显示 `#id` 前缀）和 `get` action 的 `blocks: #x, #y` 行消费它。

### 改动

原样。

### 测试

- `task-graph.test.ts`：环检测（A→B→A、自环由 reducer 拦但此处也测）、无环、反向邻接正确性。

---

## `state/state-reducer.ts` — PORT

**职责**：**纯 reducer**，所有业务逻辑的单一来源。`(state, action, params) → { state, op }`。校验内联在 reducer 内，不单独抽校验模块。

### 导出

```ts
export type Op =
  | { kind: "create"; taskId: number }
  | { kind: "update"; id: number; fromStatus: TaskStatus; toStatus: TaskStatus }
  | { kind: "delete"; id: number; subject: string }
  | { kind: "list"; statusFilter?: TaskStatus; includeDeleted: boolean }
  | { kind: "get"; task: Task }
  | { kind: "clear"; count: number }
  | { kind: "error"; message: string };
export interface ApplyResult {
  state: TaskState;
  op: Op;
}
export function applyTaskMutation(
  state: TaskState,
  action: TaskAction,
  params: TaskMutationParams,
): ApplyResult;
```

### 行为（逐 action）

- **`create`**：`subject` 必填（trim 后非空，否则 `error: subject required`）。校验 `blockedBy`：每个 dep 必须存在且非 deleted。新建 `{ id: state.nextId, subject, status: "pending" }`，可选字段仅存在时挂上。`nextId + 1`。
- **`update`**：`id` 必填；task 必须存在；必须至少有一个可变字段（subject/description/activeForm/status/owner/metadata/addBlockedBy/removeBlockedBy 之一）。若改 `status` 用 `isTransitionValid` 校验，非法则 `error: illegal transition X → Y`。`removeBlockedBy` 做差集；`addBlockedBy` 逐个校验（不能自指、dep 必须存在、非 deleted、去重）后 `detectCycle` 判环。`metadata` 合并：值为 `null` 表示删 key，空对象则 `delete`。返回 `{ state, op: { kind:"update", fromStatus, toStatus } }`。
- **`list`**：不改 state，`op` 记 `includeDeleted` 与可选 `statusFilter`（由 envelope 据此过滤渲染）。
- **`get`**：`id` 必填，task 必须存在，否则 error；`op.task` 带回 task 供 envelope 渲染。
- **`delete`**：`id` 必填，task 必须存在且非 deleted；置 `status:"deleted"`（墓碑，不从数组移除，保 id 稳定）。
- **`clear`**：清空 `tasks`、`nextId` 重置 1；`op.count` 带回被清数量。

> **关键设计**：error 路径返回 `{ state: <入参原 state>, op:{kind:"error"} }`——**state 不变**，由 `execute` 照常 `commitState(result.state)`（等价无操作）。这让 reducer 无副作用、可纯单测、错误处理统一走 `op.kind === "error"` 分支（无需侧信道布尔量）。

### 依赖

- `state/state.ts`（TaskState）、`state/invariants.ts`（isTransitionValid）、`state/task-graph.ts`（detectCycle）、`tool/types.ts`（类型）。

### 改动

原样（import 路径 `.ts`）。`Op` 是闭合 tagged union——`response-envelope.ts` 的 `formatContent` 对它做 exhaustive switch，新增 action 会**编译报错**直到两处都加分支（强约束）。

### 测试

- `state-reducer.test.ts`：6 个 action 各自的 happy path + 全部 error 分支 + 状态转换矩阵 + metadata null 删 key + blockedBy add/remove/成环。

---

## `state/store.ts` — PORT

**职责**：模块级可变状态单元——**全包唯一的 mutation seam**。reducer 保持纯，store 负责提交。

### 导出

```ts
export function getState(): TaskState;
export function getTodos(): readonly Task[];
export function getNextId(): number;
export function commitState(next: TaskState): void; // execute() 在 reducer 后调
export function replaceState(next: TaskState): void; // 生命周期 hook（replay）调
export function __resetState(): void; // 测试 beforeEach 调
```

### 行为

- 模块级 `let state: TaskState = { ...EMPTY_STATE }`（拷贝，避免误改常量）。
- `getTodos` 返回 `readonly Task[]`，防调用方（overlay render、/todos、renderCall）改 live 状态。
- `commitState`（reducer 出口）与 `replaceState`（replay 出口）语义分离：前者是「应用一次 mutation」，后者是「整体替换快照」。
- `__resetState` 名字带双下划线是**刻意**的测试约定（上游 Plan 钉死），保留。

### 改动

原样。

> 决策：本 monorepo 用「单进程单状态单元」而非上游可选的 `getGlobalState`（common 里也有 `getGlobalState`，但 todo 不需要跨扩展共享状态）。如果未来要做跨扩展读取，再用 common 的 `getGlobalState` 包一层。

### 测试

- `store.test.ts`：get→commit→get 状态变化、replace 整替、\_\_reset 复位、getTodos 返回值不可 mutate（mutate 后不影响 getState）。

---

## `state/selectors.ts` — PORT

**职责**：纯选择器——过滤/分组/计数/布局决策。无 i18n。

### 导出

```ts
export function selectVisibleTasks(state): readonly Task[]; // 去掉 deleted
export function selectTasksByStatus(state): TasksByStatus; // {pending,inProgress,completed}
export function selectTodoCounts(state): TodoCounts; // {total,pending,inProgress,completed}
export function selectShowTaskIds(state): boolean; // 是否有任一 task 带 blockedBy
export function selectTaskSubjectById(state, id): string | undefined;
export function selectOverlayLayout(state, budget): OverlayLayout; // {visible, hiddenCompleted, truncatedTail}
export function selectHasActive(state): boolean; // 是否有 pending/in_progress
export const ACTIVE_STATUSES: ReadonlySet<TaskStatus>;
```

### 行为（重点：overlay 布局）

`selectOverlayLayout(state, budget)`：`budget` 是**正文行数**（调用方传 `MAX_WIDGET_LINES - 1`，留一行给 heading）。规则：

1. 全部 visible ≤ budget → 全显，无溢出。
2. 超出时先预留 1 行给 `+N more` 摘要（innerBudget = budget - 1），**优先丢 completed**，再裁 pending 尾部。
3. 返回 `{ visible, hiddenCompleted, truncatedTail }`——overlay 据此渲染摘要行（`+N more (X completed, Y pending)`）。

### 改动

原样。仅删上游可能存在的 `formatStatusLabel` import（本模块无 i18n，上游 selectors 实际也未 import i18n）。

### 测试

- 覆盖在 `todo-overlay.render.test.ts`（布局截断）与 `todo.command.test.ts`（分组顺序 pending→inProgress→completed）。

---

## `state/replay.ts` — PORT

**职责**：从 session branch 恢复状态（last-write-wins）。**纯函数，不触碰 store**。

### 导出

```ts
export function isTaskDetails(value: unknown): value is TaskDetails;
export function replayFromBranch(ctx: {
  sessionManager: { getBranch(): Iterable<unknown> };
}): TaskState;
```

### 行为

- 遍历 `ctx.sessionManager.getBranch()`（按时间序），找**最后一条** `type === "message"` 且 `message.role === "toolResult"` 且 `message.toolName === "todo"` 且 `details` 通过 `isTaskDetails` 的条目。
- `isTaskDetails`：防御性类型守卫——要求 `tasks` 是数组、`nextId` 是 number（旧/损坏 session 静默跳过）。
- 命中 → 拷贝 `details.tasks`（`map(t => ({...t}))` 防共享引用）+ `details.nextId`；无命中 → `EMPTY_STATE`。
- **不调 `replaceState`**——调用方（`index.ts` 生命周期 hook）拿到返回值后自己 `replaceState`。

### 依赖

- `state/state.ts`、`tool/types.ts`。`ctx.sessionManager.getBranch()` API 与本 monorepo 的 pi 版本一致（DESIGN §6 已确认）。

### 改动

原样。

### 测试

- `replay.test.ts`：mock branch（多条 message，含非 todo 的 toolResult 混杂）→ 断言取最后一条 todo 的快照；空 branch → EMPTY_STATE；损坏 details（缺 nextId）→ 跳过。

---

## `tool/response-envelope.ts` — PORT

**职责**：`(op, state) → { content, details }`——纯格式化器，构造 LLM 返回信封。

### 导出

```ts
export function formatContent(op: Op, state: TaskState): string;
export function buildToolResult(
  action,
  params,
  state,
  op,
): { content: Array<{ type: "text"; text: string }>; details: TaskDetails };
```

### 行为

- **`formatContent`**：对 `op.kind` 做**exhaustive switch**（新增 Op 变体编译报错）：
  - `create` → `Created #id: subject (pending)`
  - `update` → `Updated #id` + 状态变化时追加 `(from → to)`
  - `delete` → `Deleted #id: subject`
  - `clear` → `Cleared N tasks`
  - `list` → 按 `op.includeDeleted`/`op.statusFilter` 过滤后逐行 `formatListLine`（`[status] #id subject (activeForm) ⛓ #dep,#dep`），空则 `No tasks`
  - `get` → `formatGetLines`（`#id [status] subject` + description/activeForm/blockedBy/**blocks**/owner，顺序被快照测试钉死）
  - `error` → `Error: message`
- **`buildToolResult`**：`text = formatContent(op, state)`；`details` = 完整快照 `{ action, params, tasks, nextId, error? }`（error 时挂 `error`）。

### 改动

原样（无 i18n，内联英文）。`get` 行的 `blocks` 由 `deriveBlocks` 反查，确保用户能看到「谁在依赖我」。

### 测试

- `response-envelope.test.ts`：6 种 op 的输出 + list 过滤 + get 的 blocks 反查 + error。

---

## `view/format.ts` — ADAPT

**职责**：TUI 渲染——renderCall / renderResult / 命令行 / overlay 行格式化 + 颜色字形表。

### 导出

```ts
// 颜色/字形表（单一真相源）
export const STATUS_GLYPH: Record<TaskStatus, string>; // pending○ in_progress◐ completed● deleted⊘
export const STATUS_COLOR: Record<TaskStatus, string>; // pending dim / in_progress warning / completed success / deleted muted
export const ACTION_GLYPH: Record<TaskAction, string>; // create+ update→ delete× get› list☰ clear∅
// 渲染函数
export function overlayStatusGlyph(status, theme): string; // overlay 用：completed✓ deleted✗（与 STATUS_GLYPH 不同）
export function formatOverlayTaskLine(t, theme, showId): string;
export function formatCommandTaskLine(t, glyph): string; // /todos 行
export function renderTodoCall(args, theme, state): Text; // tool 调用行
export function renderTodoResult(result, theme): Text; // tool 结果行
```

### 行为

- `renderTodoCall`：根据 `args.action` 选 `ACTION_GLYPH`；create 显示 subject，update/get/delete 用 `selectTaskSubjectById` 查 subject（查不到回退 `#id`），list 显示 status label。
- `renderTodoResult`：从 `result.details.action` 推断要 echo 的 status——create 取最后一条 task 的 status、update 取 `params.status` 或当前 task status、delete 取该 task status；list/get/clear 不 echo status，回退 `✓`。
- `formatOverlayTaskLine`：completed/deleted 走 `strikethrough` + dim，in_progress 带 activeForm 后缀，blockedBy 带 `⛓ #id,#id` 后缀。

### 关键改动（adapt）

1. **删** `import { formatStatusLabel } from "../state/i18n-bridge.ts"` 与 `export { formatStatusLabel }` 再导出。
2. 所有 `formatStatusLabel(status)` 调用点直接用 `status` 字面量（`args.status` 本就是英文枚举值）——renderCall 的 list 分支显示 `theme.fg("muted", args.status)` 即可。

### 依赖

- `@earendil-works/pi-coding-agent`（Theme）、`@earendil-works/pi-tui`（Text）、`state/selectors.ts`。

### 测试

- `todo.register.test.ts`（renderCall/renderResult）+ `todo-overlay.render.test.ts`（formatOverlayTaskLine）。

---

## `todo-overlay.ts` — ADAPT

**职责**：`aboveEditor` widget 生命周期控制器——注册/刷新/折叠/注销，读取 live store 渲染。

### 导出

```ts
export class TodoOverlay {
  setUICtx(ctx: ExtensionUIContext): void;
  update(): void;
  resetCompletedDisplayState(): void;
  hideCompletedTasksFromPreviousTurn(): void;
  dispose(): void;
}
```

### 行为

- **常量**：`WIDGET_KEY = "rpiv-todos"`（**保留**，从 rpiv-todo 迁移的用户 widget 不丢）、`MAX_WIDGET_LINES = 12`、`OVERLAY_HEADING = "Todos"`、`OVERLAY_MORE = "more"`。
- **`setUICtx(ctx)`**：身份比较——`ctx` 变了（`/reload`）才失效 `widgetRegistered`/`tui`，保证 `session_start` 重复调用幂等。
- **`update()`**：读 `getState()` → 若 visible 为空则注销 widget；否则首次 `setWidget(key, factory, {placement:"aboveEditor"})` 注册，后续 `tui.requestRender()` 刷新。**永远不在此调 `replayFromBranch`**（`tool_execution_end` 时 branch 是 stale 的）。
- **折叠状态**：`completedTaskIdsPendingHide`（本 turn 新完成的，`agent_start` 时移入 hidden）/ `hiddenCompletedTaskIds`（已隐藏）/ `lastNextId`（检测 clear 重置）。`resetCompletedDisplayState` 在 `session_start`/`compact`/`tree` 清空。
- **`renderWidget(theme, width)`**：heading（`Todos (completed/total)`，有 active 用 accent+●，否则 dim+○）→ `selectOverlayLayout(state, MAX_WIDGET_LINES-1)` 决定正文 → 每行 `├─ <taskLine>`，末行换 `└─`；溢出追加 `└─ +N more (X completed, Y pending)`；末尾 `withTrailingSpacer` 加空行与编辑器留白。每行 `truncateToWidth(line, width, "…")`。
- **`hideCompletedTasksFromPreviousTurn`**：把 pendingHide 集合移入 hidden，触发重渲染（`agent_start` 调，让上一轮已完成的任务在新轮开始时收起）。

### 关键改动（adapt）

1. **删** `import { formatStatusLabel, t } from "./state/i18n-bridge.ts"`。
2. `t("overlay.heading", OVERLAY_HEADING)` → `OVERLAY_HEADING`；`t("overlay.more", OVERLAY_MORE)` → `OVERLAY_MORE`。
3. `formatStatusLabel("completed"|"pending")` → 字面量 `"completed"` / `"pending"`。
4. `WIDGET_KEY` 不改（见上）。

### 依赖

- `@earendil-works/pi-coding-agent`（ExtensionUIContext、Theme）、`@earendil-works/pi-tui`（TUI、truncateToWidth）、`state/store.ts`、`state/selectors.ts`、`view/format.ts`。

### 测试

- `todo-overlay.render.test.ts`（heading/溢出/width 截断/空状态注销）、`todo-overlay.lifecycle.test.ts`（setUICtx 幂等、reset、dispose、agent_start 折叠）。

---

## `todo.ts` — ADAPT

**职责**：Tool + Command 注册外壳（薄层）。

### 导出

```ts
export const DEFAULT_PROMPT_SNIPPET: string;
export const DEFAULT_PROMPT_GUIDELINES: string[];
export function registerTodoTool(pi: ExtensionAPI): void;
export function registerTodosCommand(pi: ExtensionAPI): void;
```

### 行为

- **`registerTodoTool(pi)`**：
  1. `const guidance = loadConfig().guidance;`（直接取，校验下沉到 `?? DEFAULT`）。
  2. `pi.registerTool({ name: TOOL_NAME, label: TOOL_LABEL, description, promptSnippet: guidance?.promptSnippet ?? DEFAULT_PROMPT_SNIPPET, promptGuidelines: guidance?.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES, parameters: TodoParamsSchema, execute, renderCall, renderResult })`。
  3. **`execute`**：`result = applyTaskMutation(getState(), params.action, params)` → `commitState(result.state)` → `return buildToolResult(params.action, params, result.state, result.op)`。三步固定管线，execute 不含业务逻辑。
  4. `renderCall(args, theme)` → `renderTodoCall(args, theme, getState())`；`renderResult(result, _opts, theme)` → `renderTodoResult(result, theme)`。
- **`registerTodosCommand(pi)`**：
  1. 无 UI → `ctx.ui.notify(ERR_REQUIRES_INTERACTIVE, "error")` return。
  2. visible 为空 → `ctx.ui.notify(MSG_NO_TODOS, "info")` return。
  3. 否则按 `selectTasksByStatus` 分三组（section 顺序 pending→inProgress→completed），header 用 `selectTodoCounts` 拼 `X/total completed · Y in_progress · Z pending`，每段带 `── Section ──` 标题 + `formatCommandTaskLine`，`ctx.ui.notify(lines.join("\n"), "info")`。
- **`DEFAULT_PROMPT_GUIDELINES`**：上游 7 条 guidelines 逐字保留（LLM 行为约束，见 SOURCE-ANALYSIS）。

### 关键改动（adapt）

1. **删整块 backward-compat re-export**（`export { isTransitionValid }`、`export { applyTaskMutation }`、`export { __resetState, getNextId, getTodos }`、`export { deriveBlocks, detectCycle }`、`export type { Task, ... }`、`export { TOOL_NAME }`）——本 monorepo 无遗留消费者，直接深层 import。
2. **删 `reconstructTodoState(ctx)` shim**——调用方直接 `replaceState(replayFromBranch(ctx))`。
3. **删** `import { formatStatusLabel, t } from "./state/i18n-bridge.ts"`。
4. `t("command.requires_interactive", ...)` → `ERR_REQUIRES_INTERACTIVE`；`t("command.no_todos", ...)` → `MSG_NO_TODOS`；`t("command.section.*", ...)` → 内联 `SECTION_*` 常量；`formatStatusLabel(status)` → 字面量。
5. `validateGuidanceFields(loadConfig().guidance)` → `loadConfig().guidance`（见 config.ts 改动）。

### 依赖

- `config.ts`、`state/selectors.ts`、`state/state-reducer.ts`、`state/store.ts`、`tool/response-envelope.ts`、`tool/types.ts`、`view/format.ts`。

### 测试

- `todo.register.test.ts`（注册→schema→execute→renderCall/renderResult）、`todo.command.test.ts`（无 UI guard、空、分组输出顺序）。

---

## `index.ts` — ADAPT

**职责**：扩展入口——注册 tool/command、管理 overlay 单例、接生命周期 hook。

### 导出

```ts
export default function (pi: ExtensionAPI): void;
```

### 行为（生命周期）

```ts
export default function (pi: ExtensionAPI) {
  let todoOverlay: TodoOverlay | undefined; // 惰性：首个有 UI 的 session_start 才 new
  registerTodoTool(pi);
  registerTodosCommand(pi);

  pi.on("session_start", async (_e, ctx) => {
    replaceState(replayFromBranch(ctx)); // 总是 replay（启动即恢复）
    if (ctx.hasUI) {
      todoOverlay ??= new TodoOverlay();
      todoOverlay.setUICtx(ctx.ui);
      todoOverlay.resetCompletedDisplayState();
      todoOverlay.update();
    }
  });
  for (const ev of ["session_compact", "session_tree"] as const) {
    pi.on(ev, async (_e, ctx) => {
      try {
        replaceState(replayFromBranch(ctx));
      } catch (e) {
        // compact/tree 可能遇到 stale ctx
        if (!isStaleCtxError(e)) throw e;
      }
      todoOverlay?.resetCompletedDisplayState();
      todoOverlay?.update();
    });
  }
  pi.on("session_shutdown", async () => {
    todoOverlay?.dispose();
    todoOverlay = undefined;
  });
  pi.on("tool_execution_end", async (e) => {
    if (e.toolName !== TOOL_NAME || e.isError) return;
    todoOverlay?.update();
  });
  pi.on("agent_start", async () => {
    todoOverlay?.hideCompletedTasksFromPreviousTurn();
  });
}
```

- **`session_start`**：无条件 replay + 接管 overlay。
- **`session_compact`/`session_tree`**：compact 与 session 销毁竞速——pi-core 会发 compact 但 ctx 已是死代理，`replaceState(replayFromBranch(ctx))` 抛 stale 错，**吞掉**（新 session 的 `session_start` 会重新 replay）；其他错是真实 bug，**必须上抛**。**必须**用 common 的 `isStaleCtxError`（上游内联正则）。
- **`tool_execution_end`**：仅本工具且非 error 才刷新 overlay。不在此 replay（branch stale）。
- **`agent_start`**：折叠上一轮完成的任务。

### 关键改动（adapt）

1. **删** 顶层动态 i18n import 块（`await import("@juicesharp/rpiv-i18n/loader")` + try/catch）——本 monorepo 无 i18n。
2. 内联 `isStaleCtxError` → `import { isStaleCtxError } from "@htwang-contrib/common"`。
3. **删** `import { I18N_NAMESPACE } from "./state/i18n-bridge.ts"`。

### 依赖

- `@earendil-works/pi-coding-agent`（ExtensionAPI）、`@htwang-contrib/common`（isStaleCtxError）、`todo.ts`、`todo-overlay.ts`、`state/replay.ts`、`state/store.ts`。

### 测试

- 无独立测试；由 `todo-overlay.lifecycle.test.ts` + 手测（`/reload` 后 replay 恢复）覆盖。

---

## 测试基础设施

### `test/helpers.ts`（新建）

替代 `@juicesharp/rpiv-test-utils`，提供：

- `createMockPi()`：捕获 `registerTool` / `registerCommand` / `on` 调用，返回 `{ tools, commands, events, pi }`。
- `createMockCtx(opts)`：`{ hasUI, ui, sessionManager: { getBranch() }, ... }`。
- `createMockUI()`：`{ setWidget, notify, ... }` 捕获调用。
- `identityTheme`：透传主题——`fg(_c, t)=t` / `bg(_c, t)=t` / `bold(t)=t` / `strikethrough(t)=t`，让快照测试不被 ANSI 污染。

### 测试矩阵（见 STEPS Phase 5）

| 文件                             | 难度 | 覆盖模块                                           |
| -------------------------------- | ---- | -------------------------------------------------- |
| `state-reducer.test.ts`          | ★☆☆  | state-reducer + invariants + task-graph            |
| `store.test.ts`                  | ★☆☆  | store                                              |
| `task-graph.test.ts`             | ★☆☆  | task-graph                                         |
| `response-envelope.test.ts`      | ★☆☆  | response-envelope                                  |
| `replay.test.ts`                 | ★★☆  | replay                                             |
| `config.test.ts`                 | ★☆☆  | config                                             |
| `todo.register.test.ts`          | ★★☆  | todo(tool) + types + view/format(render)           |
| `todo.command.test.ts`           | ★★☆  | todo(command) + selectors                          |
| `todo-overlay.render.test.ts`    | ★★★  | overlay + view/format(overlay) + selectors(layout) |
| `todo-overlay.lifecycle.test.ts` | ★★★  | overlay + index 生命周期                           |

### 不移植

- `state/i18n-bridge.*.test.ts`（无 i18n）。
- `locales/*.json`（无 i18n）。
- `ship-manifest.test.ts`（不发布 npm）。
- `todo.guidance.test.ts`（guidance 校验已简化为 `?? DEFAULT`，无独立校验逻辑可测；其 prompt 文案断言并入 `todo.register.test.ts`）。
