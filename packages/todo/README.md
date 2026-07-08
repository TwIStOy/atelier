# @htwang-contrib/todo

移植自 [rpiv-todo](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo) 的任务管理扩展 —— 为 pi coding agent 提供结构化的 todo 列表,让 agent 用 `todo` 工具维护任务、用 `/todos` 命令查看、在编辑器上方常驻一个 overlay 面板实时展示进度。

## 功能

- **`todo` 工具** —— agent 通过 6 个 action 创建/更新/查询/删除/清空任务
- **`/todos` 命令** —— 三段分组查看当前任务列表
- **Overlay widget** —— 编辑器上方实时面板,显示 `completed/total` 计数,完成项自动折叠
- **状态持久化** —— 通过 session branch replay,`/reload` 和 compact 后自动恢复

## `todo` 工具

| Action   | 说明                                                       | 关键参数                                                                                                          |
| -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `create` | 创建一个新任务(默认 `pending`)                             | `subject`(必填)、`description?`、`activeForm?`、`status?`、`blockedBy?`、`owner?`、`metadata?`                    |
| `update` | 更新任务字段、切换状态、增删依赖                           | `id`(必填)、`subject?`、`status?`、`addBlockedBy?`、`removeBlockedBy?`、`metadata?`(值传 `null` 删 key)、`owner?` |
| `list`   | 列出任务(默认不含已删除)                                   | `status?`(按状态过滤)、`includeDeleted?`(默认 `false`)                                                            |
| `get`    | 查询单个任务详情(含其 blockedBy / blocks 反查)             | `id`(必填)                                                                                                        |
| `delete` | 软删除任务(`status` → `deleted`,保留 tombstone 供依赖校验) | `id`(必填)                                                                                                        |
| `clear`  | 清空所有任务(重置 state)                                   | 无                                                                                                                |

> 任务状态四态:`pending` / `in_progress` / `completed` / `deleted`。状态转换受 `VALID_TRANSITIONS` 表约束,`addBlockedBy` 会做依赖成环检测。
>
> **bare update 默认**:`update` 只传 `id` 而不带任何可变字段时,默认把任务标记为 `in_progress`(显式字段始终优先)。

## `/todos` 命令

```
/todos
```

输出按 `pending → in_progress → completed` 顺序三段分组(header 计数行顺序相反,为 `completed · in_progress · pending`),每段带 header 计数;无任务时提示 `No todos yet. Ask the agent to add some!`;非交互环境(无 UI)时提示 `/todos requires interactive mode`。

## Overlay widget

位于编辑器上方(`placement: "aboveEditor"`)的实时面板:

- **Heading** —— `Todos (completed/total)`,有 `in_progress` 任务时显示实心 `●` 高亮,否则空心 `○` 暗淡
- **折叠行为** —— `agent_start` 时把上一轮展示过的 completed 任务收起;超出 `MAX_WIDGET_LINES`(12)时显示 `+N more (X completed, Y pending)` 摘要行
- **空注销** —— 没有可见任务时自动注销 widget

## 配置

在 `extensions.json` 的 `"todo"` 段可覆盖 prompt 文案:

```json
{
  "todo": {
    "guidance": {
      "promptSnippet": "Maintain a focused todo list...",
      "promptGuidelines": ["Keep tasks small", "Mark progress promptly"]
    }
  }
}
```

未设置时使用内置 `DEFAULT_PROMPT_SNIPPET` / `DEFAULT_PROMPT_GUIDELINES`(7 条)。

## 持久化

状态不写盘,而是随 `todo` 工具调用的 `details` 快照记入 session branch。在 `session_start` / `session_compact` / `session_tree` 时通过 `replayFromBranch` 回放分支、取**最后一条** `toolName==="todo"` 的 `TaskDetails` 恢复 store。因此 `/reload`、compact、切换分支后状态自动恢复 —— 前提是 `TOOL_NAME="todo"` 不变(它是 replay 的过滤键)。

## 身份常量

- `TOOL_NAME = "todo"` —— 工具名,也是 replay 过滤键,**不可改名**
- `WIDGET_KEY = "rpiv-todos"` —— overlay widget 注册键,**保留旧名**以便从 rpiv-todo 迁移的用户不丢已有 widget

## 设计文档

- [docs/todo/DESIGN.md](../../docs/todo/DESIGN.md) —— 完整设计分析
- [docs/todo/STEPS.md](../../docs/todo/STEPS.md) —— 实施清单(分 Phase)
- [docs/todo/MODULES.md](../../docs/todo/MODULES.md) —— 逐模块移植动作(PORT/ADAPT/REWRITE)与签名
