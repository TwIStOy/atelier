# Subagents 分步执行清单

本文与 [DESIGN.md](./DESIGN.md) 配套，按顺序执行。设计已基于第三方扩展 **源码审计** 更新：默认技术路径为 **`createAgentSession` 进程内子会话**（与 **@tintinweb/pi-subagents** 的 `src/agent-runner.ts` 一致），**不**使用 `spawn("pi", …)`。

---

## 总进度 TODO（compact / 新会话续作时用）

在继续实现前，把下面 **整段复制到新会话** 或钉在笔记里；完成某一 phase 后把 `[ ]` 改成 `[x]`，并在「阻塞 / 决定」写一行备忘。

| Phase | 目标                                                                                    | 状态 |
| ----- | --------------------------------------------------------------------------------------- | ---- |
| 0     | API 与版本锁定：`npm install`、`dist/index.d.ts` 导出核查、本文件「API 验证结果」已填写 | [x]  |
| 1     | 仓库骨架：`packages/subagents`、`tsconfig` reference、空扩展可加载、`tsc --build`       | [x]  |
| 2     | 单任务前台：`runSubAgent` + `registerTool`、`pi -e` 手测                          | [x]  |
| 3     | 并行：`tasks[]`、并发槽、失败策略                                                       | [x]  |
| 4     | 后台：`background`、`subagent_status`、`pi.events`                                      | [x]  |
| 5     | 策略与运维：settings、子 session 禁止委派工具、README、AGENTS 链接                      | [ ]  |
| 6     | 可选：statusline、`protect-secrets` 说明、RPC                                           | [ ]  |

**当前停在哪一 phase：** Phase 4 已完成（`background`、`subagent_status`、`subagent:complete` + `ctx.ui.notify`）；确认后再进行 Phase 5（策略与运维细化）。

---

## API 验证结果（阶段 0）

- **日期**：2026-06-01
- **`@earendil-works/pi-coding-agent` 版本**：`0.76.0`（以 `node_modules/@earendil-works/pi-coding-agent/package.json` 为准）
- **核查方式**：阅读 `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts` 与 `dist/core/session-manager.d.ts`
- **`createAgentSession` 等导出**：**有** — `index.d.ts` 导出 `createAgentSession`、`DefaultResourceLoader`、`SessionManager`、`SettingsManager`、`getAgentDir`、`AgentSession`（类型）等。
- **`SessionManager.inMemory`**：**有** — `session-manager.d.ts` 声明 `static inMemory(cwd?: string): SessionManager`。
- **结论**：阶段 2 起按 [DESIGN.md](./DESIGN.md) **路线 A**（`createAgentSession` + in-memory `SessionManager`）实现；无需因导出缺失降级到路线 C。

**环境备忘**：`packages/common/package.json` 曾使用无效的 `"@earendil-works/pi-coding-agent": "workspace:*"`，已改为 `"latest"` 以便根目录 `npm install` 成功；若你本地仍失败，先 `npm install` 再核对此项。

---

## 阶段 0：API 与版本锁定

### Step 0.1

在开发机 `npm install`，确保存在 `node_modules/@earendil-works/pi-coding-agent`。

### Step 0.2（主路径 — 与 tintinweb 对齐）

在该包入口或 `.d.ts` 中确认是否 **导出**以下符号（名称以实际导出为准）：

- `createAgentSession`
- `AgentSession`（类型即可）
- `SessionManager`（至少需 `SessionManager.inMemory` 或等价工厂）
- `DefaultResourceLoader`
- `getAgentDir`、`SettingsManager`（若沿用 tintinweb 的 loader 构造方式）

**参考阅读**（不必 vendoring 代码）：克隆 [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) 后精读 `src/agent-runner.ts` 中 `runAgent` 从 `loader.reload()` 到 `session.prompt` 的整段。

### Step 0.3（备选路径）

若 Step 0.2 **缺失关键导出**：再检索 `newSession`、`ExtensionCommandContext`（slash command 的 `ctx.newSession`），评估是否仅能通过 slash 触发子会话；记录结论。

### Step 0.4

在本文件顶部新增 **「API 验证结果」** 小节（或附录到 DESIGN 第 6 节）：

- **导出齐全** → 阶段 2 起实现 **createAgentSession** 路径。
- **不齐全** → 记下 `@earendil-works/pi-coding-agent` 精确版本；评估升级依赖或走 DESIGN **路线 C**（自研 HTTP 环），并建 issue 跟踪上游导出。

---

## 阶段 1：仓库骨架

### Step 1.1

在 `packages/` 下新建包目录（建议名 `subagents`），包含：

- `package.json`（`name`、`type: "module"`、依赖 `@earendil-works/pi-coding-agent`、`typebox`、workspace 对 `@htwang-contrib/common` 的引用按现有包对齐）
- `tsconfig.json`（与现有 extension 包一致）
- `index.ts` 导出入口：`export default function (pi: ExtensionAPI) { ... }`

### Step 1.2

在根 `tsconfig.json` 的 `references` 中加入新包（若根使用 project references）。

### Step 1.3

运行 `npx tsc --build`，修复引用与类型错误。

### Step 1.4

运行 `npm run format`（若将 `docs/` 纳入 format script，一并执行）。

---

## 阶段 2：最小可运行 — 单任务前台（createAgentSession）

### Step 2.1

实现 `runSubAgent(ctx, options)`（名称自定），核心步骤对齐 tintinweb：

1. `new DefaultResourceLoader({ cwd, agentDir, noExtensions / extensionsOverride, noSkills, systemPromptOverride, … })` → `await loader.reload()`。
2. 计算 **`allowedTools`**（内置 + 可选扩展工具名，**排除**自研委派工具名）。
3. `createAgentSession({ cwd, agentDir, sessionManager: SessionManager.inMemory(cwd), settingsManager, modelRegistry: ctx.modelRegistry, model, tools: allowedTools, resourceLoader: loader })`。
4. `await session.bindExtensions({ onError })`。
5. `session.subscribe(…)` 连接 `onUpdate` / 用量累计（可选）。
6. `await session.prompt(effectivePrompt)`，`forwardAbortSignal(session, signal)`。
7. 返回最后 assistant 文本 + usage；对返回主会话的文本做 **截断**（`truncateHead` 等）。

### Step 2.2

注册单一工具（如 `subagent`），参数至少：`task`（string）；可选 `model`、`thinking`、`inherit_context`、`isolated`、`max_turns`。

### Step 2.3

`pi -e <path/to/index.ts>` 手动验证：只读任务（例如总结某文件）能完成且主会话收到 tool result。

### Step 2.4

在包内 `README.md` 写清：依赖的 pi-coding-agent 版本下限、与 [DESIGN.md](./DESIGN.md) 的链接。

---

## 阶段 3：并行

### Step 3.1

工具参数支持 `tasks: Array<{ task: string; … }>`，与单任务 **互斥**（与 mjakl / e9n 的「单 shape」校验思想一致）。

### Step 3.2

对每个任务调用 `runSubAgent`，外层使用 **并发槽**（如 `async` + 队列，或 `mapConcurrent` 自写），默认上限从 settings 读取（建议默认 4，总任务数上限 8）。

### Step 3.3

定义部分失败时的返回格式（汇总每子任务 exit / error 文本），并写入工具 **description**。

### Step 3.4

`npm run format`；手动跑 2～3 个并行只读任务验证无死锁、无全局单例冲突。

---

## 阶段 4：后台

### Step 4.1

工具参数增加 `background: boolean`（默认 `false`）。

### Step 4.2

`background: true` 时：生成 `id`，`void runSubAgent(...).then(emit complete / notify).catch(...)`，**立即**返回 `{ id, status: "running" }`。

### Step 4.3

注册 **`subagent_status`**（或 `get_subagent_result` 命名），按 `id` 查内存 Map：`pending | done | error` + 截断后的结果摘要。

### Step 4.4

完成 / 失败：`ctx.ui.notify` + `pi.events.emit("subagent:complete", { id, … })`（事件名可与设计统一）。

### Step 4.5（可选）

`pi.appendEntry` 持久化任务元数据，便于崩溃恢复（若 API 可用）。

---

## 阶段 5：策略与运维

### Step 5.1

确保子 session 的 `allowedTools` **从不包含**委派工具本身（与 tintinweb `EXCLUDED_TOOL_NAMES` 策略一致）。

### Step 5.2

settings 键：`max_concurrent`、`max_total`、`timeout_ms`（映射到 abort 或 session 层策略）、可选按 agent 类型的 `model` / `thinking` 覆盖。

### Step 5.3

根 `AGENTS.md` 已链到 `docs/subagents/`；本包 README 重复链接即可。

### Step 5.4

`npx tsc --build`、`npm test`（若有）、`npm run format`。

---

## 阶段 6：与仓库其他包联动（可选）

### Step 6.1

statusline：订阅 `subagent:complete`（及 start），展示进行中数量。

### Step 6.2

文档说明：子 session `bindExtensions` 时是否加载 `protect-secrets`（推荐与主会话一致，除非 `isolated` 产品定义明确排除）。

### Step 6.3

（可选）实现 **tintinweb** 式 `pi.events` RPC（`subagents:rpc:spawn` 等）前，先评估是否有 `pi-tasks` 类调用方；无则可跳过。

---

## 检查清单（发布前）

- [ ] 设计文档中的「非目标」与实现一致（**无** `spawn("pi"` 或子进程 `cli.js` 路径）
- [ ] 工具返回均经过输出大小限制
- [ ] `signal` 取消在前台路径调用 `session.abort()`；后台有 `cancel` 或明确说明
- [ ] `createAgentSession` 所需 pi-coding-agent **最低版本**在 README 写明
- [ ] 并行压测下 CPU / 内存与 API 配额可接受

---

## API 验证结果（模板已上移到文首）

正式结论见本文 **「API 验证结果（阶段 0）」**；下方留空供复制到新会话时只带 TODO 表。
