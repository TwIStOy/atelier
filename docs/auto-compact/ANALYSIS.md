# pi-auto-compact 上游分析

> 源码：<https://github.com/capyup/pi-auto-compact/blob/main/extensions/auto-compact.ts>

## 一句话总结

在 Pi 默认的 compaction 触发时机（`agent_end` 之后）**之前**插入检查点，实现"预防性"上下文窗口管理，避免 LLM 请求因 token 溢出而报错。

---

## 核心问题

Pi 内置的自动 compaction 只在 **`agent_end`**（整个 agent 循环结束后）才检查 token 用量。但一个 agent 循环可能包含多轮 tool call：

```
用户输入 → LLM → tool_1 → LLM → tool_2 → LLM → ... → agent_end
              ↑                                           ↑
          可能已超限                                   Pi 在这里才检查
```

如果上下文在中间就爆了，LLM 请求会直接报错。这个扩展就是解决这个时序缺口。

---

## 架构设计

### 四个检查点

| 检查点 | Pi 事件 | 触发条件 | 作用 |
|--------|---------|----------|------|
| **Pre-turn** | `turn_start` | token ≥ threshold | 每轮开始前检查，防止超限请求发出 |
| **Mid-turn** | `turn_end` | token ≥ threshold **且** assistant 有 tool_use | 工具执行后、下一轮 LLM 调用前拦截 |
| **Emergency** | `context` | token > threshold（同步截断） | 最后防线，直接修改发送给 LLM 的 messages 数组 |
| **Session resume** | `session_start` | resume/fork 时 token ≥ threshold | 恢复旧会话时如果已经超限就立刻 compact |

### 紧急截断流程（`context` 事件）

`context` 事件在每次发送 LLM 请求前触发，handler 可以返回 `{ messages: [...] }` 来替换即将发送的消息数组。这是唯一的**同步拦截点**——不依赖异步的 `ctx.compact()`。

紧急截断的步骤：
1. 用 `estimateTotalTokens()` 估算当前 messages 总 token
2. 如果超过阈值，按策略裁剪 messages
3. 在裁剪位置插入一条 `[Context compacted: ...]` 的 user 消息作为通知
4. 返回新的 messages 数组

### 触发 Compact 后的恢复机制

`ctx.compact()` 调用后 Pi 内部会中止当前 agent 流。compact 完成后 agent 进入 idle 状态，但没有任何东西驱动它继续工作。所以扩展需要发送一条 follow-up 用户消息来"踢一脚"。

关键设计：
- 只在 **自己触发的** compact 的 `onComplete` 回调里发送 follow-up（用户手动 `/compact` 不会走这个路径）
- 使用 `setImmediate()` 延迟发送，避免与 Pi 内部的 `compactionQueuedMessages` 刷新竞争
- 发送前检查 `ctx.isIdle()`——如果用户已经在 compact 期间输入了内容，就不发 follow-up

---

## 三种裁剪策略

### keep-recent（默认）

保留最近 N tokens 的消息，删除更早的。

```
[旧消息 ...] | ← 裁剪线 → | [最近 ~15% 的消息]
  全部删除                      保留
```

- 从 messages 数组末尾向前累计 token，直到达到 `keepRecentPercent` 预算
- 裁剪线 snap 到最近一条 `role === "user"` 的消息边界（避免拆散 tool-call / tool-result 对）

### keep-bookends

保留头部和尾部，压缩中间。

```
[最旧 ~7.5%] | ← 删除中间 → | [最新 ~7.5%]
   保留          替换为通知        保留
```

- 将 `keepRecentPercent` 预算平分给头部和尾部
- 适用于项目初始化指令等早期上下文很有价值的场景

### summarize-all

只保留最后一条 user 消息，其他全部替换为通知。

```
[全部历史] → [截断通知] + [最后一条 user 消息]
```

- 最激进，上下文 footprint 最小
- 丢失所有精确措辞

---

## 配置系统

### 可配项

| 配置项 | 默认值 | 含义 |
|--------|--------|------|
| `autoCompactPercent` | 90 | 达到 context window 的百分之几时触发 compact |
| `autoCompactTokenLimit` | 0 | 固定 token 阈值（当 percent = 0 时使用） |
| `keepRecentPercent` | 15 | 保留最近消息占 context window 的百分比 |
| `strategy` | keep-recent | 裁剪策略 |

### 持久化

上游使用 `getAgentDir()` + 手动 JSON 读写。本 monorepo 适配后改为使用 `@htwang-contrib/common` 的 `readConfig` / `registerConfigItems`：
- 配置通过 `registerConfigItems("auto-compact", [...])` 声明式注册
- 持久化自动走 `~/.config/pi/extensions.json`
- 用户通过 `/config` 命令统一管理所有扩展配置

### `/auto-compact` 命令

上游提供了交互式设置菜单和 status/settings/reset 子命令。适配后简化为只保留 `status` 显示功能，配置修改统一走 `/config`。

---

## 状态管理

扩展内部维护几个关键状态：

- `pendingCompaction`：是否有 compact 正在进行中（防止重复触发）
- `lastEstimatedTokens`：最近一次估算的 token 数（`context` 事件更新）
- `truncationAppliedThisTurn`：当前 turn 是否已做过紧急截断
- 缓存三元组：`cachedContextWindow`、`cachedAutoCompactLimit`、`cachedKeepRecentTokens`（避免每次重新计算）

缓存在以下时机更新：
- `model_select` 事件（模型切换）
- `context` 事件（每次 LLM 调用前）
- `getContextUsage()` 返回了 contextWindow 信息时

---

## Token 估算

直接复用 Pi 内置的 `estimateTokens()` 函数，对单条 `AgentMessage` 估算 token 数。总 token = 逐条累加。

---

## 对比 Pi 默认行为

| 维度 | Pi 默认 | auto-compact 扩展 |
|------|---------|-------------------|
| 检查时机 | `agent_end` 之后 | turn 前 + turn 后 tool 间 + 紧急同步截断 |
| 溢出保护 | 无 | emergency 截断（同步修改 messages） |
| 多工具轮次 | 不覆盖 | mid-turn 检查 |
| 自动恢复 | 无 | compact 完成后发 follow-up |
| 策略选择 | 无 | 三种策略可选 |
| session resume | 不检查 | 恢复时检查并 compact |

---

## 适配本 monorepo 的关键改动

1. **包结构**：放入 `packages/auto-compact/`，遵循 `@htwang-contrib/auto-compact` 命名
2. **ESM + .ts 导入**：所有 import 路径加 `.ts` 后缀
3. **peerDependencies**：`@earendil-works/pi-coding-agent` 放 `devDependencies`
4. **复用 common**：配置持久化和 UI 注册使用 `@htwang-contrib/common` 的 `readConfig` / `registerConfigItems`，集成到 `/config` 统一管理
5. **注册到根 package.json**：`pi.extensions` 数组 + `tsconfig.json` references
6. **类型安全**：`AgentMessage` 从 `@earendil-works/pi-agent-core` 导入；通知类型用 `"info"` 替代不存在的 `"success"`；`AutocompleteItem` 同时提供 `value` 和 `label`
7. **安装防护**：`Symbol.for` 防止扩展被重复注册
8. **移除自定义设置菜单**：上游的 `/auto-compact settings` 交互式菜单被移除，改为通过 `registerConfigItems` 声明式注册，用户通过 `/config` 统一管理
