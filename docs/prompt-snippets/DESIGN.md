# `prompt-snippets` 扩展 — 设计文档

## D1. 概述

一个 `/snippet` 命令扩展，用于管理和发送预定义的 prompt 模板片段（snippets）。用户通过命令行选择一个 snippet 并传入参数，扩展完成模板展开后通过 `pi.sendUserMessage()` 直接发送，触发一次 agent 回合。

与 pi 内置 prompt template 的区别：

| 维度 | 内置 prompt template | 本扩展 (`/snippet`) |
|------|---------------------|---------------------|
| 触发方式 | `/name` 在编辑器中展开文本 | `/snippet name` 直接发送 |
| 发送机制 | 展开后填入编辑器，用户手动确认 | `sendUserMessage()` 立即发送 |
| 存储位置 | `~/.pi/agent/prompts/` | 独立目录 + package.json `pi.snippets` 声明 |
| 适用场景 | 通用文本宏 | 预设的 agent 工作流触发器 |

核心价值：将 `/self-improve`、`/reorganize-memory` 这类「命令 → 构建长 prompt → sendUserMessage」的模式泛化，用文件驱动替代硬编码 TypeScript 模板。

## D2. 数据模型

### Snippet 文件格式

Markdown 文件，支持可选 YAML frontmatter：

```markdown
---
description: 审查代码中的 bug 和安全问题
argument-hint: <file_path> [focus_area]
---
审查 $1 中的代码。重点关注：
- $2
- 逻辑错误和边界情况
- 安全漏洞
- 缺失的错误处理

上下文：$ARGUMENTS
```

**Frontmatter 字段：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `description` | string | 否 | snippet 的一句话描述，用于 `/snippet list` 展示 |
| `argument-hint` | string | 否 | 参数提示文本，用于帮助信息 |

**模板变量：**

| 变量 | 含义 | 示例 |
|------|------|------|
| `$1`, `$2`, ... | 位置参数 | `$1` → 第一个参数 |
| `$@` 或 `$ARGUMENTS` | 所有参数拼接 | `"a b c"` |
| `${@:N}` | 从第 N 个参数开始 | `${@:2}` → 第二个及之后的所有参数 |
| `${@:N:L}` | 从第 N 个参数取 L 个 | `${@:2:3}` → 第 2、3、4 个参数 |

未匹配的位置参数替换为空字符串。

### Snippet 解析结果

```typescript
interface Snippet {
  name: string;           // 文件名去掉 .md 后缀
  filePath: string;       // 完整文件路径
  description: string;    // frontmatter 中的 description，默认 ""
  argumentHint: string;   // frontmatter 中的 argument-hint，默认 ""
  body: string;           // frontmatter 之后的正文内容（已去除首尾空行）
  source: string;         // 来源标识，用于 /snippet list 展示（"project" | "user" | "package:<name>"）
}
```

## D3. 存储与发现

pi 的 `PackageManager` 内部硬编码了 `RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"]`，不包含 `snippets`。`ExtensionAPI` 也不暴露包列表。因此本扩展需要**自行遍历所有已注册的包**来发现 `pi.snippets` 声明。

### D3.1 Snippet 来源（四层，优先级从高到低）

| 优先级 | 来源 | 路径 / 声明 | 作用域 |
|--------|------|-------------|--------|
| 1 | 项目级目录 | `<project_root>/.pi/snippets/*.md` | 项目 |
| 2 | 项目 `settings.json` 中声明的包的 `pi.snippets` | `.pi/settings.json` → `packages` → `<pkg>/package.json` → `pi.snippets` | 项目 |
| 3 | 用户级目录 | `~/.pi/agent/snippets/*.md` | 用户 |
| 4 | 用户 `settings.json` 中声明的包的 `pi.snippets` | `~/.pi/agent/settings.json` → `packages` → `<pkg>/package.json` → `pi.snippets` | 用户 |

同名 snippet 高优先级覆盖低优先级。用户级与项目级的覆盖规则与 pi 内置 prompt template 一致。

### D3.2 `pi.snippets` 声明格式

在 `package.json` 的 `"pi"` manifest 中：

```json
{
  "pi": {
    "extensions": ["./index.ts"],
    "snippets": ["./snippets"]
  }
}
```

`snippets` 是一个字符串数组，每个元素是一个**相对路径**（相对于 package root），指向：
- **目录** — 扫描目录下所有 `*.md` 文件（非递归）
- **单个文件** — 直接加载该 `.md` 文件

这与 pi 内置的 `pi.extensions`、`pi.skills`、`pi.prompts` 的声明方式一致。

### D3.3 包发现机制

pi 的 `settings.json` 中 `packages` 数组列出了所有注册的包源：

```json
{
  "packages": [
    "/Users/wanghaot/Projects/pi-extensions",
    "/Users/wanghaot/.vibe-island/pi-extension"
  ]
}
```

每个包源是一个本地目录。该目录的 `package.json` 中可能有：
- `pi.extensions` — pi 已处理（加载扩展）
- `pi.snippets` — **本扩展处理**

此外，根包的 `pi.extensions` 指向子包目录（如 `"packages/memory"`），这些子包也可能有自己的 `pi.snippets` 声明。

### D3.4 发现算法

```
function discoverSnippets(cwd: string, agentDir: string): Snippet[]

  snippets = new Map<string, Snippet>()

  // === 第一轮：收集所有需要扫描的 snippet 目录 ===

  snippetDirs: Array<{ dir: string, source: string }> = []

  // 1. 用户级固定目录
  userSnippetsDir = path.join(agentDir, "snippets")
  if (exists(userSnippetsDir))
    snippetDirs.push({ dir: userSnippetsDir, source: "user" })

  // 2. 用户级 packages 中声明的 pi.snippets
  userSettings = readSettings(path.join(agentDir, "settings.json"))
  for pkgPath of resolvePackages(userSettings.packages, agentDir):
    for snippetEntry of readPiSnippets(pkgPath):
      snippetDirs.push({
        dir: resolve(pkgPath, snippetEntry),
        source: "package:" + readPkgName(pkgPath)
      })

  // 3. 项目级固定目录
  projectSnippetsDir = path.join(cwd, ".pi", "snippets")
  if (exists(projectSnippetsDir))
    snippetDirs.push({ dir: projectSnippetsDir, source: "project" })

  // 4. 项目级 packages 中声明的 pi.snippets
  projectSettings = readSettings(path.join(cwd, ".pi", "settings.json"))
  for pkgPath of resolvePackages(projectSettings.packages, cwd):
    for snippetEntry of readPiSnippets(pkgPath):
      snippetDirs.push({
        dir: resolve(pkgPath, snippetEntry),
        source: "package:" + readPkgName(pkgPath)
      })

  // 5. 根包自身的 pi.snippets（settings.json 中 packages 指向的根目录）
  //    如果根目录的 package.json 也有 pi.snippets，上面已覆盖

  // === 第二轮：按优先级从低到高遍历，后 set 覆盖先 set ===
  for { dir, source } of snippetDirs:
    for file of glob(dir, "*.md"):
      snippet = parseSnippet(file)
      snippet.source = source
      snippets.set(snippet.name, snippet)   // 后写覆盖先写 = 高优先级胜出

  // 第二轮的遍历顺序已经是从低优先级到高优先级
  // （用户级先，项目级后；目录先，package 后）

  return [...snippets.values()].sort(by name)
```

### D3.5 辅助函数

```typescript
// 读取 settings.json，提取 packages 数组
function readSettings(settingsPath: string): { packages?: string[] }

// 解析 packages 数组中的每个条目为绝对路径
// 支持绝对路径和相对路径（相对于 baseDir）
function resolvePackages(packages: string[], baseDir: string): string[]

// 读取 package.json 的 pi.snippets 字段
// 返回字符串数组或空数组
function readPiSnippets(packageRoot: string): string[]

// 读取 package.json 的 name 字段
// 用于 source 标识
function readPkgName(packageRoot: string): string
```

### D3.6 关于根包 `pi.extensions` 指向的子包

本仓库的 `package.json` 中：

```json
{
  "pi": {
    "extensions": ["packages/memory", "packages/btw", ...]
  }
}
```

这些子包（如 `packages/memory`）如果声明了 `pi.snippets`，它们不会被自动发现——因为 `settings.json` 的 `packages` 指向的是仓库根目录，而不是各个子包。

**解决方案**：本扩展额外遍历 `pi.extensions` 指向的包目录，检查其 `package.json` 中是否有 `pi.snippets`。这需要在扩展初始化时读取根 `package.json`。

发现算法修正——在 D3.4 的步骤中增加：

```
  // 6. 根包 pi.extensions 指向的子包的 pi.snippets
  rootPkg = readPackageJson(path.join(agentDir, "..", "package.json"))
       || readPackageJson(path.join(cwd, "package.json"))
  for extEntry of rootPkg?.pi?.extensions ?? []:
    extAbsPath = resolve(cwd, extEntry)
    // extEntry 可能指向 index.ts 文件或包目录
    extDir = isDirectory(extAbsPath) ? extAbsPath : dirname(extAbsPath)
    for snippetEntry of readPiSnippets(extDir):
      snippetDirs.push({
        dir: resolve(extDir, snippetEntry),
        source: "package:" + readPkgName(extDir)
      })
```

### D3.7 完整优先级（最终版）

遍历顺序（低→高，后写覆盖先写）：

1. 用户级固定目录 `~/.pi/agent/snippets/`
2. 用户 `settings.json` → `packages` → 各包的 `pi.snippets`
3. 用户 `settings.json` → `packages` 中根包 → `pi.extensions` → 各子包的 `pi.snippets`
4. 项目级固定目录 `<cwd>/.pi/snippets/`
5. 项目 `settings.json` → `packages` → 各包的 `pi.snippets`
6. 项目 `settings.json` → `packages` 中根包 → `pi.extensions` → 各子包的 `pi.snippets`
7. 项目根 `package.json` → `pi.extensions` → 各子包的 `pi.snippets`（覆盖 cwd 下发现的情况）

实际实现中，3 和 6 是同一步逻辑——遍历 packages 中的每个根包时，顺带展开其 `pi.extensions` 指向的子包。

## D4. 命令设计

### 命令格式

```
/snippet list                          — 列出所有可用 snippets
/snippet <name> [args...]              — 展开并发送 snippet
/snippet                               — 等同于 /snippet list
```

### 处理流程

```
/snippet <name> [args...]
  │
  ├─ 1. discoverSnippets(cwd, agentDir) — 发现所有 snippet 文件
  │
  ├─ 2. 查找 name 匹配的 snippet
  │     ├─ 未找到 → ctx.ui.notify("snippet not found", "error"); return
  │
  ├─ 3. expandSnippet(snippet, args)    — 模板变量展开
  │
  ├─ 4. ctx.isIdle() 检查
  │     ├─ 忙碌 → ctx.ui.notify("Agent is busy", "warning"); return
  │
  └─ 5. pi.sendUserMessage(expanded)    — 发送展开后的内容
```

### 列表展示

`/snippet list` 输出格式（通过 `ctx.ui.notify`）：

```
Available snippets:

  review     Review code for bugs and security         <file_path> [focus_area]     [project]
  test       Generate unit tests for the given file    <file_path>                  [package:memory]
  explain    Explain the selected code                 [symbol_name]                [user]

3 snippets found.
```

每行末尾方括号内标注来源，帮助用户区分同名 snippet 的覆盖关系。

## D5. 架构

### 文件结构

```
packages/prompt-snippets/
  index.ts          ← 扩展入口：注册命令
  snippets.ts       ← 核心逻辑：发现、解析、展开
  discover.ts       ← 包发现与 snippet 路径收集
  tsconfig.json
  package.json
```

极简架构——纯命令扩展，无 TUI 组件、无持久化状态。

### 模块职责

#### `index.ts` — 扩展入口

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSnippetCommand } from "./snippets.ts";

export default function (pi: ExtensionAPI): void {
  registerSnippetCommand(pi);
}
```

#### `discover.ts` — 包发现

职责：

1. **读取 settings.json** — 提取 `packages` 数组
2. **读取 package.json** — 提取 `pi.snippets` 和 `pi.extensions`
3. **路径解析** — 将相对路径转为绝对路径，处理文件 vs 目录
4. **Snippet 路径收集** — 遍历所有来源，收集待扫描的目录列表

导出：

```typescript
interface SnippetSource {
  dir: string;
  source: string;
}

function collectSnippetDirs(cwd: string, agentDir: string): SnippetSource[];
function readPiSnippets(packageRoot: string): string[];
function resolvePackages(packages: string[], baseDir: string): string[];
```

内部函数（不导出）：

```typescript
function readSettingsPackages(settingsPath: string): string[];
function readPkgName(packageRoot: string): string;
function expandExtensionSubpackages(packageRoot: string): string[];
```

#### `snippets.ts` — 核心逻辑

职责：

1. **Snippet 发现** — 调用 `discover.ts` 收集目录，扫描 `.md` 文件
2. **Frontmatter 解析** — 提取 `description` 和 `argument-hint`
3. **模板展开** — 替换 `$1`/`$2`/`$ARGUMENTS`/`${@:N}`/`${@:N:L}` 变量
4. **命令注册** — 注册 `/snippet` 命令及其处理逻辑

导出：

```typescript
export function registerSnippetCommand(pi: ExtensionAPI): void;
```

内部函数（不导出）：

```typescript
function discoverSnippets(cwd: string, agentDir: string): Snippet[];
function parseSnippet(filePath: string, source: string): Snippet;
function expandSnippet(snippet: Snippet, args: string): string;
function expandPositional(body: string, args: string[]): string;
function listSnippets(ctx: ExtensionCommandContext): void;
```

### 模板展开算法

```typescript
function expandSnippet(snippet: Snippet, rawArgs: string): string {
  const args = rawArgs.trim() === "" ? [] : rawArgs.split(/\s+/);
  return expandPositional(snippet.body, args);
}

function expandPositional(body: string, args: string[]): string {
  let result = body;

  // 1. ${@:N:L} — 最具体，先替换
  result = result.replace(/\$\{@:(\d+):(\d+)\}/g, (_, start, len) => {
    const s = parseInt(start) - 1;
    const l = parseInt(len);
    return args.slice(s, s + l).join(" ");
  });

  // 2. ${@:N}
  result = result.replace(/\$\{@:(\d+)\}/g, (_, start) => {
    return args.slice(parseInt(start) - 1).join(" ");
  });

  // 3. $@ 和 $ARGUMENTS — 所有参数拼接
  const allArgs = args.join(" ");
  result = result.replace(/\$@/g, allArgs);
  result = result.replace(/\$ARGUMENTS/g, allArgs);

  // 4. $1, $2, ... — 位置参数
  result = result.replace(/\$(\d+)/g, (_, idx) => {
    const i = parseInt(idx) - 1;
    return i >= 0 && i < args.length ? args[i] : "";
  });

  return result;
}
```

替换顺序从最具体（`${@:N:L}`）到最通用（`$N`），避免误匹配。

### Frontmatter 解析

```typescript
function parseSnippet(filePath: string, source: string): Snippet {
  const content = fs.readFileSync(filePath, "utf-8");
  const name = path.basename(filePath, ".md");

  let description = "";
  let argumentHint = "";
  let body = content;

  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (match) {
    const frontmatter = match[1];
    body = match[2].trim();

    for (const line of frontmatter.split("\n")) {
      const descMatch = line.match(/^description:\s*(.+)$/);
      if (descMatch) description = descMatch[1].trim();

      const hintMatch = line.match(/^argument-hint:\s*(.+)$/);
      if (hintMatch) argumentHint = hintMatch[1].trim();
    }
  }

  return { name, filePath, description, argumentHint, body, source };
}
```

不引入 YAML 解析库，仅用正则提取两个已知字段——与 pi 内置 prompt template 的解析策略一致。

## D6. 依赖关系

### `package.json`

```json
{
  "name": "@htwang-contrib/prompt-snippets",
  "version": "0.1.0",
  "type": "module",
  "main": "index.ts",
  "types": "index.ts",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "dependencies": {},
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "@types/node": "^25.9.1",
    "typescript": "^6.0.0"
  }
}
```

零运行时依赖。不依赖 `@htwang-contrib/common`（本扩展不需要 common 中的任何功能）。

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "composite": true,
    "emitDeclarationOnly": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## D7. 集成点

### D7.1 Root `package.json`

在 `pi.extensions` 数组中添加 `"packages/prompt-snippets"`。

### D7.2 Root `tsconfig.json`

在 `references` 数组中添加 `{ "path": "packages/prompt-snippets" }`。

### D7.3 用户目录

用户需要手动创建 `~/.pi/agent/snippets/` 目录并放入 `.md` 文件。项目级目录 `<project>/.pi/snippets/` 同理。

### D7.4 Package 中声明 snippets

任何 pi 包（被 `settings.json` 的 `packages` 引用，或被根包 `pi.extensions` 引用）都可以在 `package.json` 中声明：

```json
{
  "pi": {
    "extensions": ["./index.ts"],
    "snippets": ["./snippets"]
  }
}
```

然后在包目录下创建 `snippets/` 目录，放入 `.md` 文件。

### D7.5 `agentDir` 获取

pi 不通过 API 暴露 `agentDir`（即 `~/.pi/agent`）。扩展需要通过以下方式获取：

```typescript
import { homedir } from "node:os";
import { join } from "node:path";

const agentDir = join(homedir(), ".pi", "agent");
```

与 pi 内部的 `getAgentDir()` 结果一致。

## D8. 使用示例

### 示例 1：代码审查

`~/.pi/agent/snippets/review.md`：

```markdown
---
description: 审查代码中的 bug 和安全问题
argument-hint: <file_path> [focus_area]
---
审查 $1 的代码。重点：

- $2
- 逻辑错误和边界情况
- 安全漏洞
- 缺失的错误处理
- 性能问题

提供具体的问题列表，按严重程度排序。
```

```
> /snippet review src/app.ts "支付模块"
```

→ 展开为：

```
审查 src/app.ts 的代码。重点：

- 支付模块
- 逻辑错误和边界情况
- 安全漏洞
- 缺失的错误处理
- 性能问题

提供具体的问题列表，按严重程度排序。
```

→ 通过 `sendUserMessage` 发送，触发 agent 回合。

### 示例 2：包内 snippet

`packages/memory/package.json`：

```json
{
  "pi": {
    "extensions": ["./index.ts"],
    "snippets": ["./snippets"]
  }
}
```

`packages/memory/snippets/self-improve.md`：

```markdown
---
description: 反思当前会话并持久化改进
argument-hint: [focus_area]
---
Reflect on the current session, identify what was learned,
persist improvements to memory and journal, and update relevant skill files.

## Arguments

"$ARGUMENTS" — optional focus area.

## Steps

1. Reflect — review the conversation for learnings, gaps, new patterns
2. Persist to memory and journal
3. Improve skills (requires user approval)
4. Summary
```

这样 `/self-improve` 和 `/reorganize-memory` 就不需要硬编码在 TypeScript 中了。

### 示例 3：无参数 snippet

`~/.pi/agent/snippets/summary.md`：

```markdown
---
description: 总结当前会话的进展
---
总结本次对话中已完成的工作：

1. 列出所有已修改的文件及修改原因
2. 列出所有已做出的决策及其理由
3. 列出所有遗留问题和后续步骤
4. 评估整体进展是否符合预期

保持简洁，使用列表格式。
```

## D9. 测试策略

使用 Vitest，与项目现有测试模式一致。

### D9.1 `discover.test.ts`

测试用例：

- `resolvePackages` — 绝对路径原样返回
- `resolvePackages` — 相对路径基于 baseDir 解析
- `readPiSnippets` — 有 `pi.snippets` 的 package.json 返回数组
- `readPiSnippets` — 无 `pi` manifest 返回空数组
- `readPiSnippets` — 有 `pi` 但无 `snippets` 返回空数组
- `collectSnippetDirs` — 用户级固定目录存在时包含
- `collectSnippetDirs` — 用户级固定目录不存在时跳过
- `collectSnippetDirs` — packages 中声明的包的 `pi.snippets` 被展开
- `collectSnippetDirs` — 根包 `pi.extensions` 指向的子包的 `pi.snippets` 被展开
- `collectSnippetDirs` — 项目级路径优先级高于用户级

### D9.2 `snippets.test.ts`

测试用例：

- `parseSnippet` — 有 frontmatter 的文件正确提取 description、argumentHint、body
- `parseSnippet` — 无 frontmatter 的文件 body 为全文
- `parseSnippet` — 空 body 返回空字符串
- `expandPositional` — `$1`, `$2` 替换
- `expandPositional` — `$ARGUMENTS` 替换为所有参数
- `expandPositional` — `${@:2}` 从第二个参数开始
- `expandPositional` — `${@:2:3}` 从第二个参数取三个
- `expandPositional` — 越界位置参数替换为空字符串
- `expandPositional` — 混合使用多种变量类型
- `discoverSnippets` — 多来源正确合并（用临时目录模拟）
- `discoverSnippets` — 高优先级同名 snippet 覆盖低优先级
- `discoverSnippets` — 目录不存在时返回空数组
- 命令处理 — 未找到 snippet 时通知错误
- 命令处理 — agent 忙碌时通知警告

## D10. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 模板变量语法与 pi 内置不一致 | 用户混淆两套语法 | 完全复用 pi prompt template 的变量语法 |
| snippet 目录不存在 | `/snippet list` 返回空 | 首次运行时提示创建目录 |
| 文件编码问题 | 非 UTF-8 文件解析失败 | 强制 `utf-8` 读取，catch 错误并跳过 |
| `pi.snippets` 不是 pi 核心 RESOURCE_TYPE | pi 未来可能添加同名保留字段 | 字段名 `snippets` 与 pi 内置（`extensions`/`skills`/`prompts`/`themes`）无冲突；如 pi 未来原生支持，可迁移 |
| `settings.json` 中 packages 路径解析 | 相对路径/绝对路径/符号链接处理不一致 | 复用 `path.resolve(baseDir, entry)` 统一处理 |
| 遍历 `pi.extensions` 子包可能误入非包目录 | 扫描无关目录 | 仅当子目录存在 `package.json` 且有 `pi.snippets` 时才展开 |
| 文件数量多时每次命令都扫描 | 性能 | 文件数通常 < 50；可通过 `session_start` 缓存 + `fs.watch` 增量更新优化（未来） |

## D11. 未来扩展（不在本期范围）

- **`/snippet preview <name> [args]`** — 预览展开结果但不发送
- **`/snippet edit <name>`** — 在 `$EDITOR` 中打开 snippet 文件
- **snippet 分组** — 子目录作为分类
- **TUI 选择界面** — 类似 `subagents-agents` 的交互式列表
- **缓存** — `session_start` 时扫描一次，`fs.watch` 增量更新
- **`resources_discover` 集成** — 若 pi 未来支持自定义 RESOURCE_TYPE，迁移到原生发现
