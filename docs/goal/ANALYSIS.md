# pi-goal 项目分析与移植可行性评估

## 1. pi-goal 是什么

[pi-goal](https://github.com/code-yeongyu/pi-goal) 是一个 pi-coding-agent 扩展，将 OpenAI **Codex** 的目标模式（goal mode）移植到 pi 生态。核心功能：

| 能力                 | 说明                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **持久化目标存储**   | 每个 session thread 持有一个 `Goal` 对象（id、objective、status、token/time 计量），以 JSON 文件存储在 session 目录下 |
| **用户命令 `/goal`** | `/goal <objective>` 设定、`/goal pause` 暂停、`/goal resume` 恢复、`/goal clear` 清除、无参查看                       |
| **Agent 工具**       | `create_goal`、`update_goal`（仅允许 `status: "complete"`）、`get_goal`                                               |
| **状态机**           | `active → paused / budgetLimited / complete`；token budget 达限时自动切为 `budgetLimited`                             |
| **自动续行 prompt**  | 当 goal 为 active 且 agent 空闲时，自动注入隐藏 continuation prompt 驱动 agent 继续工作                               |
| **TUI footer**       | 用 `ctx.ui.setFooter()` 渲染 Codex 风格三行 footer：工作目录行、token 统计行、goal 状态行                             |
| **SKILL.md**         | 提供完成审计规则（completion audit）指导 agent 在真正验证后才标记 goal 完成                                           |

## 2. 源码结构与关键实现

```
src/
  index.ts           ← 入口：注册工具、命令、事件
  goal/
    command.ts       ← /goal 命令解析（show / setObjective / setStatus / clear）
    continuation.ts  ← 判断是否需要注入续行 prompt
    errors.ts        ← 自定义错误类
    format.ts        ← token/time 格式化、JSON 工具响应
    prompt.ts        ← 构建 continuation prompt 和 budget-limited prompt
    store.ts         ← JSON 文件读写、goal CRUD、token/time 计量
    types.ts         ← Goal / GoalStatus / TokenUsageSnapshot 等类型
    ui.ts            ← TUI footer 组件（三行：cwd、stats、goal status）
    validation.ts    ← objective 长度校验（≤4000 字符）、token budget 正整数校验
```

### 2.1 生命周期事件

- **`session_start`**：读取已有 goal，若 active 则开始计时；若 resume + paused 则弹 select 让用户选择恢复
- **`agent_start`**：标记 `agentTurnInProgress = true`，重置 `completedThisTurnGoalId`
- **`agent_end`**：收集 assistant message usage → 累加到 goal 的 `tokensUsed`；若 active 且无 pending messages → 注入续行 prompt；若 `budgetLimited` → 注入 budget-limit prompt
- **`session_shutdown`**：结算当前 turn 的 token/time 计量

### 2.2 存储模型

- 每个 thread 一个 JSON 文件：`<baseDir>/<threadId>.json`
- baseDir 优先取 `ctx.sessionManager.getSessionDir()`，无 session 时回退到 `PI_CODING_AGENT_DIR/extensions/pi-goal/no-session/<cwd-hash>`
- 版本化 JSON（`version: 1`），goal 可为 `null`

### 2.3 续行 prompt 设计

续行 prompt 通过 `pi.sendMessage({ customType, content, display: false }, { triggerTurn: true, deliverAs: "followUp" })` 注入。关键设计：

- `display: false` → 不在聊天中显示
- `triggerTurn: true` → 触发新一轮 agent turn
- `deliverAs: "followUp"` → 作为 follow-up 消息投递
- objective 被 `<untrusted_objective>` XML 标签包裹，明确标注为非高优先级指令
- 包含详细的「完成审计」指令，要求 agent 在标记 complete 前逐条验证

## 3. 与 hawtian-pi-extensions 的对比

### 3.1 依赖差异

| 维度   | pi-goal                         | hawtian-pi-extensions                |
| ------ | ------------------------------- | ------------------------------------ |
| Pi SDK | `@mariozechner/pi-coding-agent` | `@earendil-works/pi-coding-agent`    |
| TUI 包 | `@mariozechner/pi-tui`          | `@earendil-works/pi-tui`             |
| Schema | `typebox`（直接依赖）           | `@sinclair/typebox`（pi 内置）       |
| 构建   | `tsgo` + `biome`                | 无构建步骤，`tsc --build` 仅类型检查 |
| 运行时 | Node ≥ 20                       | Node ≥ 20                            |

> `@mariozechner/pi-coding-agent` 与 `@earendil-works/pi-coding-agent` 是同一个 pi-coding-agent 的不同 npm scope（前者是 senpi fork，后者是上游）。API 接口基本一致，但 import 路径需要替换。

### 3.2 功能交集

| 能力                 | pi-goal                                 | 我们已有的                                                                                 |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Token 计量**       | goal 内置 `tokensUsed` + `tokenBudget`  | `packages/context-usage` 做全局 context 用量估算；`packages/statusline` 显示 ↑↓ token 统计 |
| **TUI footer**       | 自定义三行 footer（cwd + stats + goal） | `packages/statusline` 已有 footer（git + coding-plan + tokens）                            |
| **隐藏 prompt 注入** | `pi.sendMessage({ display: false })`    | 无直接等价物                                                                               |
| **Session 存储**     | JSON 文件 per thread                    | `packages/subagents` 用 `~/.agent/subagents/session` + JSONL                               |
| **命令系统**         | `pi.registerCommand("goal", ...)`       | 多个扩展均有命令注册                                                                       |
| **工具注册**         | `pi.registerTool(...)`                  | `packages/extra-tools`、`packages/subagents` 等均有工具注册                                |

### 3.3 我们独有的能力

- **Subagents**：进程内子代理编排（`createAgentSession`），pi-goal 没有
- **Protect-secrets**：`/run/agenix` 文件读取拦截，pi-goal 没有
- **Multi-provider**：`inference-self-host` + `zai-coding-plan` 多模型路由
- **User-input-history**：持久化历史 + Ctrl+R fuzzy search
- **Ask-user-question**：结构化交互工具 + 状态/视图层

## 4. 移植价值分析

### 4.1 解决的真实痛点

pi-goal 解决的核心问题是：**长任务中 agent 容易「忘记目标」或过早宣布完成**。通过：

1. **持久化 objective** → 跨 session 记忆目标
2. **自动续行** → agent 结束一轮后自动被驱动继续
3. **完成审计 prompt** → 强制 agent 逐条验证后才可标记完成
4. **Token budget** → 防止无限消耗

### 4.2 与 Subagents 的互补关系

| 维度     | Goal             | Subagent            |
| -------- | ---------------- | ------------------- |
| 粒度     | 会话级单目标     | 任务级多子任务      |
| 执行者   | 主 agent 自身    | 独立子 session      |
| 生命周期 | 跨 session 持久  | 工具调用内完成      |
| 适合场景 | "把这个功能做完" | "并行搜索 5 个文件" |

两者可以组合：设定一个 goal，然后用 subagents 并行推进各个子任务。

### 4.3 移植收益

- **长任务可靠性提升**：agent 不会「跑偏」或「假完成」
- **Token 预算控制**：对使用计费模型的用户有实际价值
- **Codex 体验对齐**：对从 Codex 迁移来的用户是熟悉的工作流

## 5. 移植方案建议

### 5.1 新建 `packages/goal/`

按照 monorepo 惯例，作为独立扩展包：

```
packages/goal/
  index.ts           ← 入口
  goal/
    command.ts       ← /goal 命令
    continuation.ts  ← 续行判断
    format.ts        ← 格式化
    prompt.ts        ← prompt 构建
    store.ts         ← JSON 存储
    types.ts         ← 类型
    ui.ts            ← footer 组件
    validation.ts    ← 校验
  package.json
  tsconfig.json
```

### 5.2 关键改动点

| 上游                            | 我们                                         | 改动                                                          |
| ------------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `@mariozechner/pi-coding-agent` | `@earendil-works/pi-coding-agent`            | 所有 import 路径替换                                          |
| `@mariozechner/pi-tui`          | `@earendil-works/pi-tui`                     | 所有 import 路径替换                                          |
| `typebox`（直接依赖）           | `@sinclair/typebox`（pi peerDep）            | import 改为 `@sinclair/typebox`                               |
| 独立 footer                     | `packages/statusline` 已占 footer            | **需要融合**：goal 状态行嵌入现有 footer，而非替换整个 footer |
| 独立 token 统计                 | `packages/statusline` 已有 `TokensComponent` | 复用现有统计，goal 仅增加 budget/usage 行                     |
| `pi.sendMessage`                | API 一致                                     | 直接使用                                                      |

### 5.3 Footer 融合策略

pi-goal 上游直接调用 `ctx.ui.setFooter()`，会**完全替换** pi 默认 footer。我们的 `packages/statusline` 也做了同样的事。两种融合方案：

**方案 A：goal 作为 statusline 的子组件（推荐）**

在 `packages/statusline/footer.ts` 的 `components` 数组中新增 `GoalComponent`，当 goal 存在时渲染一行 goal 状态。不需要 `packages/goal` 自己调用 `setFooter`。

- 优点：不冲突，goal 信息和 git/tokens 并列
- 缺点：`packages/goal` 需要导出状态供 statusline 消费（可通过 `pi.events` 或共享状态）

**方案 B：goal 独立 footer 行**

`packages/goal` 在 `setFooter` 之外用 `ctx.ui.setWidget` 或 `ctx.ui.setStatus` 渲染，避免抢占 footer。

- 优点：完全解耦
- 缺点：视觉上不如 footer 一体化

### 5.4 可复用的现有代码

| 来源                                       | 复用                                               |
| ------------------------------------------ | -------------------------------------------------- |
| `packages/common`                          | 格式化工具函数（如有 time/token 格式化需求可提取） |
| `packages/statusline/components/tokens.ts` | token 统计逻辑参考                                 |
| `packages/context-usage/context-usage.ts`  | context window 估算逻辑参考                        |
| `packages/subagents/settings.ts`           | JSON 配置文件读写模式参考                          |
| `packages/subagents/run-agent.ts`          | `ExtensionContext` 使用模式参考                    |

### 5.5 移植检查清单

按照 AGENTS.md 的「Porting upstream code」原则：

- [ ] 不直接复制上游代码，根据 monorepo 惯例重新实现
- [ ] 所有 import 使用 `@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-tui`
- [ ] TypeBox schema 使用 `@sinclair/typebox`
- [ ] 存储路径遵循我们的约定（参考 subagents 的 session 目录策略）
- [ ] Footer 渲染与 `packages/statusline` 融合而非替换
- [ ] 共享逻辑提取到 `packages/common`
- [ ] 工具名使用 `snake_case`，显示名使用 `CamelCase`
- [ ] 通过 `npm run format` 保持代码风格一致
- [ ] `npx tsc --build` 类型检查通过

## 6. 风险与注意事项

| 风险                     | 说明                                                             | 缓解                                                             |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Footer 冲突**          | 多个扩展都调用 `setFooter` 会互相覆盖                            | 融合到 statusline 或用 `setStatus`/`setWidget`                   |
| **续行 prompt 滥用**     | agent 可能陷入「续行 → 什么都不做 → 再续行」循环                 | pi-goal 已有 budget 限制；可增加 max continuation 计数           |
| **Stale ctx**            | session reload 后 ctx 失效                                       | 上游已用 try-catch + `STALE_EXTENSION_CONTEXT_ERROR_PREFIX` 处理 |
| **Peer dependency 版本** | pi-goal 依赖 `@mariozechner/*`，我们用 `@earendil-works/*`       | API 目前一致，但需在升级 pi 版本时验证                           |
| **存储路径差异**         | 上游 fallback 到 `PI_CODING_AGENT_DIR`，我们可能有自己的路径约定 | 统一使用 `ctx.sessionManager.getSessionDir()` 即可               |

## 7. 总结

pi-goal 是一个设计精良的 Codex 目标模式移植，核心价值在于**持久化目标 + 自动续行 + 完成审计 + token 预算控制**。移植到 hawtian-pi-extensions 的技术难度不高（主要是 import 路径替换和 footer 融合），收益明确——特别是对需要 agent 执行长任务、多步骤交付的用户场景。

建议优先级：**中高**。不依赖 subagents，可独立实现；但与 subagents 组合使用时效果更佳（goal 拆解为子任务，subagents 并行执行）。
