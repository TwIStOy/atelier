# @htwang-contrib/todo

移植自 [rpiv-todo](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo) 的任务管理扩展 —— 为 pi coding agent 提供结构化的 todo 列表,让 agent 用 `todo_*` 系列工具维护任务、用 `/todos` 命令查看、在编辑器上方常驻一个 overlay 面板实时展示进度。

## 功能

- **`todo_*` 工具** —— 6 个独立工具(`todo_create` / `todo_update` / `todo_list` / `todo_get` / `todo_delete` / `todo_clear`)负责创建/更新/查询/删除/清空任务,每个工具只暴露该 action 所需的字段(必填字段直接在 schema 层面约束)
- **`/todos` 命令** —— 三段分组查看当前任务列表
- **Overlay widget** —— 编辑器上方实时面板,显示 `completed/total` 计数,完成项自动折叠
- **状态持久化** —— 通过 session branch replay,`/reload` 和 compact 后自动恢复

## `todo_*` 工具

| 工具           | 说明                                                       | 关键参数                                                                                                          |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `todo_create`  | 创建一个新任务(默认 `pending`)                             | `subject`(必填)、`description?`、`activeForm?`、`blockedBy?`、`owner?`、`metadata?`                               |
| `todo_update`  | 更新任务字段、切换状态、增删依赖                           | `id`(必填)、`subject?`、`status?`、`addBlockedBy?`、`removeBlockedBy?`、`metadata?`(值传 `null` 删 key)、`owner?` |
| `todo_list`    | 列出任务(默认不含已删除)                                   | `status?`(按状态过滤)、`includeDeleted?`(默认 `false`)                                                            |
| `todo_get`     | 查询单个任务详情(含其 blockedBy / blocks 反查)             | `id`(必填)                                                                                                        |
| `todo_delete`  | 软删除任务(`status` → `deleted`,保留 tombstone 供依赖校验) | `id`(必填)                                                                                                        |
| `todo_clear`   | 清空所有任务(重置 state)                                   | 无                                                                                                                |

> 任务状态四态:`pending` / `in_progress` / `completed` / `deleted`。状态转换受 `VALID_TRANSITIONS` 表约束,`addBlockedBy` 会做依赖成环检测。
>
> **bare update 默认**:`todo_update` 只传 `id` 而不带任何可变字段时,默认把任务标记为 `in_progress`(显式字段始终优先)。

## `/todos` 命令

```
/todos
```

输出按 `pending → in_progress → completed` 顺序三段分组(header 计数行顺序相反,为 `completed · in_progress · pending`),每段带 header 计数;无任务时提示 `No todos yet. Ask the agent to add some!`;非交互环境(无 UI)时提示 `/todos requires interactive mode`。

## Overlay widget

位于编辑器上方(`placement: "aboveEditor"`)的实时面板:

- **Heading** —— `Todos (completed/total)`,有 `in_progress` 任务时显示实心 `●` 高亮,否则空心 `○` 暗淡
- **状态图标** —— `pending` / `in_progress` / `completed` 分别用 Nerd Font v3 的 `nf-md-checkbox_blank_outline` / `nf-md-checkbox_intermediate` / `nf-md-checkbox_marked`。终端需安装 Nerd Font v3,否则显示为缺字符方框
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

未设置时使用各工具内置的默认 `promptSnippet` / `promptGuidelines`(按 action 分发,无重复)。

## 持久化

状态不写盘,而是随 `todo_*` 工具调用的 `details` 快照记入 session branch。在 `session_start` / `session_compact` / `session_tree` 时通过 `replayFromBranch` 回放分支、取**最后一条** `todo_*`(或旧版 `todo`)toolResult 的 `TaskDetails` 恢复 store。过滤键由 `isTodoToolName()` 判定,匹配 `todo_create` … `todo_clear` 六个工具名以及旧版 `todo`,因此 `/reload`、compact、切换分支后状态自动恢复,从旧版(单一 `todo` 工具)升级后旧 session 也能继续回放。

## 身份常量

- `TODO_TOOL_NAMES = ["todo_create", …, "todo_clear"]` —— 六个工具名
- `isTodoToolName(name)` —— replay 与 overlay 刷新的过滤判定,接受上述六个名字与旧版 `todo`
- `WIDGET_KEY = "rpiv-todos"` —— overlay widget 注册键,**保留旧名**以便从 rpiv-todo 迁移的用户不丢已有 widget

## 设计文档

- [docs/todo/DESIGN.md](../../docs/todo/DESIGN.md) —— 完整设计分析
- [docs/todo/STEPS.md](../../docs/todo/STEPS.md) —— 实施清单(分 Phase)
- [docs/todo/MODULES.md](../../docs/todo/MODULES.md) —— 逐模块移植动作(PORT/ADAPT/REWRITE)与签名
