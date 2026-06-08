# Web Tools 实现步骤

> 每步标注对应的 DESIGN.md 章节，方便实现时对照。

## Checklist

### Phase 1 — 核心骨架

- [x] **Step 1:** 包脚手架 + 类型定义 — §2.2, §3.2, §3.5
- [x] **Step 2:** Provider 注册表 + 工厂 — §3.3
- [x] **Step 3:** HTTP 工具 + HTML-to-text + SSRF 防护 — §5, §2.3
- [x] **Step 4:** Brave Provider（search-only） — §3.1
- [x] **Step 5:** web_search 工具注册 — §7, §2.3
- [x] **Step 6:** Tavily Provider（full） — §3.1
- [x] **Step 7:** web_fetch 工具注册 + 三级调度 — §7, §2.3, §5
- [x] **Step 8:** 配置系统集成 — §6
- [x] **Step 9:** 工具渲染适配器 — §8.1
- [ ] **Step 10:** 入口文件 — §2.1
- [ ] **Step 11:** 根配置集成 + 端到端验证 — §6.6

### Phase 2 — 扩展 Provider

- [ ] **Step 12:** search-only Provider（Serper, Perplexity） — §3.1
- [ ] **Step 13:** full Provider（Exa, You.com, Jina, Firecrawl） — §3.1
- [ ] **Step 14:** GitHub URL 拦截器 — §4

### Phase 3 — 生态集成

- [ ] **Step 15:** subagent 工具白名单集成 — §8.3
- [ ] **Step 16:** protect-secrets URL 检查 — §8.5
- [ ] **Step 17:** Z.AI MCP Provider — §10.4
- [ ] **Step 18:** 迁移 web_search_prime / web_read_prime — §10.4
- [ ] **Step 19:** 清理遗留 — §10.4

---

## Phase 1 — 核心骨架

### Step 1: 包脚手架 + 类型定义

创建 `packages/web-tools/` 包结构。

**产出文件：**

- `packages/web-tools/package.json` — 声明 `pi.extensions`、`peerDependencies`、对 `@htwang-contrib/common` 的依赖
- `packages/web-tools/tsconfig.json` — 项目引用
- `packages/web-tools/providers/types.ts` — 核心类型

**实现内容：**

定义 Provider 角色分离的类型体系：

```
SearchResult / SearchResponse / FetchResponse
SearchProvider      — search() only
FetchProvider       — fetch() only (接口，无独立实现)
FullProvider        — search() + fetch()
ProviderMeta        — 元数据注册表条目
```

> **参考：** DESIGN.md §2.2 核心类型层次、§3.2 Provider 接口、§3.5 Provider 元数据
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/providers/types.ts`

---

### Step 2: Provider 注册表 + 工厂

**产出文件：**

- `packages/web-tools/providers/index.ts` — `PROVIDERS` 元数据数组
- `packages/web-tools/providers/factory.ts` — `createSearchProvider()` 工厂函数

**实现内容：**

- `PROVIDERS: readonly ProviderMeta[]` — 声明所有支持的 provider 元数据（初始只放 Brave + Tavily，后续扩展）
- `createSearchProvider(name, { apiKey })` — 按 name switch 创建实例，返回 `SearchProvider | FullProvider`
- 导出类型供外部消费

> **参考：** DESIGN.md §3.3 工厂模式
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/providers/index.ts`、`factory.ts`

---

### Step 3: HTTP 工具 + HTML-to-text + SSRF 防护

**产出文件：**

- `packages/web-tools/providers/fetch-helpers.ts`

**实现内容：**

1. **htmlToText(html)** — 正则剥离 `<script>`/`<style>`/`<noscript>`，块标签转换行，HTML 实体解码，空白折叠
2. **extractTitle(html)** — 提取 `<title>` 内容
3. **isHtmlContentType(ct)** / **assertTextContentType(ct)** — 内容类型判断 + 二进制拒绝
4. **fetchUrlOrThrow(url, signal)** — HTTP GET + 非 2xx 抛错
5. **fetchViaGenericHtml(url, raw, signal)** — 一站式 fetch 管线：请求 → 类型断言 → 提取文本
6. **isPrivateOrLoopbackHostname(host)** — SSRF 防护
7. **parseAndAssertHttpUrl(raw)** — URL 解析 + 协议检查 + SSRF 防护

> **参考：** DESIGN.md §5 安全机制（§5.1 SSRF 防护、§5.2 内容类型防护）、§2.3 通用 HTML 管线（第 3 级调度）
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/providers/fetch-helpers.ts`、`web-tools.ts` 中的 `isPrivateOrLoopbackHostname` / `parseAndAssertHttpUrl`

---

### Step 4: Brave Provider（search-only）

**产出文件：**

- `packages/web-tools/providers/brave.ts`

**实现内容：**

- `BraveProvider implements SearchProvider` — 只有 `search()` 方法
- `BRAVE_PROVIDER_META` — name/label/envVar/roles 元数据
- 调用 Brave Search API (`https://api.search.brave.com/res/v1/web/search`)
- GET 请求，`X-Subscription-Token` header，返回 JSON → 标准化 `SearchResult[]`
- 无 API key 时抛错，含可操作的提示信息

> **参考：** DESIGN.md §3.1 Provider 分类（Brave 行）、§3.2 SearchProvider 接口
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/providers/brave.ts`

---

### Step 5: web_search 工具注册

**产出文件：**

- `packages/web-tools/search/index.ts`
- `packages/web-tools/search/prompt.txt`

**实现内容：**

用 `pi.registerTool()` 注册 `web_search` 工具：

- **参数**：`query: string`（必填）、`max_results: number`（1-10，默认 5）
- **执行流程**：
  1. `loadConfig()` → `instantiateActiveProvider()`
  2. `provider.search(query, maxResults, signal)`
  3. 格式化为 Markdown 编号列表
- **返回**：`{ content: [...], details: { query, backend, resultCount, results } }`
- **中途更新**（`onUpdate`）：显示 "Searching {provider} for: ..."
- 使用 typebox `Type.Object` 定义参数 schema
- 不自带 `renderCall` / `renderResult`（由 tool-display 处理）

> **参考：** DESIGN.md §7 web_search Schema、§2.3 web_search 执行流程、§8.4 extra-tools 工具注册模式
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/web-tools.ts` → `registerWebSearchTool()`

---

### Step 6: Tavily Provider（full）

**产出文件：**

- `packages/web-tools/providers/tavily.ts`

**实现内容：**

- `TavilyProvider implements FullProvider` — `search()` + `fetch()`
- `TAVILY_PROVIDER_META`
- `search()` — POST `https://api.tavily.com/search`，body 含 `api_key` + `query` + `max_results`
- `fetch()` — POST `https://api.tavily.com/extract`，Bearer 鉴权，返回 `raw_content`
- 处理 Tavily 特有的错误格式（`failed_results`）

> **参考：** DESIGN.md §3.1 Provider 分类（Tavily 行，FullProvider 角色）
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/providers/tavily.ts`

---

### Step 7: web_fetch 工具注册 + 三级调度

**产出文件：**

- `packages/web-tools/fetch/index.ts`
- `packages/web-tools/fetch/prompt.txt`

**实现内容：**

用 `pi.registerTool()` 注册 `web_fetch` 工具：

- **参数**：`url: string`（必填）、`raw: boolean`（可选，默认 false）
- **执行流程**（三级调度，Design §2.3）：
  1. `parseAndAssertHttpUrl(url)` — SSRF 防护（§5.1）
  2. `loadConfig()` → `instantiateActiveProvider()`
  3. 第 1 级：URL 拦截器链（当前为空，Phase 2 加入 GitHub）
  4. 第 2 级：`"fetch" in provider` → `provider.fetch(url, raw, signal)`（Tavily 等原生 fetch）
  5. 第 3 级：`fetchViaGenericHtml(url, raw, signal)`（通用 HTML 管线）
  6. `truncateHead()` 截断超限内容
  7. 如被截断 → `spillFullContentToTempFile()` 写入临时文件
- **返回**：`{ content: [...], details: { url, title, contentType, contentLength, truncation?, fullOutputPath? } }`

**使用本仓库的截断工具：**

```typescript
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@earendil-works/pi-coding-agent";
```

> **参考：** DESIGN.md §7 web_fetch Schema、§2.3 web_fetch 三级调度、§5 安全机制、§10.2 输出截断
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/web-tools.ts` → `registerWebFetchTool()`

---

### Step 8: 配置系统集成

**产出文件：**

- `packages/web-tools/config.ts`

**实现内容：**

1. **定义 `WebToolsConfig` 接口 + `CONFIG_SCHEMA`**（§6.3）

   ```typescript
   interface WebToolsConfig {
     provider: string;
     apiKeys: Record<string, string>;
   }
   ```

2. **配置读写函数**

   ```typescript
   import {
     readConfig,
     updateConfig,
     type ExtensionConfigSchema,
   } from "@htwang-contrib/common";
   function loadConfig(): WebToolsConfig {
     return readConfig("web-tools", CONFIG_SCHEMA);
   }
   ```

3. **API Key 解析**（§3.4 优先级：env var → config file）

   ```typescript
   function resolveApiKey(providerName: string): string | undefined;
   ```

4. **注册 ConfigItem**（§6.3）
   - `provider` — select 类型，options 列出所有 Provider
   - `apiKeys.brave` 等 — string + secret: true，每个 Provider 一条

5. **`instantiateActiveProvider()`** — 读取 active provider name + 调用 `resolveApiKey` + `createSearchProvider`

> **参考：** DESIGN.md §6 配置系统（§6.1 现有基础设施、§6.2 ConfigItem 类型、§6.3 配置项设计、§6.4 读取策略）
>
> **参考实现：** `packages/tool-display/config.ts`（ConfigItem 注册模式）、`packages/committer/index.ts`（ConfigItem 注册示例）

---

### Step 9: 工具渲染适配器

**产出文件：**

- `packages/tool-display/adapters/web-search.ts`
- `packages/tool-display/adapters/web-fetch.ts`
- 修改 `packages/tool-display/registry.ts`

**实现内容：**

实现 `ToolDisplayAdapter` 接口（§8.1）：

**web-search.ts：**

- `formatCallHeader` — `WebSearch "query"`
- `formatCollapsedContent` — 显示 result count，isPartial 时显示 "searching…"
- `formatExpandedContent` — 调用 `formatExpandedToolOutputLines`

**web-fetch.ts：**

- `formatCallHeader` — `WebFetch https://...`
- `formatCollapsedContent` — 显示标题 + truncated 标记，isPartial 时显示 "fetching…"
- `formatExpandedContent` — 调用 `formatExpandedToolOutputLines`

**registry.ts 新增：**

```typescript
globalToolDisplayRegistry.register("web_search", webSearchAdapter);
globalToolDisplayRegistry.register("web_fetch", webFetchAdapter);
```

> **参考：** DESIGN.md §8.1 tool-display 渲染适配器
>
> **参考实现：** `packages/tool-display/adapters/web-search-prime.ts`、`packages/tool-display/adapters/web-read-prime.ts`

---

### Step 10: 入口文件

**产出文件：**

- `packages/web-tools/index.ts`

**实现内容：**

默认导出函数 `(pi: ExtensionAPI) => void`，按序调用：

1. `registerConfigItems("web-tools", [...])` — 配置注册（Step 8）
2. 注册 `web_search` 工具（Step 5）
3. 注册 `web_fetch` 工具（Step 7）

导出公共类型（供外部消费）：

- `SearchProvider` / `FullProvider` / `ProviderMeta`
- `createSearchProvider` 工厂函数
- 配置相关类型

> **参考：** DESIGN.md §2.1 文件结构、§8.4 extra-tools 包结构
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/index.ts`

---

### Step 11: 根配置集成

**产出文件：**

- 更新根 `package.json`（如需将 web-tools 加入 `pi.extensions`）
- 更新根 `tsconfig.json`（添加项目引用）

**验证：**

- `npx tsc --build` 通过
- `npm test` 通过
- 启动 pi session → `/config` 能看到 Web Tools tab + 所有配置项
- 设置 Brave API key → `web_search` 能返回结果
- 设置 Tavily API key → `web_search` + `web_fetch` 能返回结果
- 无 API key 时 `web_search` 返回可操作的错误信息

> **参考：** DESIGN.md §6.6 /config 覆盖验证

---

## Phase 2 — 扩展 Provider

### Step 12: 添加其余 search-only Provider

**产出文件：**

- `packages/web-tools/providers/serper.ts`
- `packages/web-tools/providers/perplexity.ts`

每个 Provider 实现 `SearchProvider` 接口，导出 `PROVIDER_META`，注册到 `PROVIDERS` 数组。

同步更新：

- `config.ts` — `registerConfigItems` 中添加对应 API Key 配置项

> **参考：** DESIGN.md §3.1 Provider 分类表（Serper、Perplexity 行）
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/providers/serper.ts`、`perplexity.ts`

---

### Step 13: 添加其余 full Provider

**产出文件：**

- `packages/web-tools/providers/exa.ts`
- `packages/web-tools/providers/youcom.ts`
- `packages/web-tools/providers/jina.ts`
- `packages/web-tools/providers/firecrawl.ts`

每个 Provider 实现 `FullProvider` 接口（search + fetch），导出 `PROVIDER_META`。

同步更新：

- `config.ts` — `registerConfigItems` 中添加对应 API Key 配置项
- `PROVIDERS` 数组

> **参考：** DESIGN.md §3.1 Provider 分类表（Exa、You.com、Jina、Firecrawl 行）
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/providers/exa.ts`、`youcom.ts`、`jina.ts`、`firecrawl.ts`

---

### Step 14: GitHub URL 拦截器

**产出文件：**

- `packages/web-tools/interceptors/types.ts` — `UrlInterceptor` 接口
- `packages/web-tools/interceptors/index.ts` — 拦截器链管理
- `packages/web-tools/interceptors/github.ts` — GitHub 仓库内容拦截器

**实现内容：**

1. `UrlInterceptor` 接口（§4.1）
2. `GitHubInterceptor` — 解析 github.com URL，按类型返回仓库内容（§4.2）
   - `gh` CLI 优先 → `git clone` 回退
   - 超大仓库走 `gh api` JSON 视图
   - `owner/repo@ref` 缓存
3. 拦截器链管理 — `buildInterceptors()` / `getInterceptors()`
4. 配置集成 — `githubInterceptorEnabled` boolean + `githubMaxRepoSizeMB` number

同步更新：

- `web_fetch` 执行流程中启用拦截器链（Step 7 预留的 slot）
- `config.ts` — 添加 GitHub 拦截器配置项

> **参考：** DESIGN.md §4 URL 拦截器机制（§4.1 接口、§4.2 GitHub 拦截器、§4.3 启用方式）
>
> **参考实现：** `/tmp/rpiv-mono-ref/packages/rpiv-web-tools/providers/interceptors/`

---

## Phase 3 — 生态集成

### Step 15: subagent 工具白名单集成

**修改文件：**

- `packages/subagents/child-tools.ts`
- `packages/subagents/run-agent.ts`

**改动：**

1. `READ_ONLY_TOOLS` 加入 `"web_search"`、`"web_fetch"`
2. `FULL_BUILTIN_TOOLS` 加入 `"web_search"`、`"web_fetch"`
3. `CHILD_SESSION_EXTENSION_FACTORIES` 加入 web-tools 工厂

> **参考：** DESIGN.md §8.3 subagents — 子代理中的 web 访问

---

### Step 16: protect-secrets URL 检查

**修改文件：**

- `packages/protect-secrets/` 相关文件

**改动：**

在 `tool_call` 钩子中增加对 `web_fetch` / `web_search` 的 URL/query 检查，防止敏感信息通过 web 请求泄露。

> **参考：** DESIGN.md §8.5 protect-secrets — URL 安全防护

---

### Step 17: Z.AI MCP Provider

**产出文件：**

- `packages/web-tools/providers/zai.ts`

**实现内容：**

1. **`ZaiProvider`** 实现 `FullProvider` 接口（search + fetch）
   - `search()` — 调用 `mcpInit` + `mcpCall`，MCP endpoint `web_search_prime/mcp`，tool `web_search_prime`
   - `fetch()` — 调用 `mcpInit` + `mcpCall`，MCP endpoint `web_reader/mcp`，tool `webReader`
   - 响应解析：Z.AI 返回的 `content[0].text` 可能被多层 JSON 编码，需最多 3 轮 `JSON.parse`
   - `search()` 将 `WebSearchResult[]` 映射为标准 `SearchResult[]`（`link` → `url`，`content` → `snippet`）
   - `fetch()` 返回标准 `FetchResponse`（`title`，`content` → `text`）

2. **Provider 元数据注册**
   - `ZAI_PROVIDER_META` — `name: "zai"`，`label: "Z.AI"`，`envVar: "ZAI_API_KEY"`，`roles: ["search", "fetch"]`
   - 添加到 `PROVIDERS` 数组

3. **工厂扩展**
   - `createSearchProvider` 的 `switch` 加入 `"zai"` 分支 → `new ZaiProvider(apiKey)`

4. **配置更新**
   - `registerWebToolsConfigItems` 的 provider options 和 apiKeys 自动覆盖（已通过 `PROVIDERS` 数组驱动）

> **参考：** DESIGN.md §10.1 Z.AI MCP Provider 设计
>
> **参考实现：** `packages/zai-coding-plan/search.ts`（`zaiWebSearch` / `zaiWebRead` 的 MCP 调用逻辑）

---

### Step 18: 迁移 `web_search_prime` / `web_read_prime` 到 web-tools

**修改文件：**

- `packages/zai-coding-plan/index.ts`
- `packages/zai-coding-plan/search.ts`
- `packages/web-tools/search/index.ts`
- `packages/web-tools/fetch/index.ts`

**实现内容：**

1. **`zai-coding-plan/index.ts` 移除工具注册**
   - 删除 `web_search_prime` / `web_read_prime` 的 `pi.registerTool()` 调用
   - 删除 `session_start` 中将这两个工具加入 `setActiveTools` 的逻辑
   - 保留 provider 注册、quota 命令、事件钩子等不变
   - `search.ts` 中 `zaiWebSearch` / `zaiWebRead` 函数可以删除（逻辑已迁移到 `ZaiProvider`）

2. **`web-tools` 统一入口**
   - 当 active provider 为 `"zai"` 时，`web_search` 和 `web_fetch` 通过 `ZaiProvider` 走 MCP
   - 工具名保持 `web_search` / `web_fetch`，不再注册 `web_search_prime` / `web_read_prime`

3. **tool-display 适配器**
   - `web_search_prime` / `web_read_prime` 适配器可保留（兼容过渡期），也可一并移除

4. **验证**
   - 设置 `ZAI_API_KEY` + `provider: "zai"`，确认 `web_search` / `web_fetch` 端到端工作
   - 确认 `zai-coding-plan` 的 provider/quota 功能不受影响

> **参考：** DESIGN.md §10.2 迁移策略

---

### Step 19: 清理遗留

**修改文件：**

- `packages/tool-display/registry.ts`
- `packages/tool-display/adapters/web-search-prime.ts`
- `packages/tool-display/adapters/web-read-prime.ts`
- `packages/zai-coding-plan/search.ts`

**实现内容：**

1. 移除 `web_search_prime` / `web_read_prime` 的 tool-display 适配器及注册
2. 删除 `packages/zai-coding-plan/search.ts`（如 Step 18 未清理）
3. 最终验证全量 `tsc --build` 和 `npm test` 通过

> **参考：** DESIGN.md §10.3 清理

---

## 步骤与 DESIGN.md 章节对照表

| Step | 主要 DESIGN 章节     | 涉及章节            |
| ---- | -------------------- | ------------------- |
| 1    | §2.2 类型层次        | §3.2、§3.5          |
| 2    | §3.3 工厂模式        | §3.5                |
| 3    | §5 安全机制          | §2.3（第 3 级调度） |
| 4    | §3.1 Brave 行        | §3.2                |
| 5    | §7 web_search Schema | §2.3 执行流程、§8.4 |
| 6    | §3.1 Tavily 行       | §3.2 FullProvider   |
| 7    | §7 web_fetch Schema  | §2.3 三级调度、§5   |
| 8    | §6 配置系统          | §3.4、§6.1–6.4      |
| 9    | §8.1 tool-display    | —                   |
| 10   | §2.1 文件结构        | §8.4                |
| 11   | §6.6 验证            | —                   |
| 12   | §3.1 Provider 分类   | —                   |
| 13   | §3.1 Provider 分类   | —                   |
| 14   | §4 URL 拦截器        | §4.1–4.3            |
| 15   | §8.3 subagents       | —                   |
| 16   | §8.5 protect-secrets | —                   |
| 17   | §10.1 Z.AI Provider   | §3.1、§3.3        |
| 18   | §10.2 迁移策略        | §8.2               |
| 19   | §10.3 清理            | —                  |
