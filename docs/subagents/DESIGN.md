# Subagents 设计文档

本文记录 Pi 生态调研、**第三方扩展源码审计结论**、与 hawtian-pi-extensions 的衔接、产品取舍及推荐技术路线，供实现与评审使用。

---

## 1. 背景与目标

### 1.1 Pi 官方立场

Pi 刻意不把 subagents 做进核心：默认仅少量工具，通过 **Extensions（TypeScript）**、**Skills**、**Prompts** 与 **Pi packages** 扩展。官方 README 明确写：可用扩展自研，或 `pi install` 安装社区包实现子代理、计划模式等。

### 1.2 本仓库（hawtian-pi-extensions）中的目标

在 **不 fork Pi 核心** 的前提下，用自有扩展提供「主会话发起子任务」的能力，并与现有包（如 `protect-secrets`、`inference-self-host`、`zai-coding-plan`、statusline / `pi.events`）在行为与运维上可对齐。

### 1.3 已定产品范围（约束）

| 项                         | 决策                                                                              |
| -------------------------- | --------------------------------------------------------------------------------- |
| 编排拓扑                   | **仅主对话**可发起 subagent；**多个 subagent 之间不通信**、不互相委派。           |
| 并发                       | 支持 **多个 subagent 并行**（需上限与取消策略）。                                 |
| 执行形态                   | 支持 **前台**（阻塞至完成、可流式进度）与 **后台**（立即返回任务 id，异步完成）。 |
| 进程模型                   | **不要**再起一个 `pi` OS 子进程（避免冷启动与双 harness 重量）。                  |
| 链式 / orchestrator / pool | **当前阶段不考虑**；不实现子代理间发消息。                                        |

---

## 2. 生态调研与源码审计

### 2.1 审计方法

对下列仓库做 **shallow clone** 后阅读入口、`runner` / `execution`、`tool` 注册与进程相关调用（审计日期以修订记录为准）。结论以 **实际 import 与 `spawn` / `createAgentSession` 调用** 为准，README 为辅。

| 仓库 / 包                                                             | 审计路径（克隆后）                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| nicobailon / **pi-subagents**                                         | `src/runs/foreground/execution.ts`、`pi-args.ts`、`subagent-executor.ts` |
| espennilsen/pi / **extensions/pi-subagent**（npm `@e9n/pi-subagent`） | `src/runner.ts`、`src/tool.ts`、`src/index.ts`                           |
| **mjakl/pi-subagent**                                                 | `runner.ts`、`index.ts`                                                  |
| **gee666/pi-subagent**                                                | `index.ts`、`runner.ts`                                                  |
| **tintinweb/pi-subagents**                                            | `src/agent-runner.ts`、`src/index.ts`、`src/cross-extension-rpc.ts`      |

### 2.2 代表方案对比（源码级结论）

| 方案                        | 执行模型（源码证据）                                                                                                                                                                                                                                           | 并行 / 后台要点                                                                                                                                        | 与本文「不要子进程」的关系                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **pi-subagents**            | **`child_process.spawn`** + `getPiSpawnCommand` / `buildPiArgs` 拼出 `pi` CLI（`--mode json` 等）。见 `src/runs/foreground/execution.ts`、`src/runs/shared/pi-args.ts`。                                                                                       | 体量极大：`async-execution`、链、worktree、嵌套 fanout、intercom、fork 上下文、模型回退等；并行用 `mapConcurrent` 等。                                 | **冲突** — 核心路径是子进程。                                                                            |
| **@e9n/pi-subagent**        | **`spawn("pi", args, …)`**，`args` 含 `--mode json -p --no-session -ne`，可选 `-e` 白名单扩展。见 `extensions/pi-subagent/src/runner.ts` `runIsolatedAgent`。                                                                                                  | `tool.ts`：`mapConcurrent` 并行；chain / orchestrator / pool 等模式；`before_agent_start` 注入 agent 列表。                                            | **冲突**                                                                                                 |
| **@mjakl/pi-subagent**      | **`spawn`**，`buildPiArgs` 中 `spawn` 用 `--no-session` 或 `--session` + 临时 jsonl（fork）。继承父进程部分 CLI。见 `runner.ts` `runAgent`。                                                                                                                   | `mapConcurrent` + `MAX_CONCURRENCY`；`spawn`/`fork` 模式；`PI_SUBAGENT_DEPTH` 等 env 传子进程；项目 agent `ctx.ui.confirm`。                           | **冲突**                                                                                                 |
| **gee666/pi-subagent**      | **`runAgentSubprocess` / `executeParallelSubprocess`**（命名即子进程）。入口 `index.ts` 明确写 isolated `pi` processes。                                                                                                                                       | `tasks` 数组单任务或多任务并行；resume / session 子目录逻辑在 `resume.ts` 等。                                                                         | **冲突**                                                                                                 |
| **@tintinweb/pi-subagents** | **进程内**：`import { createAgentSession, SessionManager, DefaultResourceLoader, … } from "@earendil-works/pi-coding-agent"`，`createAgentSession(sessionOpts)` → `session.bindExtensions` → **`session.prompt(effectivePrompt)`**。见 `src/agent-runner.ts`。 | `index.ts` 注册 `Agent`、`get_subagent_result`、`steer_subagent`；`SubagentScheduler`；`cross-extension-rpc.ts` 通过 **`pi.events`** 暴露 spawn/stop。 | **一致** — 这是五者中唯一在默认路径上 **不 spawn `pi`**、而用 **官方 `createAgentSession` API** 的实现。 |

**重要更正**：初版文档仅凭 README 推断 **@tintinweb/pi-subagents** 为「子进程 + 事件」，与源码不符；该包子 agent 运行在 **同一 Node 进程** 内的独立 `AgentSession` 上。

### 2.3 各实现的可借鉴点（与进程模型解耦）

| 来源                 | 可借鉴点（不意味着照搬子进程）                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **pi-subagents**     | 配额、嵌套深度 env、fork 上下文过滤思想、异步 job tracker、结果截断与 artifact、与 TUI widget 的集成方式；若自研不走子进程，仅吸收 **产品与 UX 层** 需求，执行层换 `AgentSession`。                                                                                            |
| **@e9n/pi-subagent** | 单工具多参数形态、并发上限 `mapConcurrent`、`subagent:start` / `subagent:complete` **事件**、`-ne` + 扩展白名单的「缩小攻击面」语义（在 `DefaultResourceLoader` 层用等价配置实现）。                                                                                           |
| **@mjakl**           | **spawn vs fork** 的产品语义可映射为：`inherit_context: false` vs 父上下文摘要注入（tintinweb 已用 `buildParentContext` + `inheritContext`）；深度 / 环检测可映射为「子 session 禁止再调委派工具」。                                                                           |
| **gee666**           | 未完成 tool call 的 **resume** 思路、并行任务形状（`tasks` 数组）；持久化若需要可参考其 session 目录策略（仍可在进程内 session 上实现）。                                                                                                                                      |
| **@tintinweb**       | **首选技术参考**：`createAgentSession` + `SessionManager.inMemory` + `DefaultResourceLoader`（`noExtensions` / `extensionsOverride` / `noSkills` / `systemPromptOverride`）+ `allowedTools` 精确裁剪；`maxTurns` + steer + abort；`registerRpcHandlers` 跨扩展 spawn（可选）。 |

### 2.4 调研结论（可复用的「思想」）

1. **并发与配额**：`max_concurrent`、`max_total`、超时与取消（`AbortSignal` → `session.abort()`）是共性需求。
2. **隔离**：子侧缩小扩展与工具白名单（tintinweb：`extensions:` 与 `ext:` 分工、`EXCLUDED_TOOL_NAMES` 去掉 `Agent` 等）。
3. **可观测**：事件总线、`onUpdate` 流式、notify（e9n / pi-subagents / tintinweb 均有不同形态）。
4. **安全**：子 session 不注册委派工具；bash 仍走 Pi 工具管线以便 **protect-secrets** 等扩展在同一进程内生效。
5. **输出**：统一 **截断**（仓库规范：`truncateHead` 等）。

---

## 3. 技术路线取舍：为何不做子进程，如何做

### 3.1 子进程方案在四款主流扩展中的地位

**pi-subagents、@e9n/pi-subagent、@mjakl/pi-subagent、gee666/pi-subagent** 的默认执行路径均为 **`pi` 子进程**（或 `node` + `cli.js` 等价于再启 harness）。优点是与桌面 Pi 行为一致、隔离强。缺点：**启动与 JSON 管线开销大**，与本文 **明确排除** 的约束冲突。

### 3.2 本文选定：单进程内子任务（与 tintinweb 对齐）

在同一 Pi 进程内使用 **`@earendil-works/pi-coding-agent` 导出的 `createAgentSession`**（及 `AgentSession`、`DefaultResourceLoader`、`SessionManager`）驱动子任务。该 API 已在 **@tintinweb/pi-subagents** 的 `src/agent-runner.ts` 中完整走通，包括：

- 独立 **in-memory** `SessionManager`；
- `resourceLoader.reload()` 后 **`session.bindExtensions`**；
- **`session.prompt()`** 驱动多轮工具循环；
- **`session.subscribe`** 获取流式文本与 tool 事件；
- **`forwardAbortSignal`** 将父 `AbortSignal` 映射到 `session.abort()`。

| 路线                                | 说明                                                                                                                                                      | 优点                                                                     | 缺点 / 风险                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **A（主推荐）`createAgentSession`** | 与 **@tintinweb/pi-subagents** 相同技术栈；工具 `execute` 内持有 `ExtensionContext`（`ctx.modelRegistry` 等），可直接构造 `sessionOpts`。                 | 与 Pi 内置工具、流式、扩展、`protect-secrets` 行为一致；无第二 OS 进程。 | 需确认当前 monorepo 依赖的 **`@earendil-works/pi-coding-agent` 版本** 是否 **导出**上述符号（见开放问题）。 |
| **B（备选）slash `ctx.newSession`** | 仅当团队希望「子树挂在主 SessionManager」而非 in-memory 时再评估；`api_reference.md` 中 `newSession` 出现在 **ExtensionCommandContext**，工具侧未必可用。 | 若存在且符合产品，可与主会话树统一持久化。                               | 工具上下文 API 可能不完整；与 tintinweb 模型不一致。                                                        |
| **C（最后手段）自研 HTTP tool 环**  | 不用 Pi agent 内核，自管 `fetch` + messages。                                                                                                             | 无依赖 `createAgentSession`。                                            | 与 Pi 行为漂移；**protect-secrets** 需重复接入；维护成本高。                                                |

**取舍结论**：以 **路线 A（`createAgentSession`）** 为默认实现路径；版本导出缺失时再评估 B 或 C。

---

## 4. 推荐架构（单进程，对齐 tintinweb 子集）

### 4.1 组件划分（建议新包 `packages/subagents/` 或等价）

- **执行器**：封装 `runInProcessAgent(ctx, { prompt, model, thinking, isolated, inheritContext, maxTurns, signal })` → 内部 `createAgentSession` + `session.prompt` + 收集 `responseText` / usage。
- **调度器**：多任务 **`Promise.all` + 并发槽**；后台任务 **`void` + 内存表 + id**（可参考 tintinweb 的 `AgentManager` / scheduler 形状，但可删减为最小）。
- **策略**：子 session 的 **`allowedTools` 不包含** 自研委派工具名，保证 **仅主会话** 可发起委派（与 tintinweb `EXCLUDED_TOOL_NAMES` 同思路）。
- **可观测**：`pi.events.emit`（与 `zai-coding-plan` / statusline 一致）、`ctx.ui.notify`。

### 4.2 工具面（示意）

单一主工具（`snake_case`），例如 `delegate_agent` 或 `subagent`：

- **前台**：`await runInProcessAgent(...)`，`onUpdate` 映射自 `session.subscribe` 的文本 delta 或阶段性摘要。
- **后台**：立即返回 `{ id, status: "running" }`；提供第二工具 **`subagent_status`** 或等价查询（对齐 tintinweb 的 `get_subagent_result` 思想）。
- **并行**：`tasks[]` + 并发上限；失败策略写入 description。

### 4.3 与 monorepo 的衔接

| 包 / 机制                                 | 衔接方式                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@htwang-contrib/common`                  | 截断与格式化复用。                                                                                                                     |
| `protect-secrets`                         | 子 session 经 `bindExtensions` 加载同一扩展集时，**bash 工具事件与主会话同源**；若 `isolated: true` 则评估是否仍加载 protect-secrets。 |
| `inference-self-host` / `zai-coding-plan` | `sessionOpts.model` / `ctx.modelRegistry` 与父会话一致或可配置覆盖。                                                                   |
| `pi.events`                               | 任务生命周期事件；可选实现 tintinweb 式 RPC（低优先级）。                                                                              |

---

## 5. 安全与非目标

### 5.1 安全

- 并发与超时上限；`session.abort()` 响应父级 `signal`。
- 子 session **默认 `isolated` 或等价缩小扩展**；工具白名单明确。
- 不向子上下文注入「如何再 spawn 其他 subagent」的冗长说明（默认从 allowedTools 层面禁止即可）。

### 5.2 非目标（当前文档版本）

- subagent 之间消息传递、orchestrator 树、pool 长驻会话。
- 再起一个 `pi` / `cli.js` **子进程**作为子 agent 实现。
- 与 **pi-subagents** 或 **@e9n** 行为字节级兼容。

---

## 6. 风险与开放问题

1. **导出与版本**（已在 `STEPS.md` 阶段 0 记录）：`0.76.0` 的 `dist/index.d.ts` **已导出** `createAgentSession`、`DefaultResourceLoader`、`SessionManager`（含 `inMemory`）、`SettingsManager`、`getAgentDir` 等；后续若升级依赖应重新跑一次阶段 0 核查。
2. **内存与成本**：每个子 session 持有独立 `SessionManager.inMemory`；高并行时注意模型调用次数与 RAM。
3. **后台持久化**：进程崩溃任务表丢失；是否写入主会话 `appendEntry` 由产品决定。
4. **路线 C**：仅当 A 不可行时启用，并在文档与代码中醒目标注维护负担。

---

## 7. 文档与代码索引

| 文档             | 路径                                                           |
| ---------------- | -------------------------------------------------------------- |
| 分步执行清单     | [STEPS.md](./STEPS.md)                                         |
| Pi 扩展 API 速查 | `.agents/skills/pi-self-extension/references/api_reference.md` |
| 扩展规范         | `.agents/skills/pi-self-extension/SKILL.md`                    |

---

## 8. 修订记录

| 日期       | 说明                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------- |
| 2026-06-01 | 初版：调研、约束、单进程双路线、与仓库集成                                                   |
| 2026-06-01 | **源码审计**：五款扩展仓库克隆阅读；修正 @tintinweb 进程模型；推荐 `createAgentSession` 路线 |
| 2026-06-01 | `STEPS.md` 增加总进度 TODO；阶段 0 对 `node_modules` 做导出核对（0.76.0）                    |
