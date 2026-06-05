# `prompt-snippets` 扩展 — 分步执行清单

> 逐步实现 `/snippet` 扩展的 checklist。每一步都可在 [DESIGN.md](./DESIGN.md) 中找到对应的设计章节。

## 进度图例

- [ ] 未开始
- [~] 进行中
- [x] 已完成

---

## Phase 1: 包脚手架与集成配置

### Step 1.1 — 创建 `package.json`

**设计关联：** [D6 `package.json`](./DESIGN.md#d6-依赖关系)

- [x] 创建 `packages/prompt-snippets/package.json`
  - [x] `name`: `@htwang-contrib/prompt-snippets`
  - [x] `pi.extensions`: `["./index.ts"]`
  - [x] `devDependencies`: `@earendil-works/pi-coding-agent`、`@types/node`、`typescript`
  - [x] `dependencies`: 空（零运行时依赖）
- [x] 运行 `npm install` 以链接 workspace

### Step 1.2 — 创建 `tsconfig.json`

**设计关联：** [D6 `tsconfig.json`](./DESIGN.md#d6-依赖关系)

- [x] 创建 `packages/prompt-snippets/tsconfig.json`
  - [x] `target`: `ES2022`，`module`: `ES2022`，`moduleResolution`: `bundler`
  - [x] `composite`: true，`emitDeclarationOnly`: true
  - [x] `allowImportingTsExtensions`: true
  - [x] `include`: `["./**/*.ts"]`，`exclude`: `["node_modules", "dist"]`

### Step 1.3 — 注册到根项目

**设计关联：** [D7.1 Root `package.json`](./DESIGN.md#d71-root-packagejson)、[D7.2 Root `tsconfig.json`](./DESIGN.md#d72-root-tsconfigjson)

- [x] 在根 `package.json` 的 `pi.extensions` 数组中添加 `"packages/prompt-snippets"`
- [x] 在根 `tsconfig.json` 的 `references` 数组中添加 `{ "path": "packages/prompt-snippets" }`
- [x] 运行 `npm run format`
- [x] 验证：`npx tsc --build` 通过（此时无源文件，应无报错或仅缺入口文件的 warning）

---

## Phase 2: 包发现模块 — `discover.ts`

### Step 2.1 — 实现 `readSettingsPackages`

**设计关联：** [D3.3 包发现机制](./DESIGN.md#d33-包发现机制)、[D3.5 辅助函数 `readSettingsPackages`](./DESIGN.md#d35-辅助函数)

- [x] 创建 `packages/prompt-snippets/discover.ts`
- [x] 实现 `readSettingsPackages(settingsPath: string): string[]`
  - [x] 读取指定路径的 `settings.json`，提取 `packages` 数组
  - [x] 文件不存在或解析失败时返回空数组

### Step 2.2 — 实现 `resolvePackages`

**设计关联：** [D3.5 辅助函数 `resolvePackages`](./DESIGN.md#d35-辅助函数)

- [x] 实现 `resolvePackages(packages: string[], baseDir: string): string[]`
  - [x] 绝对路径原样返回
  - [x] 相对路径基于 `baseDir` 通过 `path.resolve` 解析
  - [x] 跳过不存在的路径
  - [x] 跳过非目录路径

### Step 2.3 — 实现 `readPiSnippets`

**设计关联：** [D3.2 `pi.snippets` 声明格式](./DESIGN.md#d32-pisnippets-声明格式)、[D3.5 辅助函数 `readPiSnippets`](./DESIGN.md#d35-辅助函数)

- [x] 实现 `readPiSnippets(packageRoot: string): string[]`
  - [x] 读取 `packageRoot/package.json`，提取 `pi.snippets` 字段
  - [x] 无 `pi` manifest 或无 `snippets` 时返回空数组
  - [x] 文件不存在时返回空数组

### Step 2.4 — 实现 `readPkgName`

**设计关联：** [D3.5 辅助函数 `readPkgName`](./DESIGN.md#d35-辅助函数)

- [x] 实现 `readPkgName(packageRoot: string): string`
  - [x] 读取 `package.json` 的 `name` 字段
  - [x] 不存在时返回 `path.basename(packageRoot)` 作为 fallback

### Step 2.5 — 实现 `expandExtensionSubpackages`

**设计关联：** [D3.6 关于根包 `pi.extensions` 指向的子包](./DESIGN.md#d36-关于根包-piextensions-指向的子包)

- [x] 实现 `expandExtensionSubpackages(packageRoot: string): string[]`
  - [x] 读取 `package.json` 的 `pi.extensions` 字段
  - [x] 对每个 entry 解析为绝对路径
  - [x] entry 指向文件时取 `dirname`
  - [x] 仅当目标目录存在 `package.json` 时才返回（避免误入非包目录）
  - [x] 无 `pi.extensions` 时返回空数组

### Step 2.6 — 实现 `collectSnippetDirs`

**设计关联：** [D3.4 发现算法](./DESIGN.md#d34-发现算法)、[D3.7 完整优先级](./DESIGN.md#d37-完整优先级最终版)

- [x] 实现 `collectSnippetDirs(cwd: string, agentDir: string): SnippetSource[]`
- [x] 按以下顺序收集（低优先级→高优先级，保证后 set 覆盖先 set）：
  - [x] 用户级固定目录 `<agentDir>/snippets/`，source = `"user"`
  - [x] 用户 `settings.json` → `packages` → 各包的 `pi.snippets`，source = `"package:<name>"`
  - [x] 用户 `settings.json` → `packages` → 各根包 → `expandExtensionSubpackages` → 子包的 `pi.snippets`
  - [x] 项目级固定目录 `<cwd>/.pi/snippets/`，source = `"project"`
  - [x] 项目 `settings.json` → `packages` → 各包的 `pi.snippets`
  - [x] 项目 `settings.json` → `packages` → 各根包 → `expandExtensionSubpackages` → 子包的 `pi.snippets`
  - [x] 项目根 `package.json` → `pi.extensions` → `expandExtensionSubpackages` → 子包的 `pi.snippets`
- [x] 跳过不存在的目录
- [x] 导出 `SnippetSource` 接口 `{ dir: string; source: string }`
- [x] 运行 `npm run format`
- [x] 验证：`npx tsc --build packages/prompt-snippets` 通过

### Step 2.7 — 创建 `discover.test.ts`

**设计关联：** [D9.1 `discover.test.ts`](./DESIGN.md#d91-discovertestts)

- [x] 创建 `packages/prompt-snippets/discover.test.ts`
- [x] 使用临时目录模拟文件系统
- [x] `resolvePackages` 测试：
  - [x] 绝对路径原样返回
  - [x] 相对路径基于 baseDir 解析
  - [x] 不存在的路径被跳过
  - [x] 非目录路径被跳过
  - [x] 去重解析路径
- [x] `readPiSnippets` 测试：
  - [x] 有 `pi.snippets` 的 package.json 返回数组
  - [x] 无 `pi` manifest 返回空数组
  - [x] 有 `pi` 但无 `snippets` 返回空数组
  - [x] 文件不存在返回空数组
- [x] `readPkgName` 测试：
  - [x] 有 `name` 字段返回值
  - [x] 无 `name` 字段返回 `basename`
  - [x] 无 `package.json` 返回 `basename`
- [x] `expandExtensionSubpackages` 测试：
  - [x] 有 `pi.extensions` 且子目录含 `package.json` → 返回子包路径
  - [x] 子目录无 `package.json` → 跳过
  - [x] entry 指向文件 → 取 dirname
  - [x] 无 `pi.extensions` → 返回空数组
- [x] `collectSnippetDirs` 测试：
  - [x] 用户级固定目录存在时包含
  - [x] 用户级固定目录不存在时跳过
  - [x] packages 中声明的包的 `pi.snippets` 被展开
  - [x] 根包 `pi.extensions` 指向的子包的 `pi.snippets` 被展开
  - [x] 项目级路径排在用户级之后（优先级更高）
  - [x] 跳过不存在的 snippet 目录
- [x] 验证：`npx vitest run packages/prompt-snippets/discover.test.ts` 全部通过（22 tests）

---

## Phase 3: 核心逻辑模块 — `snippets.ts`

### Step 3.1 — 实现 `parseSnippet`

**设计关联：** [D2 Snippet 解析结果](./DESIGN.md#snippet-解析结果)、[D5 Frontmatter 解析](./DESIGN.md#frontmatter-解析)

- [ ] 创建 `packages/prompt-snippets/snippets.ts`
- [ ] 定义并导出 `Snippet` 接口（name, filePath, description, argumentHint, body, source）
- [ ] 实现 `parseSnippet(filePath: string, source: string): Snippet`
  - [ ] 读取文件，`basename(path, ".md")` 为 name
  - [ ] 正则匹配 `^---\n([\s\S]*?)\n---\n?([\s\S]*)$` 提取 frontmatter 和 body
  - [ ] 从 frontmatter 提取 `description` 和 `argument-hint`
  - [ ] 无 frontmatter 时 body = 全文
  - [ ] body 执行 `.trim()`

### Step 3.2 — 实现 `expandPositional` 与 `expandSnippet`

**设计关联：** [D5 模板展开算法](./DESIGN.md#模板展开算法)

- [ ] 实现 `expandPositional(body: string, args: string[]): string`
  - [ ] 替换 `${@:N:L}` — 最具体，先处理
  - [ ] 替换 `${@:N}` — 次之
  - [ ] 替换 `$@` 和 `$ARGUMENTS` — 全参数拼接
  - [ ] 替换 `$1`, `$2`, ... — 位置参数，越界为空字符串
- [ ] 实现 `expandSnippet(snippet: Snippet, rawArgs: string): string`
  - [ ] 空参数 → `args = []`
  - [ ] 否则 `rawArgs.trim().split(/\s+/)`
  - [ ] 调用 `expandPositional(snippet.body, args)`

### Step 3.3 — 实现 `discoverSnippets`

**设计关联：** [D3.4 发现算法](./DESIGN.md#d34-发现算法)、[D3.7 完整优先级](./DESIGN.md#d37-完整优先级最终版)

- [ ] 实现 `discoverSnippets(cwd: string, agentDir: string): Snippet[]`
  - [ ] 调用 `collectSnippetDirs(cwd, agentDir)` 获取 `SnippetSource[]`
  - [ ] 对每个 source 的 `dir`，glob `*.md` 文件
  - [ ] 每个文件调用 `parseSnippet(file, source.source)`
  - [ ] 用 `Map<name, Snippet>` 收集，后写覆盖先写（保证高优先级胜出）
  - [ ] 返回按 name 排序的数组

### Step 3.4 — 实现 `listSnippets`

**设计关联：** [D4 命令设计 — 列表展示](./DESIGN.md#列表展示)

- [ ] 实现 `listSnippets(snippets: Snippet[], ctx: ExtensionCommandContext): void`
  - [ ] 无 snippet 时提示 "No snippets found. Create …"
  - [ ] 有 snippet 时格式化为对齐列表：
    - [ ] 每行：名称（左对齐）、描述、argument-hint、来源标签 `[source]`
  - [ ] 末尾统计总数
  - [ ] 通过 `ctx.ui.notify(formatted, "info")` 输出

### Step 3.5 — 实现 `registerSnippetCommand`

**设计关联：** [D4 命令设计 — 命令格式](./DESIGN.md#命令格式)、[D4 命令设计 — 处理流程](./DESIGN.md#处理流程)

- [ ] 实现并导出 `registerSnippetCommand(pi: ExtensionAPI): void`
- [ ] 注册 `/snippet` 命令，handler 逻辑：
  - [ ] 解析 args：空或 `list` → 调用 `listSnippets`
  - [ ] 非空 → 查找 snippet by name
    - [ ] 未找到 → `ctx.ui.notify("snippet not found", "error")`; return
    - [ ] 找到 → `expandSnippet(snippet, remainingArgs)`
  - [ ] 发送前检查 `ctx.isIdle()`
    - [ ] 忙碌 → `ctx.ui.notify("Agent is busy…", "warning")`; return
  - [ ] 调用 `pi.sendUserMessage(expanded)` 发送展开后的内容
- [ ] 运行 `npm run format`
- [ ] 验证：`npx tsc --build packages/prompt-snippets` 通过

### Step 3.6 — 创建 `snippets.test.ts`

**设计关联：** [D9.2 `snippets.test.ts`](./DESIGN.md#d92-snippetstestts)

- [ ] 创建 `packages/prompt-snippets/snippets.test.ts`
- [ ] `parseSnippet` 测试：
  - [ ] 有 frontmatter → 正确提取 description、argumentHint、body
  - [ ] 无 frontmatter → body 为全文
  - [ ] 空 body → 返回空字符串
  - [ ] frontmatter 中仅有 description → argumentHint 为空
- [ ] `expandPositional` 测试：
  - [ ] `$1`, `$2` 替换
  - [ ] `$ARGUMENTS` 替换为所有参数拼接
  - [ ] `$@` 替换为所有参数拼接
  - [ ] `${@:2}` 从第二个参数开始
  - [ ] `${@:2:3}` 从第二个参数取三个
  - [ ] 越界位置参数替换为空字符串
  - [ ] 混合使用多种变量类型
  - [ ] 无参数时所有变量替换为空
- [ ] `discoverSnippets` 测试（使用临时目录）：
  - [ ] 多来源正确合并
  - [ ] 高优先级同名 snippet 覆盖低优先级
  - [ ] 目录不存在时返回空数组
- [ ] 命令处理测试（mock `pi` 和 `ctx`）：
  - [ ] `/snippet list` 无 snippet 时提示创建
  - [ ] `/snippet list` 有 snippet 时输出对齐列表
  - [ ] `/snippet <name>` 未找到时通知错误
  - [ ] `/snippet <name>` agent 忙碌时通知警告
  - [ ] `/snippet <name>` agent 空闲且找到 → 调用 `sendUserMessage`
- [ ] 验证：`npx vitest run packages/prompt-snippets/snippets.test.ts` 全部通过

---

## Phase 4: 扩展入口与集成

### Step 4.1 — 创建 `index.ts`

**设计关联：** [D5 `index.ts` — 扩展入口](./DESIGN.md#indexts--扩展入口)

- [ ] 创建 `packages/prompt-snippets/index.ts`
  - [ ] 导入 `ExtensionAPI` 类型
  - [ ] 导入 `registerSnippetCommand` from `./snippets.ts`
  - [ ] `export default function(pi: ExtensionAPI): void` 调用 `registerSnippetCommand(pi)`
- [ ] 运行 `npm run format`
- [ ] 验证：`npx tsc --build`（完整项目）通过

### Step 4.2 — 全项目 gate

**设计关联：** [D7 集成点](./DESIGN.md#d7-集成点)

- [ ] `npx tsc --build` — 必须通过
- [ ] `npm test` — 所有测试通过（含新测试）
- [ ] `npm run format`

---

## Phase 5: 端到端手动验证

### Step 5.1 — 基础命令测试

**设计关联：** [D4 命令格式](./DESIGN.md#命令格式)

- [ ] 启动 pi，输入 `/snippet` → 显示空列表或提示创建目录
- [ ] 创建 `~/.pi/agent/snippets/test.md`（简单内容，无 frontmatter）
- [ ] 输入 `/snippet list` → 显示刚创建的 snippet
- [ ] 输入 `/snippet test` → agent 收到展开后的内容并响应

### Step 5.2 — 模板展开验证

**设计关联：** [D5 模板展开算法](./DESIGN.md#模板展开算法)、[D8 使用示例](./DESIGN.md#d8-使用示例)

- [ ] 创建带 frontmatter 和模板变量的 snippet：
  ```markdown
  ---
  description: 审查文件
  argument-hint: <file>
  ---
  审查 $1 的代码。额外要求：${@:2}
  ```
- [ ] `/snippet review src/app.ts "注意安全"` → 验证展开结果包含 `src/app.ts` 和 `注意安全`

### Step 5.3 — `pi.snippets` 包发现验证

**设计关联：** [D3.2 `pi.snippets` 声明格式](./DESIGN.md#d32-pisnippets-声明格式)、[D3.6 关于根包 `pi.extensions` 指向的子包](./DESIGN.md#d36-关于根包-piextensions-指向的子包)

- [ ] 在某个已有子包（如 `packages/memory`）中：
  - [ ] 在 `package.json` 添加 `"snippets": ["./snippets"]`
  - [ ] 创建 `packages/memory/snippets/self-improve.md`
- [ ] 启动 pi，`/snippet list` → 验证包内 snippet 出现且来源显示 `[package:@htwang-contrib/memory]`
- [ ] `/snippet self-improve` → 验证触发 agent 回合

### Step 5.4 — 优先级覆盖验证

**设计关联：** [D3.7 完整优先级](./DESIGN.md#d37-完整优先级最终版)

- [ ] 在 `~/.pi/agent/snippets/review.md` 创建用户级 snippet
- [ ] 在项目 `.pi/snippets/review.md` 创建同名项目级 snippet（内容不同）
- [ ] `/snippet list` → 两个来源都显示，但项目级覆盖用户级
- [ ] `/snippet review` → 验证发送的是项目级内容

---

## 依赖关系图

```
Step 1.1 ─┐
Step 1.2 ─┤
Step 1.3 ─┴→ Phase 1 gate
                │
                ▼
Step 2.1 ─┐
Step 2.2 ─┤
Step 2.3 ─┤
Step 2.4 ─┼→ Step 2.5 → Step 2.6 → Step 2.7
Step 2.5 ─┤                              │
           │                         Phase 2 gate
                │                         │
                ▼                         ▼
Step 3.1 ─┐
Step 3.2 ─┤
Step 3.3 ─┤  (依赖 Phase 2 的 collectSnippetDirs)
Step 3.4 ─┼→ Step 3.5 → Step 3.6
           │                  │
           │             Phase 3 gate
                │                │
                ▼                ▼
           Step 4.1 → Step 4.2
                         │
                    Phase 4 gate
                         │
                         ▼
           Step 5.1 ─┐
           Step 5.2 ─┤
           Step 5.3 ─┼→ 完成
           Step 5.4 ─┘
```

**可并行步骤：**
- Step 2.1–2.4 之间无依赖，可并行
- Step 3.1、3.2 之间无依赖，可并行
- Step 5.1–5.4 之间无依赖，可并行

**关键依赖链：**
- `collectSnippetDirs`（2.6）是 `discoverSnippets`（3.3）的前置
- `discover.ts` 全部（Phase 2）是 `snippets.ts` 的前置
- Phase 4 依赖 Phase 3 完成
- Phase 5 依赖 Phase 4 完成
