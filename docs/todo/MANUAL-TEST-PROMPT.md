# Todo 扩展 — S6.3 手测指南

本文是 [STEPS.md](./STEPS.md) S6.3 的配套手测脚本。启动方式:

```bash
pi -e packages/todo/index.ts
```

下方 prompt 按 **Stage A → F** 分段。Stage A/B/C/E 可直接粘贴给 agent 执行;Stage D(overlay 视觉)和 Stage F(compact)需要你手动操作 + 肉眼对照。建议**逐段粘贴**,每段执行完核对预期再进下一段。

每条预期里的「工具返回」指 `todo` 工具调用结果那一行(`content` 文本)。

---

## Stage A — 工具 happy path

> 验证 create / update / get / list / delete / clear 六个 action 的正常输出格式。

粘贴给 agent:

```text
我正在手测 todo 工具,请严格按我说的顺序调用 todo 工具,每步只做我要求的那一个调用,不要额外发挥。完成后停一下等我确认。

1. create 一个 task,subject="研究现有工具"
2. create 一个 task,subject="写测试"
3. update id=1,status="in_progress",activeForm="研究中"
4. get id=1
5. update id=2,addBlockedBy=[1]
6. get id=2
7. list
8. update id=1,status="completed"
9. list
10. delete id=2
11. list
12. clear
13. list
```

**逐条预期(工具返回的文本):**

| # | 操作 | 预期工具返回 |
|---|---|---|
| 1 | create 研究现有工具 | `Created #1: 研究现有工具 (pending)` |
| 2 | create 写测试 | `Created #2: 写测试 (pending)` |
| 3 | update #1 in_progress | `Updated #1 (pending → in_progress)` |
| 4 | get #1 | 多行:`#1 [in_progress] 研究现有工具` + `  activeForm: 研究中` |
| 5 | update #2 addBlockedBy=[1] | `Updated #2` |
| 6 | get #2 | 多行,含 `  blockedBy: #1` |
| 7 | list | 两行:`[in_progress] #1 研究现有工具 (研究中)` / `[pending] #2 写测试 ⛓ #1` |
| 8 | update #1 completed | `Updated #1 (in_progress → completed)` |
| 9 | list | 两行:`[completed] #1 研究现有工具` / `[pending] #2 写测试 ⛓ #1` |
| 10 | delete #2 | `Deleted #2: 写测试` |
| 11 | list | 一行:`[completed] #1 研究现有工具`(#2 是墓碑,默认隐藏) |
| 12 | clear | `Cleared 2 tasks` |
| 13 | list | `No tasks` |

**关键对照点**
- `get` 的 `blocks` 反向邻接:如果 #2 blockedBy #1,理论上 `get #1` 应含 `  blocks: #2`。Stage A 第 6 步只测了正向 blockedBy;若想验证 blocks,在删 #2 之前补一句 `get id=1` 看是否有 `blocks: #2`。
- 状态转换箭头格式是 `(from → to)`,用的是 `→`(em 箭头)不是 `->`。

---

## Stage B — 错误路径

> 验证各 error 分支返回 `Error: ...` 且**不改变状态**。

粘贴给 agent:

```text
继续手测 todo 的错误处理。请严格按顺序执行下面这些"故意触发错误"的调用,每步只做一个,记录每次工具返回的错误文本。不要尝试修正或绕过这些错误,我就是要测错误本身。

先 create subject="基线任务A" 和 create subject="基线任务B"(这两个应该成功),然后依次:

1. create,不传 subject(或传空字符串)——测 subject 必填
2. update id=999,subject="x"——测 id 不存在
3. update id=1——不传任何可变字段(只传 id),现在会默认标记为 in_progress(测 bare-update 默认行为)
4. 先 update id=1 status="completed",再 update id=1 status="in_progress"——测非法转换(completed 不能回 in_progress)
5. update id=1 addBlockedBy=[1]——测自指
6. update id=2 addBlockedBy=[1],再 update id=1 addBlockedBy=[2]——测成环
7. update id=1 addBlockedBy=[999]——测依赖不存在
8. get id=999——测 get 不存在
9. delete id=999——测 delete 不存在

最后 list 一次,确认基线任务 A、B 还在(错误操作不应改变状态)。
```

**逐条预期:**

| # | 操作 | 预期错误文本(以 `Error: ` 开头) |
|---|---|---|
| 1 | create 无 subject | `Error: subject required for create` |
| 2 | update #999 | `Error: #999 not found` |
| 3 | update 仅 id(无可变字段) | `Updated #1 (pending → in_progress)`(默认行为,不再是错误) |
| 4 | completed→in_progress | `Error: illegal transition completed → in_progress` |
| 5 | addBlockedBy=[1] on #1 | `Error: cannot block #1 on itself` |
| 6 | 互依赖成环 | 第二步返回 `Error: addBlockedBy would create a cycle in the blockedBy graph` |
| 7 | addBlockedBy=[999] | `Error: addBlockedBy: #999 not found` |
| 8 | get #999 | `Error: #999 not found` |
| 9 | delete #999 | `Error: #999 not found` |

**关键对照点**:最后 `list` 必须仍显示基线任务 A、B(第 3 步的 bare-update 会把 A 改成 in_progress,第 4 步再改成 completed——这些都是成功调用,符合预期;错误调用不回滚已成功的状态)。如果基线任务数量变了或 nextId 错乱,说明 error 路径意外改了 state,是 bug。

---

## Stage C — `/todos` 命令

> 验证三段分组 + header 计数。先造数据,再跑命令。

粘贴给 agent:

```text
最后测一下 /todos 命令的输出。请先清理然后建一批任务:create "设计API"、"写代码"、"写文档"、"review";然后把 "写代码" 改成 in_progress,"写文档" 改成 completed。建好后,请运行 /todos 命令,把完整输出贴给我。
```

**预期 `/todos` 输出结构**(具体 subject 按上面):

```text
1/4 completed · 1 in_progress · 2 pending
── Pending ──
  ○ #1 设计API
  ○ #4 review
── In Progress ──
  ◐ #2 写代码
── Completed ──
  ✓ #3 写文档
```

**关键对照点**
- 分组顺序必须是 **pending → in_progress → completed**(顶部到底部);注意这与 header 计数行的顺序正好相反(见下)。
- header 计数格式 `X/total completed · Y in_progress · Z pending`(分隔符是 ` · ` 中点)。
- 每段任务行的字形按 section 不同:pending=`○`、in_progress=`◐`、completed=`✓`(注意 `/todos` 命令的 completed 用 `✓`,与 overlay 的 `●` 不同)。
- 每段标题 `── Section ──`(两侧各两个 em dash)。

**空状态测试**:接着让 agent 执行 `clear`,然后你再手动输入 `/todos`,应见 `No todos yet. Ask the agent to add some!`。

---

## Stage D — Overlay widget(人工观察)

> 这步不粘 prompt,直接在 TUI 里看编辑器**上方**的面板。

在 Stage C 造好任务后(不要 clear),观察编辑器上方的 overlay:

1. **heading**:应见 `Todos (1/4)`(completed/total 格式)。因为有 in_progress 任务(active 存在),heading 的 `●` 图标和文字应是 **accent 高亮色**;若全是 pending/completed 无 in_progress,则是 dim 灰 + `○`。
2. **任务行**:每行 `├─` 前缀(末行 `└─`),状态字形 `○ pending / ◐ in_progress / ✓ completed`(overlay 用 ✓ 不是 ●)。
3. **依赖标记**:有 blockedBy 的任务行尾带 `⛓ #id`。
4. **溢出**:手动让 agent create 15+ 个任务,overlay 最多 12 行,末行应变 `└─ +N more (X completed, Y pending)`。
5. **空注销**:执行 `clear` 后,overlay 应完全消失(setWidget 注销)。
6. **折叠**:把某任务标 completed,overlay 当轮仍显示它;让 agent 开始**新一轮回复**(触发 `agent_start`),上一轮完成的任务应折叠消失。

---

## Stage E — 持久化:`/reload` replay(核心)

> 这是最关键的集成验证——纯单元测试覆盖不到的端到端 replay 链路。

粘贴给 agent 造数据:

```text
请 create 三个任务:"持久化测试1"、"持久化测试2"、"持久化测试3",然后把 #2 改成 in_progress,#3 改成 completed。建好后 list 一次确认状态,然后告诉我你可以了。
```

确认 list 输出正确后:

1. **手动执行 `/reload`**(你在 TUI 输入,不是 agent)。
2. reload 完成后,再让 agent `list`,粘贴给 agent:

```text
刚才 reload 了,请 list 一下当前所有任务,告诉我状态有没有丢。
```

**预期**:`/reload` 后 list 应**完整恢复**三个任务及各自状态(#1 pending / #2 in_progress / #3 completed),overlay 也应重新显示。

> 如果 reload 后状态全丢了(变空或只剩部分),说明 replay 链路有问题——最可能是 `TOOL_NAME` 过滤键、`details` 快照、或 `sessionManager.getBranch()` 遍历逻辑出错。这是必须修的回归。

---

## Stage F — compact 后状态不丢(人工)

> 验证 `session_compact` hook 的 replay + stale guard。

1. 让 agent 持续做些事(读文件、回答问题),把上下文撑大,或直接手动 `/compact`。
2. compact 完成后,让 agent `list`。
3. **预期**:任务仍在,状态不丢。

> 如果 compact 时报错或状态丢失,检查 `index.ts` 里 `session_compact` 分支:try `replaceState(replayFromBranch(ctx))`,stale 错用 `isStaleCtxError` 吞掉,其他错上抛。compact 与 session 销毁竞速时 ctx 可能是死代理,吞 stale 错是新 session 的 `session_start` 会重新 replay——这是设计内的。

---

## 完成判定

全部 Stage 通过后,把 [STEPS.md](./STEPS.md) 的 **S6.3** 勾上 `[x]`,Phase 6 整行改 `[x]`,「当前停在哪一 Phase」改成「全部完成」。

任一 Stage 不符预期,先记下现象,回 `packages/todo/` 对应模块定位修复后重测该 Stage。
