# Todo 扩展适配设计

本文描述 `packages/todo/` 的设计决策与结构。逐文件的上游分析与改动细节见 [SOURCE-ANALYSIS.md](./SOURCE-ANALYSIS.md)；可执行清单见 [STEPS.md](./STEPS.md)。

## 1. 目标

在 monorepo 中实现与 `rpiv-todo` 功能等价的 pi 扩展，复用 `@htwang-contrib/common` 与现有约定，不引入 i18n 基础设施。

## 2. 包结构

```
packages/todo/
├── package.json
├── tsconfig.json
├── index.ts                  # 扩展入口：注册 + 生命周期
├── config.ts                 # guidance 配置（common.readConfig）
├── todo.ts                   # Tool + Command 注册
├── todo-overlay.ts           # Overlay widget
├── tool/
│   ├── types.ts              # 类型 + TypeBox schema
│   └── response-envelope.ts  # 响应信封
├── state/
│   ├── state.ts              # TaskState 接口
│   ├── store.ts              # 模块级状态单元
│   ├── state-reducer.ts      # 纯 reducer
│   ├── invariants.ts         # 状态转换规则
│   ├── task-graph.ts         # 依赖图（环检测）
│   ├── selectors.ts          # 纯选择器
│   └── replay.ts             # Branch replay
├── view/
│   └── format.ts             # overlay 行 / /todos 命令行格式化（渲染已迁移到 tool-display adapter）
└── test/
    ├── helpers.ts            # createMockPi / createMockCtx 等
    └── *.test.ts
```

## 3. 与 rpiv-todo 的关键差异

逐文件的 before/after 见 [SOURCE-ANALYSIS.md](./SOURCE-ANALYSIS.md)，此处只列决策。

| 决策                                                                          | 原因                                                                             |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **移除** `@juicesharp/rpiv-i18n` + `state/i18n-bridge.ts` + `locales/`        | 不做国际化，UI 字符串内联英文                                                    |
| **替换** `@juicesharp/rpiv-config` → `@htwang-contrib/common` 的 `readConfig` | 复用 monorepo 配置基础设施（`~/.config/pi/extensions.json` 的 `"todo"` section） |
| **替换** `typebox` + `StringEnum` → `@sinclair/typebox` + `Type.Union`        | 与 goal 等扩展一致；`@sinclair/typebox` 是现有依赖                               |
| **复用** `@htwang-contrib/common` 的 `isStaleCtxError`                        | 替代 rpiv 内联的正则检测                                                         |
| **移除** backward-compat re-export 块 + `reconstructTodoState` shim           | 本 monorepo 无遗留消费者                                                         |
| **不移植** `ship-manifest.test.ts`                                            | 不做 npm 发布                                                                    |

> 设计要点：reducer 是纯函数、不触碰 store，由 `execute` 手动 commit —— 这让 reducer 可单测、无副作用。Replay 基于 details 快照的 last-write-wins，不需要独立持久化文件。

## 4. 模块职责

| 模块                        | 职责                                      | 移植方式                                    |
| --------------------------- | ----------------------------------------- | ------------------------------------------- |
| `tool/types.ts`             | 类型 + TypeBox schema                     | 改 import（见 §3）                          |
| `state/state.ts`            | `TaskState` + `EMPTY_STATE`               | 原样                                        |
| `state/invariants.ts`       | 四态状态机转换规则                        | 原样                                        |
| `state/task-graph.ts`       | 环检测 + 反向邻接                         | 原样                                        |
| `state/state-reducer.ts`    | `(state, action, params) → { state, op }` | 原样                                        |
| `state/store.ts`            | 模块级状态单元                            | 原样（单进程单状态，不用 `getGlobalState`） |
| `state/selectors.ts`        | 过滤/分组/计数/布局                       | 原样（去掉 i18n import）                    |
| `state/replay.ts`           | 从 branch 恢复状态                        | 原样                                        |
| `tool/response-envelope.ts` | `(op, state) → LLM 返回信封`              | 原样                                        |
| `view/format.ts`            | overlay/command 格式化                    | 去 i18n；renderCall/renderResult 迁移到 tool-display adapter（见 MODULES § tool-display adapter） |
| `todo-overlay.ts`           | Overlay widget 生命周期                   | 去 i18n，内联英文                           |
| `config.ts`                 | guidance 配置                             | 重写（readConfig）                          |
| `todo.ts`                   | Tool + Command 注册                       | 去 re-export/i18n                           |
| `index.ts`                  | 扩展入口 + 生命周期                       | 去 i18n，import 来自 common                 |

## 5. 测试策略

不使用 `@juicesharp/rpiv-test-utils`，自行编写 `test/helpers.ts`（`createMockPi` / `createMockCtx` / `createMockUI` / `identityTheme`）。`createMockPi` 捕获 tools/commands/events；`createMockCtx` 提供 `hasUI` / `ui` / `sessionManager.getBranch` 等；`identityTheme` 为透传主题。

| 测试文件                         | 难度 | 说明                     |
| -------------------------------- | ---- | ------------------------ |
| `state-reducer.test.ts`          | ★☆☆  | 纯函数，几乎原样         |
| `store.test.ts`                  | ★☆☆  | get/commit/replace/reset |
| `task-graph.test.ts`             | ★☆☆  | 纯算法                   |
| `response-envelope.test.ts`      | ★☆☆  | 纯格式化                 |
| `replay.test.ts`                 | ★★☆  | mock branch 结构         |
| `todo.register.test.ts`          | ★★☆  | mockPi + 主题            |
| `todo.command.test.ts`           | ★★☆  | mockCtx                  |
| `todo-overlay.render.test.ts`    | ★★★  | mock UI + widget 工厂    |
| `todo-overlay.lifecycle.test.ts` | ★★★  | 完整生命周期 mock        |

不移植：`i18n-bridge.*.test.ts`（无 i18n）、`ship-manifest.test.ts`（不发布）。

## 6. API 对等性

rpiv-todo 与我们用的是同一个 `@earendil-works/pi-coding-agent`，扩展 API 完全一致：

- **ExtensionAPI**：`pi.registerTool` / `pi.registerCommand` / `pi.on` 接口不变。
- **Theme**：`theme.fg(color, text)` / `theme.bg(color, text)` / `theme.bold(text)` / `theme.strikethrough(text)` 用法不变。
- **TUI**：`@earendil-works/pi-tui` 的 `Text`、`truncateToWidth`、`visibleWidth`、`wrapTextWithAnsi` 可用。

## 7. package.json

```json
{
  "name": "@htwang-contrib/todo",
  "version": "0.1.0",
  "type": "module",
  "main": "index.ts",
  "types": "index.ts",
  "dependencies": { "@htwang-contrib/common": "*" },
  "devDependencies": {
    "@earendil-works/pi-ai": "latest",
    "@earendil-works/pi-coding-agent": "latest",
    "@earendil-works/pi-tui": "latest",
    "@sinclair/typebox": "^0.34.0",
    "@types/node": "^25.9.1",
    "typescript": "^6.0.0",
    "vitest": "^3.0.0"
  },
  "pi": { "extensions": ["./index.ts"] }
}
```

## 8. tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["*.ts", "tool/**/*.ts", "state/**/*.ts", "view/**/*.ts"],
  "references": [{ "path": "../common" }]
}
```
