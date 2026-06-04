# Goal 扩展分步执行清单

本文与 [ANALYSIS.md](./ANALYSIS.md) 配套，按顺序执行。每一步都标注了对应设计文档中的章节，便于溯源。

---

## 总进度 TODO

完成某一 phase 后把 `[ ]` 改成 `[x]`。「阻塞 / 备注」写一行备忘。

| Phase | 目标                                                                                                                                                       | → ANALYSIS.md 章节             | 状态 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---- |
| 0     | API 验证：确认 `@earendil-works/pi-coding-agent` 导出 goal 所需的 `sendMessage`、`setFooter`、`setWidget`、`setStatus`、`select`、`getContextUsage` 等符号 | § 3.1 依赖差异                 | [x]  |
| 1     | 仓库骨架：`packages/goal` 目录、`package.json`、`tsconfig.json`、空扩展可加载、根 `tsconfig` reference                                                     | § 5.1 目录结构                 | [x]  |
| 2     | 核心类型与存储：`Goal` 类型、JSON 文件存储 CRUD、校验函数                                                                                                  | § 2.2 存储模型                 | [x]  |
| 3     | 命令注册：`/goal` 命令解析与处理（set / show / pause / resume / clear）                                                                                    | § 2.1 生命周期事件             | [x]  |
| 4     | Agent 工具注册：`create_goal`、`update_goal`、`get_goal`                                                                                                   | § 1 功能表 — Agent 工具        | [x]  |
| 5     | Token / time 计量：`agent_start` / `agent_end` / `session_shutdown` 事件中的 usage 收集与累加                                                              | § 2.1 生命周期事件 — agent_end | [x]  |
| 6     | 续行 prompt：`continuation.ts` + `prompt.ts`，`pi.sendMessage({ display: false })` 注入                                                                    | § 2.3 续行 prompt 设计         | [x]  |
| 7     | Footer 融合：goal 状态渲染与 `packages/statusline` 的集成                                                                                                  | § 5.3 Footer 融合策略          | [x]  |
| 8     | 收尾：README、AGENTS.md 链接、`tsc --build`、`npm run format`、发布检查                                                                                    | § 5.5 移植检查清单             | [x]  |

**当前停在哪一 phase：** 全部完成（Phase 0–8）

### API 验证结果（Phase 0）

- **@earendil-works/pi-coding-agent 版本**: latest（通过 `node_modules` 类型定义验证）
- **Step 0.1 sendMessage**: ✅ 齐全 — `sendMessage({ customType, content, display, details? }, { triggerTurn?, deliverAs? })` 签名完全匹配
- **Step 0.2 ctx.ui 方法**: ✅ 齐全 — `setFooter`, `setWidget`, `setStatus`, `select`, `notify`, `confirm`, `input`, `onTerminalInput` 均可用；`ctx.isIdle()`, `ctx.hasPendingMessages()`, `ctx.sessionManager.getSessionDir/Id`, `ctx.getContextUsage()`, `ctx.model`, `ctx.modelRegistry`, `ctx.hasUI` 全部存在
- **Step 0.3 事件 hook**: ✅ 齐全 — `session_start`（含 `reason`: `"startup"|"reload"|"new"|"resume"|"fork"`）、`agent_start`、`agent_end`（含 `messages`）、`session_shutdown` 均可注册
- **Step 0.4 pi.events**: ✅ 齐全 — `EventBus` 提供 `emit(channel, data)` 和 `on(channel, handler)` （返回 unsubscribe 函数）
- **结论**: 无缺失，所有 Phase 4–7 可直接使用

---

## Phase 0：API 验证

> **关联**：ANALYSIS.md § 3.1 依赖差异 — pi-goal 依赖 `@mariozechner/*`，我们使用 `@earendil-works/*`，需确认 API 对等。

### Step 0.1 — 确认 `sendMessage` 签名

在 `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts` 中确认 `ExtensionAPI.sendMessage` 的签名支持：

- 参数 `{ customType: string; content: string; display: boolean }`
- 选项 `{ triggerTurn?: boolean; deliverAs?: string }`

这直接决定续行 prompt 能否注入（ANALYSIS.md § 2.3）。

### Step 0.2 — 确认 `ExtensionContext` UI 方法

确认 `ExtensionContext` 上存在以下方法（TUI 渲染与交互依赖）：

| 方法                                 | 用途                      | → ANALYSIS.md         |
| ------------------------------------ | ------------------------- | --------------------- |
| `ctx.ui.setFooter(factory)`          | 渲染 footer               | § 5.3 Footer 融合策略 |
| `ctx.ui.setWidget(key, content)`     | below-editor widget       | § 5.3 方案 B          |
| `ctx.ui.setStatus(key, text)`        | 状态栏文本                | § 5.3 方案 B          |
| `ctx.ui.select(title, options)`      | 用户选择（resume prompt） | § 2.1 — session_start |
| `ctx.ui.notify(message, type)`       | 通知                      | § 2.1                 |
| `ctx.isIdle()`                       | 判断是否空闲              | § 2.3 续行判断        |
| `ctx.hasPendingMessages()`           | 判断是否有待处理消息      | § 2.3 续行判断        |
| `ctx.sessionManager.getSessionDir()` | 存储路径                  | § 2.2 存储模型        |
| `ctx.sessionManager.getSessionId()`  | thread ID                 | § 2.2 存储模型        |
| `ctx.getContextUsage()`              | context 用量              | § 3.2 — context-usage |
| `ctx.model` / `ctx.modelRegistry`    | 模型信息                  | § 3.1                 |
| `ctx.hasUI`                          | 是否有 TUI                | § 2.1                 |

### Step 0.3 — 确认事件 hook

确认 `pi.on(event, handler)` 支持以下事件（ANALYSIS.md § 2.1 生命周期）：

- `"session_start"` — payload 含 `reason` 字段（`"resume"` / `"startup"`）
- `"agent_start"`
- `"agent_end"` — payload 含 `messages` 数组
- `"session_shutdown"`

### Step 0.4 — 确认 `pi.events` 事件总线

确认 `pi.events.emit(event, data)` 和 `pi.events.on(event, handler)` 可用。Footer 融合方案 A 需要 goal 通过事件通知 statusline（ANALYSIS.md § 5.3 方案 A）。

### Step 0.5 — 记录验证结果

在本文件 Phase 0 标题下方新增「API 验证结果」小节，记录：

- `@earendil-works/pi-coding-agent` 版本号
- 各 Step 0.1–0.4 的结论（齐全 / 缺失 / 有差异）
- 若缺失：记录影响哪个 Phase，是否需要替代方案

---

## Phase 1：仓库骨架

> **关联**：ANALYSIS.md § 5.1 — 新建 `packages/goal/` 目录结构；§ 5.5 移植检查清单 — 「不直接复制上游代码，根据 monorepo 惯例重新实现」。

### Step 1.1 — 创建 `packages/goal/package.json`

- `name`: `"@htwang-contrib/goal"`
- `type`: `"module"`
- `peerDependencies`: `"@earendil-works/pi-coding-agent": "*"`、`"@earendil-works/pi-tui": "*"`、`"@sinclair/typebox": "*"`
- 参考 `packages/subagents/package.json` 的结构

### Step 1.2 — 创建 `packages/goal/tsconfig.json`

与现有 extension 包对齐（参考 `packages/context-usage/tsconfig.json`），`references` 中包含 `packages/common`（如需要）。

### Step 1.3 — 创建 `packages/goal/index.ts` 空入口

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  // Phase 2 起填充
}
```

### Step 1.4 — 注册到根 `tsconfig.json`

在根 `tsconfig.json` 的 `references` 数组中添加 `{ "path": "./packages/goal" }`。

### Step 1.5 — 类型检查

```bash
npx tsc --build
npm run format
```

确认零错误。此时 `packages/goal` 可被 pi 加载（`pi -e packages/goal/index.ts`）但不做任何事。

---

## Phase 2：核心类型与存储

> **关联**：ANALYSIS.md § 2.2 存储模型 — JSON 文件 per thread，版本化，goal 可为 null；§ 5.4 可复用的现有代码 — 参考 `packages/subagents/settings.ts` 的 JSON 读写模式。

### Step 2.1 — 定义类型 `goal/types.ts`

根据 ANALYSIS.md § 2.2 的存储模型，定义：

- `GoalStatus`：`"active" | "paused" | "budgetLimited" | "complete"`
- `Goal`：id、threadId、objective、status、tokenBudget?、tokensUsed、timeUsedSeconds、createdAt、updatedAt、lastStartedAt?、completedAt?
- `TokenUsageSnapshot`：input、output、cacheRead、cacheWrite、totalTokens
- `GoalStoreRef`：baseDir、threadId
- `GoalUpdate`：objective?、status?、tokenBudget?
- `GoalFile`：version（固定 1）、goal（`Goal | null`）

### Step 2.2 — 实现 `goal/store.ts`

- `goalFilePath(ref)` — 返回 `<baseDir>/<threadId>.json`（用 `encodeURIComponent`）
- `readGoal(ref)` — 读 JSON → 解析 → 返回 `Goal | null`；文件不存在返回 `null`
- `writeGoal(ref, goal)` — 写入版本化 JSON
- `createGoal(ref, objective, tokenBudget?)` — 校验 → 生成 UUID → 写入 → 返回 `Goal`
- `updateGoal(ref, update)` — 读 → 合并更新 → 状态机转换（pause/resume/complete/replace）→ 写入
- `clearGoal(ref)` — 写入 `{ version: 1, goal: null }`
- `accountGoalUsage(ref, usage, elapsedSeconds, mode)` — 累加 token/time → 自动触发 `budgetLimited`

### Step 2.3 — 实现 `goal/validation.ts`

- `validateObjective(value)` — trim + 非空 + ≤ 4000 字符（ANALYSIS.md § 2 源码结构 — validation.ts）
- `validateTokenBudget(value)` — 正整数或 undefined/null

### Step 2.4 — 实现 `goal/errors.ts`

自定义错误类：`GoalAlreadyExistsError`、`GoalNotFoundError`、`InvalidGoalStoreError`、`UnsupportedGoalStoreVersionError`。

### Step 2.5 — 实现 `goal/format.ts`

- `formatGoalElapsedSeconds` — 秒 → 可读时间（`1m`、`2h 30m`、`1d 3h`）
- `formatTokensCompact` — 数字 → 紧凑 token 显示（`1.2K`、`3M`）
- `formatGoalForTool` — goal → 多行文本摘要
- `formatGoalToolResponse` — goal → JSON 工具响应（含 remainingTokens、completionBudgetReport）

### Step 2.6 — 单元测试

为 `store.ts`、`validation.ts`、`format.ts` 编写 vitest 测试（参考上游 `test/` 目录覆盖的场景）。

### Step 2.7 — 类型检查 + format

```bash
npx tsc --build
npm run format
```

---

## Phase 3：命令注册

> **关联**：ANALYSIS.md § 1 功能表 — `/goal` 命令（set / show / pause / resume / clear）；§ 2.1 生命周期 — session_start 中的 resume 交互。

### Step 3.1 — 实现 `goal/command.ts`

解析 `/goal` 的 rawArgs 为 `ParsedGoalCommand` 联合类型：

- `{ kind: "show" }` — 无参数
- `{ kind: "setObjective"; objective: string }` — 非 pause/resume/clear 的任意文本
- `{ kind: "setStatus"; status: "paused" | "active" }` — pause / resume
- `{ kind: "clear" }` — clear

### Step 3.2 — 在 `index.ts` 中注册命令

```ts
pi.registerCommand("goal", {
  description: "Set, inspect, pause, resume, or clear the persistent goal",
  handler: async (rawArgs, ctx) => {
    /* switch on parsed command kind */
  },
});
```

各分支行为：

| kind                  | 行为                                                                    | → ANALYSIS.md         |
| --------------------- | ----------------------------------------------------------------------- | --------------------- |
| `show`                | 读 goal → `ctx.ui.notify`（无 goal 时显示用法提示）                     | § 1 — 用户命令        |
| `setObjective`        | 若已有 goal → `ctx.ui.select` 确认替换 → 创建或更新 → 开始计时 → notify | § 2.1 — session_start |
| `setStatus("paused")` | 结算当前 turn → 更新状态 → 停止计时 → notify                            | § 2.1                 |
| `setStatus("active")` | 更新状态 → 开始计时 → notify → 触发续行                                 | § 2.1                 |
| `clear`               | 结算 → 写 null → 清除 UI → notify                                       | § 1                   |

### Step 3.3 — 手测

```bash
pi -e packages/goal/index.ts
```

在 TUI 中执行 `/goal Test objective`、`/goal`、`/goal pause`、`/goal resume`、`/goal clear`，确认 notify 输出正确。

---

## Phase 4：Agent 工具注册

> **关联**：ANALYSIS.md § 1 功能表 — `create_goal`、`update_goal`、`get_goal`；§ 5.2 关键改动点 — TypeBox 使用 `@sinclair/typebox`；§ 5.5 移植检查清单 — 工具名 `snake_case`。

### Step 4.1 — 注册 `create_goal`

- 参数：`objective`（string，required）、`token_budget`（integer，optional）
- 行为：若已有 goal → 返回错误提示；否则创建 → 开始计时 → 更新 UI
- Description 应包含「仅在用户明确要求时创建，不要自行推断」的约束

### Step 4.2 — 注册 `update_goal`

- 参数：`status`（literal `"complete"`，required）
- 行为：结算当前 turn → 标记 complete → 更新 UI
- Description 应包含完成审计规则的简述（完整审计在续行 prompt 中）

### Step 4.3 — 注册 `get_goal`

- 参数：无（空 Object schema）
- 行为：读取 goal → 格式化为 JSON 工具响应 → 更新 UI

### Step 4.4 — 验证

`pi -e packages/goal/index.ts` 加载后，确认 `create_goal`、`update_goal`、`get_goal` 出现在模型可用工具列表中。

```bash
npx tsc --build
npm run format
```

---

## Phase 5：Token / Time 计量

> **关联**：ANALYSIS.md § 2.1 生命周期事件 — agent_start / agent_end / session_shutdown 中的 usage 收集；§ 1 功能表 — 状态机 budgetLimited 自动转换。

### Step 5.1 — 实现 `agentGoalAccounting` 内部状态

在 `index.ts` 中维护：

- `agentTurnInProgress: boolean` — 当前是否有 agent turn
- `agentGoalAccounting: { goalId: string; measuredFromMilliseconds: number } | null` — 计时起点
- `completedThisTurnGoalId: string | null` — 本 turn 已完成的 goal（避免再触发续行）

### Step 5.2 — 注册 `agent_start` 事件

- 置 `agentTurnInProgress = true`
- 重置 `completedThisTurnGoalId`
- 若 goal 为 active → 开始计时

### Step 5.3 — 注册 `agent_end` 事件

- 从 `event.messages` 中收集 `role: "assistant"` 的 usage（input + output = token delta）
- 调用 `accountGoalUsage` 累加 token + elapsed time
- 若累加后变为 `budgetLimited` → 注入 budget-limited prompt（Phase 6 实现）
- 若仍为 `active` 且无 pending messages → 注入续行 prompt（Phase 6 实现）
- 置 `agentTurnInProgress = false`

### Step 5.4 — 注册 `session_shutdown` 事件

- 若有活跃 accounting → 最终结算
- 清除 accounting 状态

### Step 5.5 — 注册 `session_start` 事件

- 读取已有 goal → 若 active 则恢复计时
- 若 resume + paused → 弹 `ctx.ui.select` 询问是否恢复（ANALYSIS.md § 2.1）
- 若 active 且空闲 → 触发续行 prompt

### Step 5.6 — 验证

手动创建 goal → 模拟几轮对话 → 检查 JSON 文件中 `tokensUsed` 和 `timeUsedSeconds` 递增。

---

## Phase 6：续行 Prompt

> **关联**：ANALYSIS.md § 2.3 续行 prompt 设计 — `pi.sendMessage` 参数、`<untrusted_objective>` XML 包裹、完成审计指令。

### Step 6.1 — 实现 `goal/continuation.ts`

- `shouldQueueGoalContinuationWhenIdle(goal, isIdle, hasPendingMessages)` — goal active + 空闲 + 无 pending
- `shouldQueueGoalContinuationAfterAgentEnd(goal, hasPendingMessages)` — goal active + 无 pending

### Step 6.2 — 实现 `goal/prompt.ts`

- `buildContinuationPrompt(goal)` — 构建续行 prompt 文本：
  - 说明「继续追求活跃目标」
  - `<untrusted_objective>` XML 包裹（XML 转义 objective）
  - 预算信息（已用 token / time、剩余 token）
  - 完成审计指令清单（逐条验证、不允许假完成）
- `buildBudgetLimitedPrompt(goal)` — 构建预算耗尽 prompt：
  - 标记为 budget_limited
  - 要求总结进度、列出剩余工作

### Step 6.3 — 在 index.ts 中实现 `queueHiddenGoalPrompt`

```ts
function queueHiddenGoalPrompt(
  pi: ExtensionAPI,
  customType: string,
  content: string,
): void {
  pi.sendMessage(
    { customType, content, display: false },
    { triggerTurn: true, deliverAs: "followUp" },
  );
}
```

### Step 6.4 — 在 Phase 5 的事件 hook 中接入

- `agent_end`：active → `queueHiddenGoalPrompt(pi, "pi-goal-continuation", buildContinuationPrompt(goal))`
- `agent_end`：budgetLimited → `queueHiddenGoalPrompt(pi, "pi-goal-budget-limit", buildBudgetLimitedPrompt(goal))`
- `session_start` + `setObjective` + `resume`：若条件满足 → 同上

### Step 6.5 — 验证

设定 goal → 等待 agent 空闲 → 确认 hidden prompt 被注入 → agent 自动开始新一轮工作。检查 `display: false` 确保不在聊天中显示。

---

## Phase 7：Footer 融合

> **关联**：ANALYSIS.md § 5.3 Footer 融合策略 — 方案 A（statusline 子组件）或方案 B（独立 widget）；§ 5.2 关键改动点 — 上游独立 footer vs 我们已有 statusline。

### Step 7.1 — 确定融合方案

在以下方案中选择其一（需记录决策）：

- **方案 A**：goal 通过 `pi.events` 发射状态变更 → `packages/statusline` 新增 `GoalComponent` 订阅 → 渲染一行 goal 状态
- **方案 B**：goal 用 `ctx.ui.setStatus("goal", text)` 渲染，不碰 footer

### Step 7.2 — 实现 `goal/ui.ts`

无论哪种方案，核心渲染逻辑相同：

- `goalFooterIndicator(goal)` — 根据状态返回文本 + 颜色：
  - active → `"Pursuing goal (Xm)"` (accent)
  - paused → `"Goal paused (/goal resume)"` (muted)
  - budgetLimited → `"Goal unmet (XK / XK tokens)"` (warning)
  - complete → `"Goal achieved (Xm)"` (success)
- `updateGoalUi(ctx, goal)` — 写入 UI（setWidget / setStatus / setFooter，取决于方案）

### Step 7.3 — 方案 A 实现（若选择）

1. 在 `packages/statusline/footer.ts` 的 `components` 数组中新增 `GoalComponent`
2. `GoalComponent` 订阅 `pi.events` 上的 `"goal:update"` 事件
3. `packages/goal` 在每次 goal 状态变化时 `pi.events.emit("goal:update", goal)`
4. 渲染逻辑：有 goal 时输出一行状态，无 goal 时不输出

### Step 7.4 — 方案 B 实现（若选择）

1. `updateGoalUi` 内调用 `ctx.ui.setStatus("goal", indicatorText)`
2. 清除时调用 `ctx.ui.setStatus("goal", undefined)`

### Step 7.5 — 验证

- 设定 goal → 观察 footer / 状态栏出现 goal 信息
- 暂停 / 恢复 / 完成 → 确认状态文本和颜色正确切换
- 清除 goal → 确认 goal 信息消失
- 不与 `packages/statusline` 已有信息冲突

```bash
npx tsc --build
npm run format
```

---

## Phase 8：收尾

> **关联**：ANALYSIS.md § 5.5 移植检查清单 — 所有条目逐一验证。

### Step 8.1 — 编写 `packages/goal/README.md`

包含：

- 功能简介
- 命令列表（`/goal` 用法）
- Agent 工具列表（`create_goal`、`update_goal`、`get_goal`）
- 依赖的 pi-coding-agent 最低版本
- 存储路径说明
- 链接到 `docs/goal/ANALYSIS.md`

### Step 8.2 — 更新根 `AGENTS.md`

在 `packages/` 列表中新增 `packages/goal/` 条目，写明功能摘要。

### Step 8.3 — 移植检查清单逐项验证

对照 ANALYSIS.md § 5.5：

- [ ] 不直接复制上游代码，根据 monorepo 惯例重新实现
- [ ] 所有 import 使用 `@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-tui`
- [ ] TypeBox schema 使用 `@sinclair/typebox`
- [ ] 存储路径遵循 session 目录约定
- [ ] Footer 渲染与 `packages/statusline` 融合而非替换
- [ ] 共享逻辑已提取到 `packages/common`（如有）
- [ ] 工具名使用 `snake_case`，显示名使用 `CamelCase`
- [ ] 通过 `npm run format` 保持代码风格一致
- [ ] `npx tsc --build` 类型检查通过

### Step 8.4 — 最终验证

```bash
npx tsc --build
npm run format
npm test
```

确认零错误、零格式问题、所有测试通过。

### Step 8.5 — 更新本文件 TODO 表

将 Phase 0–8 状态全部更新为 `[x]`，填写完成日期。
