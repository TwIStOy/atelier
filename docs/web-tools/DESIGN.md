# Web Tools 模块设计文档

> 基于 [rpiv-web-tools](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-web-tools) 的研究与总结。

## 1. 项目概览

`rpiv-web-tools` 是一个 Pi 扩展，为 AI Agent 提供两大核心能力：

- **`web_search`** — 搜索引擎查询，返回标题、URL、摘要
- **`web_fetch`** — 抓取网页内容，支持 HTML 转文本、原始 HTML、大页面溢出到临时文件

同时提供 **可插拔的后端 Provider 体系**（8 种搜索引擎）和 **URL 拦截器机制**（如 GitHub 仓库内容提取）。

### 核心特性

| 特性                   | 说明                                                        |
| ---------------------- | ----------------------------------------------------------- |
| 可插拔 Provider        | 8 种搜索引擎后端，运行时可切换                              |
| SSRF 防护              | 拒绝 loopback / RFC 1918 / link-local / cloud-metadata 地址 |
| 大页面溢出             | 超限内容截断 + 写入临时文件供模型按需读取                   |
| GitHub URL 拦截器      | 将 github.com URL 路由到 `gh`/`git` 获取仓库结构/文件内容   |
| 交互式配置             | `/web-tools` 命令选择 Provider 并设置 API Key               |
| Executor Guidance 覆盖 | 可在配置文件中自定义工具的 promptSnippet / promptGuidelines |

## 2. 架构设计

### 2.1 文件结构

```
rpiv-web-tools/
├── index.ts              # 入口：注册工具 + 命令，导出公共类型
├── web-tools.ts          # 核心编排：工具注册、执行、渲染、/web-tools 命令
├── providers/
│   ├── types.ts          # 类型定义：SearchProvider / FetchProvider / FullProvider / ProviderMeta
│   ├── index.ts          # Provider 元数据注册表 (PROVIDERS 数组)
│   ├── factory.ts        # 工厂函数：按 name 创建 Provider 实例
│   ├── config.ts         # 配置读写：~/.config/rpiv-web-tools/config.json
│   ├── fetch-helpers.ts  # 共享 HTTP 工具：htmlToText、SSRF guard、通用 fetch 管线
│   ├── brave.ts          # Brave Search（search-only）
│   ├── tavily.ts         # Tavily（search + fetch）
│   ├── serper.ts         # Serper（search-only）
│   ├── exa.ts            # Exa（search + fetch）
│   ├── youcom.ts         # You.com（search + fetch）
│   ├── jina.ts           # Jina Reader（search + fetch）
│   ├── firecrawl.ts      # Firecrawl（search + fetch）
│   ├── perplexity.ts     # Perplexity（search-only）

│   └── interceptors/
│       ├── types.ts      # UrlInterceptor 接口
│       ├── index.ts      # 拦截器链构建 + 管理
│       └── github.ts     # GitHub 仓库内容拦截器（clone / gh api）
```

### 2.2 核心类型层次

```
SearchProvider          # 只有 search()
  ├── BraveProvider
  └── PerplexityProvider

FetchProvider           # 只有 fetch()
  (无独立实现，仅作为类型接口)

FullProvider = SearchProvider & FetchProvider
  ├── TavilyProvider
  ├── ExaProvider
  ├── YouComProvider
  ├── JinaProvider
  └── FirecrawlProvider

UrlInterceptor          # URL 拦截器
  └── GitHubInterceptor # github.com URL 路由到 gh/git

ProviderMeta            # Provider 元数据（name, label, envVar, roles, configure?）
```

### 2.3 执行流程

#### web_search 执行流程

```
用户调用 web_search({ query, max_results })
  → loadConfig()
  → instantiateActiveProvider(config)     # 读取 active provider + API key
    → resolveProviderApiKey()             # env var → config.apiKeys → legacy apiKey
    → createSearchProvider(name, creds)   # 工厂创建实例
  → provider.search(query, maxResults, signal)
  → 格式化搜索结果为 Markdown 列表
  → 返回 { content, details }
```

#### web_fetch 三级调度

```
用户调用 web_fetch({ url, raw })
  → parseAndAssertHttpUrl(url)           # URL 解析 + SSRF 防护
  → loadConfig() + instantiateActiveProvider()

  → 第 1 级：URL 拦截器链（按注册顺序）
      for interceptor in interceptors:
        result = interceptor.intercept(url, { raw, signal })
        if result: return result          # 拦截器认领了该 URL

  → 第 2 级：Provider 原生 fetch
      if "fetch" in provider:
        result = provider.fetch(url, raw, signal)

  → 第 3 级：通用 HTML 管线
      result = fetchViaGenericHtml(url, raw, signal)
        → fetchUrlOrThrow()              # HTTP 请求
        → assertTextContentType()        # 拒绝二进制
        → extractBodyAsText()            # HTML → text（如需要）

  → truncateHead()                       # 截断超限内容
  → 如被截断 → spillFullContentToTempFile()  # 写入临时文件
  → 返回 { content, details: { truncation, fullOutputPath } }
```

## 3. Provider 体系

### 3.1 Provider 分类

| Provider   | 角色        | 原生 Fetch                | 自托管 | 配置                   |
| ---------- | ----------- | ------------------------- | ------ | ---------------------- |
| Brave      | search-only | ❌ 使用通用 HTML 管线     | ❌     | `BRAVE_SEARCH_API_KEY` |
| Tavily     | full        | ✅ Tavily Extract API     | ❌     | `TAVILY_API_KEY`       |
| Serper     | search-only | ❌ 使用通用 HTML 管线     | ❌     | `SERPER_API_KEY`       |
| Exa        | full        | ✅ 原生提取               | ❌     | `EXA_API_KEY`          |
| You.com    | full        | ✅ 原生提取 (markdown)    | ❌     | `YOUCOM_API_KEY`       |
| Jina       | full        | ✅ Jina Reader (markdown) | ❌     | `JINA_API_KEY`         |
| Firecrawl  | full        | ✅ 原生提取 (markdown)    | ❌     | `FIRECRAWL_API_KEY`    |
| Perplexity | search-only | ❌ 使用通用 HTML 管线     | ❌     | `PERPLEXITY_API_KEY`   |

### 3.2 Provider 接口

```typescript
// search-only provider
interface SearchProvider {
  readonly name: string;
  readonly label: string;
  readonly envVar: string;
  search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResponse>;
}

// 同时支持 search + fetch 的 provider
type FullProvider = SearchProvider & {
  fetch(
    url: string,
    raw: boolean,
    signal?: AbortSignal,
  ): Promise<FetchResponse>;
};
```

### 3.3 工厂模式

`createSearchProvider(name, { apiKey, baseUrl })` 按名称创建 Provider 实例。调用方通过 `"fetch" in provider` 运行时判断能力。

### 3.4 API Key 解析优先级

对每个 Provider，按以下顺序查找 API Key（先到先得）：

1. **环境变量** — `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY` 等
2. **配置文件** — `~/.config/rpiv-web-tools/config.json` 中的 `apiKeys.<provider>`
3. **Legacy** — 仅 Brave：顶层 `apiKey` 字段（自动迁移）

### 3.5 Provider 元数据

每个 Provider 导出一个 `ProviderMeta` 常量，声明在 `PROVIDERS` 注册表中：

```typescript
interface ProviderMeta {
  name: string; // 唯一标识符
  label: string; // 显示名
  envVar?: string; // API key 环境变量名
  baseUrlEnvVar?: string; // Base URL 环境变量名（自托管 provider）
  defaultBaseUrl?: string; // Base URL 默认值
  roles: ReadonlyArray<ProviderRole>; // ["search"] 或 ["search", "fetch"]
  configure?(ui, current): Promise<ProviderConfigChange | null>; // 自定义配置交互
}
```

## 4. URL 拦截器机制

### 4.1 接口定义

```typescript
interface UrlInterceptor {
  readonly name: string;
  intercept(
    url: string,
    opts: { raw: boolean; signal?: AbortSignal },
  ): Promise<FetchResponse | null>;
}
```

- 返回 `FetchResponse` = 拦截器认领了该 URL
- 返回 `null` = 跳过，交给下一个拦截器或 Provider

### 4.2 GitHub 拦截器

将 `github.com` URL 转换为仓库内容（文件树、README、文件内容），而非渲染后的 HTML 页面。

**路由规则：**

- `github.com/owner/repo` → 仓库根（文件树 + README）
- `github.com/owner/repo/blob/ref/path` → 文件内容
- `github.com/owner/repo/tree/ref/path` → 目录列表
- 非 code 路径（`/issues`、`/pulls` 等）→ 回退到 Provider

**实现策略：**

1. 优先使用 `gh` CLI（支持私有仓库，鉴权走 `GITHUB_TOKEN`）
2. 不可用时回退到 `git clone --depth 1 --single-branch`
3. 超大仓库（> `maxRepoSizeMB`，默认 350MB）走 `gh api` JSON 视图
4. SHA-pinned URL 走 API 视图（shallow clone 无法按 SHA 检出）
5. Clone 结果按 `owner/repo@ref` 缓存，避免重复克隆

**安全：**

- 路径遍历防护：`resolveWithinRepo()` 确保文件读取不越界
- 二进制文件检测：扩展名 + 前 512 字节 NUL 检查
- SSRF guard 仍然在拦截器之前运行

### 4.3 拦截器启用方式

两级 opt-in（用户配置优先于编程式默认）：

```jsonc
// ~/.config/rpiv-web-tools/config.json
{ "interceptors": { "github": true } }  // 简写形式
{ "interceptors": { "github": { "maxRepoSizeMB": 500, "clonePath": "/custom/path" } } }  // 对象形式
```

```typescript
// 编程式（registerWebTools 调用方）
registerWebTools(pi, { interceptors: { github: true } });
```

## 5. 安全机制

### 5.1 SSRF 防护

`web_fetch` 拒绝以下目标地址：

| 类别        | 范围                                                  |
| ----------- | ----------------------------------------------------- |
| Loopback    | `localhost`, `127.0.0.0/8`, `::1`                     |
| RFC 1918    | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`       |
| Link-local  | `169.254.0.0/16`（含 AWS metadata `169.254.169.254`） |
| IPv6 ULA/LL | `fc00::/7`, `fe80::/10`                               |

**限制：** 仅检查 URL 字面主机名，不解析 DNS 或跟踪重定向。生产环境需额外 egress 防火墙。

### 5.2 内容类型防护

- 拒绝 `image/*`、`video/*`、`audio/*` 响应
- 强制 HTTP/HTTPS 协议

## 6. 配置系统

本仓库已有统一的配置基础设施，web-tools 应直接复用，不自建配置文件。

### 6.1 现有配置基础设施

本仓库的配置体系由三层组成：

```
packages/common/config/
  ├── extension-config.ts   # 配置持久化：~/.config/pi/extensions.json
  └── config-item.ts        # ConfigItem 类型 + 全局注册表

packages/extension-config-ui/
  ├── config-registry.ts    # SettingRow 构建 + 读写操作
  ├── popup.ts              # TUI 弹窗：/config 命令
  └── render/               # 渲染组件
```

- **`readConfig(extId, schema)`** — 从 `~/.config/pi/extensions.json` 的 `extId` section 读取配置，missing key 回退到 `schema.defaults`
- **`writeConfig(extId, config)`** / **`updateConfig(extId, schema, patch)`** — 写入配置
- **`registerConfigItems(extId, items[])`** — 注册配置项到全局注册表，供 `/config` TUI 自动展示和编辑
- **`/config` 命令** — 统一 TUI 弹窗，支持 Tab 切换扩展、搜索、内联编辑、Select 选择页、Boolean 切换、重置

### 6.2 ConfigItem 类型

`ConfigItem` 是声明式的配置描述，每种类型对应不同的 TUI 交互方式：

```typescript
interface ConfigItemBase<T, Type> {
  key: string; // 配置键名
  type: Type; // "string" | "number" | "boolean" | "select" | "multiselect" | "color"
  label: string; // 显示名
  value: T | (() => T); // 当前值（支持懒加载）
  description?: string; // 说明文字
  group?: string; // 分组
  order?: number; // 排序权重
  secret?: boolean; // 是否脱敏显示
  envVar?: string; // 关联的环境变量名（文档用）
  placeholder?: string; // 输入占位符
  extensionLabel?: string; // 扩展显示名
}
```

Web-tools 需要用到的类型：

| ConfigItem 类型           | 用途                               | TUI 交互             |
| ------------------------- | ---------------------------------- | -------------------- |
| `select`                  | 选择 active provider               | Select 选择页        |
| `string` + `secret: true` | API Key 输入                       | 内联编辑，值脱敏显示 |
| `boolean`                 | GitHub 拦截器开关                  | Enter 切换           |
| `number`                  | maxRepoSizeMB、cloneTimeoutSeconds | 内联编辑             |

### 6.3 Web-tools 配置项设计

Web-tools 应注册为 `extensionId = "web-tools"`，利用 `registerConfigItems` 声明所有配置项：

```typescript
import {
  registerConfigItems,
  readConfig,
  updateConfig,
  type ExtensionConfigSchema,
} from "@htwang-contrib/common";

interface WebToolsConfig {
  provider: string;
  apiKeys: Record<string, string>;
  githubInterceptorEnabled: boolean;
  githubMaxRepoSizeMB: number;
  githubCloneTimeoutSeconds: number;
  githubClonePath: string;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<WebToolsConfig> = {
  defaults: {
    provider: "brave",
    apiKeys: {},
    githubInterceptorEnabled: false,
    githubMaxRepoSizeMB: 350,
    githubCloneTimeoutSeconds: 30,
    githubClonePath: join(tmpdir(), "pi-github-repos"),
  },
};

// API Key 解析：env var 优先于 config file
function resolveApiKey(providerName: string): string | undefined {
  const meta = PROVIDERS.find((p) => p.name === providerName);
  const envKey = meta?.envVar ? process.env[meta.envVar]?.trim() : undefined;
  if (envKey) return envKey;
  return readConfig("web-tools", CONFIG_SCHEMA).apiKeys[providerName]?.trim();
}

registerConfigItems("web-tools", [
  {
    key: "provider",
    type: "select",
    label: "Search Provider",
    value: () => readConfig("web-tools", CONFIG_SCHEMA).provider,
    description: "Active search backend",
    extensionLabel: "Web Tools",
    order: 0,
    options: [
      { label: "Brave", value: "brave" },
      { label: "Tavily", value: "tavily" },
      { label: "Serper", value: "serper" },
      { label: "Exa", value: "exa" },
      { label: "You.com", value: "youcom" },
      { label: "Jina", value: "jina" },
      { label: "Firecrawl", value: "firecrawl" },
      { label: "Perplexity", value: "perplexity" },
    ],
  },
  // 每个 provider 的 API Key（secret 模式）
  {
    key: "apiKeys.brave",
    type: "string",
    label: "Brave API Key",
    value: () => resolveApiKey("brave") ?? "",
    description: "Brave Search API key (env: BRAVE_SEARCH_API_KEY)",
    extensionLabel: "Web Tools",
    order: 10,
    secret: true,
    placeholder: "BRAVE_SEARCH_API_KEY or enter key here",
    envVar: "BRAVE_SEARCH_API_KEY",
  },
  // ... 其他 provider 的 API Key 配置项，模式相同 ...
  {
    key: "githubInterceptorEnabled",
    type: "boolean",
    label: "GitHub URL Interceptor",
    value: () =>
      readConfig("web-tools", CONFIG_SCHEMA).githubInterceptorEnabled,
    description: "Route github.com URLs through gh/git for repo content",
    extensionLabel: "Web Tools",
    order: 100,
  },
  {
    key: "githubMaxRepoSizeMB",
    type: "number",
    label: "GitHub Max Repo Size (MB)",
    value: () => readConfig("web-tools", CONFIG_SCHEMA).githubMaxRepoSizeMB,
    description:
      "Repos above this threshold use the API view instead of cloning",
    extensionLabel: "Web Tools",
    order: 101,
    min: 10,
    max: 5000,
  },
]);
```

### 6.4 配置读取策略

使用本仓库已有的 `readConfig("web-tools", CONFIG_SCHEMA)` 模式：

- JSON 文件不存在 → 返回 `schema.defaults`
- JSON 解析失败 → 返回 `schema.defaults`
- 部分 key 缺失 → 用 defaults 补齐（`{ ...defaults, ...section }`）

### 6.5 与上游 rpiv-web-tools 的差异

| 方面         | 上游 rpiv-web-tools                                      | 本仓库实现                                                      |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------------- |
| 配置文件     | `~/.config/rpiv-web-tools/config.json`（独立文件）       | `~/.config/pi/extensions.json` 的 `web-tools` section           |
| 配置读写     | 自建 `loadJsonConfig` / `saveJsonConfig`                 | `@htwang-contrib/common` 的 `readConfig` / `updateConfig`       |
| 配置 UI      | 自建 `/web-tools` 命令（provider 列表选择 + input 弹窗） | 复用 `/config` TUI（Tab、搜索、Select 页、内联编辑）            |
| 配置项注册   | 无声明式注册，命令中硬编码 provider 列表                 | `registerConfigItems` 声明式注册，自动出现在 `/config` UI       |
| API Key 脱敏 | 自建 `maskApiKey()`                                      | `ConfigItemBase.secret: true`，由 `/config` TUI 统一处理        |
| 私有配置路径 | 自建 `configPath()`                                      | 复用 `@htwang-contrib/common` 已有的 `XDG_CONFIG_HOME` 感知路径 |

### 6.6 不再需要 `/web-tools` 命令

上游的 `/web-tools` 命令职责（provider 选择、API Key 设置、`--show` 状态查看）全部由 `/config` TUI 覆盖：

- **Provider 选择** → `/config` → Web Tools tab → "Search Provider" Select 页
- **API Key 设置** → `/config` → Web Tools tab → 对应 provider 的 string 编辑（secret 脱敏）
- **拦截器开关** → `/config` → Web Tools tab → "GitHub URL Interceptor" Boolean 切换
- **状态查看** → `/config` 的 Tab + 搜索天然支持浏览所有配置项

如果未来需要 web-tools 专属的交互（例如一键测试当前 provider 连通性），可以单独注册一个 `/web-tools` 命令，但基础配置管理不再需要。

## 7. 工具 Schema

### web_search

```typescript
{
  query: string;          // 自然语言查询
  max_results?: number;   // 1-10，默认 5
}
```

返回：

```typescript
{
  content: [{ type: "text", text: string }];  // Markdown 列表
  details: {
    query: string;
    backend: string;
    resultCount: number;
    results?: Array<{ title: string; url: string; snippet: string }>;
  }
}
```

### web_fetch

```typescript
{
  url: string;    // HTTP/HTTPS URL
  raw?: boolean;  // true → 返回原始 HTML；默认 false → 转文本
}
```

返回：

```typescript
{
  content: [{ type: "text", text: string }];
  details: {
    url: string;
    title?: string;
    contentType?: string;
    contentLength?: number;
    truncation?: TruncationResult;   // 截断信息
    fullOutputPath?: string;         // 完整内容临时文件路径
  }
}
```

## 8. 与现有扩展的集成点

### 8.1 tool-display — 渲染适配器

本仓库有统一的工具调用渲染体系 `packages/tool-display/`。工具不自带 `renderCall`/`renderResult`，而是通过全局注册表 `globalToolDisplayRegistry` 注册 `ToolDisplayAdapter`：

```typescript
// packages/tool-display/types.ts
interface ToolDisplayAdapter<TArgs = Record<string, unknown>> {
  formatCallHeader(args, theme, details?, isPartial?, expanded?): string;
  formatCollapsedContent(
    args,
    output,
    theme,
    width,
    details?,
    isPartial?,
    spinAt?,
  ): string[];
  formatExpandedContent(args, output, theme, width, details?): string[];
}
```

已有 Z.AI 专用的适配器可以参考：

- `adapters/web-search-prime.ts` — `web_search_prime` 工具的渲染
- `adapters/web-read-prime.ts` — `web_read_prime` 工具的渲染

Web-tools 需要：

1. 在 `packages/tool-display/adapters/` 新建 `web-search.ts` 和 `web-fetch.ts`
2. 在 `packages/tool-display/registry.ts` 注册：
   ```typescript
   globalToolDisplayRegistry.register("web_search", webSearchAdapter);
   globalToolDisplayRegistry.register("web_fetch", webFetchAdapter);
   ```
3. 使用 `formatExpandedToolOutputLines` (from `adapters/shared.ts`) 渲染展开内容
4. 在 `details` 中返回结构化数据（`resultCount`、`lineCount`、`truncated`），供 collapsed 视图展示摘要

### 8.2 zai-coding-plan — 与现有 web search/read 的关系

`packages/zai-coding-plan/` 已经注册了 `web_search_prime` 和 `web_read_prime` 两个工具，通过 Z.AI MCP 协议调用。这与 web-tools 的 `web_search` / `web_fetch` 是**不同工具**：

| 方面   | zai-coding-plan                       | web-tools（规划中）        |
| ------ | ------------------------------------- | -------------------------- |
| 工具名 | `web_search_prime` / `web_read_prime` | `web_search` / `web_fetch` |
| 后端   | Z.AI MCP（单一后端）                  | 可插拔 Provider（8 种）    |
| 依赖   | 需要 `ZAI_API_KEY`                    | 各 Provider 独立的 API Key |
| 激活   | `session_start` 时自动注册            | 安装即生效                 |
| 渲染   | 已有适配器                            | 需新建适配器               |

两者可以共存。长远来看，可以考虑让 web-tools 吸收 Z.AI 作为 Provider 之一，将 `web_search_prime` / `web_read_prime` 逐步迁移为 web-tools 的 Z.AI 后端。但这不阻塞初始实现。

详见 §10.4 Z.AI MCP Provider 设计与迁移。

### 8.3 subagents — 子代理中的 web 访问

`packages/subagents/` 管理子代理的工具白名单：

```typescript
// packages/subagents/child-tools.ts
const READ_ONLY_TOOLS = ["read", "grep", "glob", "ls"];
const FULL_BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "glob",
  "ls",
];
```

子代理还加载扩展工厂：

```typescript
// packages/subagents/run-agent.ts
const CHILD_SESSION_EXTENSION_FACTORIES: ExtensionFactory[] = [
  protectSecrets,
  extraTools,
];
```

Web-tools 集成需要两处改动：

1. `childSessionToolNames()` — 将 `"web_search"` / `"web_fetch"` 加入白名单
2. `CHILD_SESSION_EXTENSION_FACTORIES` — 加入 web-tools 的工厂函数

这让子代理也能搜索/抓取网页，适用于研究型子代理任务。

### 8.4 extra-tools — 工具注册模式

`packages/extra-tools/` 是最直接的参考对象，它的模式应被 web-tools 完全沿用：

- 每个工具独立子目录：`grep/index.ts` + `grep/prompt.txt`
- 使用 `Type` (typebox) 定义参数 schema
- 返回 `{ content: [{type: "text", text}], details: {...} }`
- 支持 `AbortSignal` 取消
- 使用 `truncateHead` + `DEFAULT_MAX_BYTES` 截断输出
- 不自带渲染，由 `tool-display` 全局注册表统一处理

Web-tools 应采用相同结构：

```
packages/web-tools/
├── index.ts              # 入口
├── search/
│   ├── index.ts          # web_search 工具注册
│   └── prompt.txt        # 工具描述
├── fetch/
│   ├── index.ts          # web_fetch 工具注册
│   └── prompt.txt        # 工具描述
├── providers/            # Provider 体系
└── interceptors/         # URL 拦截器
```

### 8.5 protect-secrets — URL 安全防护

`packages/protect-secrets/` 通过 `tool_call` 钩子拦截可能泄露 `/run/agenix` 密钥的调用。Web-tools 的 `web_fetch` 和 `web_search` 可能成为新的泄露通道：

- `web_fetch` 的 URL 中可能包含敏感参数
- `web_search` 的 query 中可能包含环境变量值

考虑在 `protect-secrets` 中增加对 `web_fetch` / `web_search` 的检查，或在 web-tools 内部自行过滤。

### 8.6 btw / committer — 未来增强

这些扩展使用 `executeSideCall()`（from `@htwang-contrib/common`）进行独立 LLM 调用：

- **btw**：侧边问答。未来可增强为自动判断是否需要联网，调用 web_search 获取最新信息后再回答
- **committer**：提交生成。未来可增强为抓取远程 PR 描述或 changelog 辅助生成 commit message

这些是增强方向，不阻塞初始实现。

## 9. 关键设计模式总结

### 9.1 Provider 角色分离

`SearchProvider` / `FetchProvider` / `FullProvider` 的联合类型设计，让编排层通过 `"fetch" in provider` 运行时判断能力，无需额外的能力注册表。新增 Provider 只需实现对应接口 + 导出 META。

### 9.2 三级 Fetch 调度

拦截器 → Provider 原生 fetch → 通用 HTML 管线。优先级清晰，扩展点明确。

### 9.3 拦截器链

`UrlInterceptor` 接口设计简洁（`intercept` 返回 `FetchResponse | null`），支持快速拒绝（URL 解析 + host 检查），不相关的 URL 零开销。

### 9.4 配置容错

fail-soft 策略：配置文件损坏不会阻塞功能，降级到 schema.defaults。

### 9.5 依赖关系

上游 rpiv-web-tools 的依赖：

```
@juicesharp/rpiv-config          # 配置读写 + guidance 校验
@earendil-works/pi-coding-agent  # ExtensionAPI、truncation 工具
@earendil-works/pi-tui           # TUI 渲染组件（Text）
typebox                           # Schema 定义 + 校验
```

本仓库实现应使用：

```
@htwang-contrib/common           # 配置读写（readConfig/updateConfig/registerConfigItems）、side-call、global-state
@earendil-works/pi-coding-agent  # ExtensionAPI、truncateHead、DEFAULT_MAX_BYTES/DEFAULT_MAX_LINES
@earendil-works/pi-tui           # TUI 渲染组件
typebox                           # Schema 定义 + 校验
```

## 10. 为本仓库实现 Web Tools 的建议

### 10.1 应复用的部分

- **Provider 接口设计**（`SearchProvider` / `FullProvider`）— 职责清晰
- **三级 Fetch 调度**（拦截器 → Provider 原生 → 通用管线）— 扩展性好
- **SSRF 防护** — 安全基线
- **大页面溢出机制** — temp file + truncation 是经过验证的模式
- **配置容错**（fail-soft）— 用户体验好

### 10.2 应调整的部分

- **配置系统**：复用 `@htwang-contrib/common` 的 ConfigItem + `/config` TUI（详见 §6）
- **工具渲染**：不自带 `renderCall`/`renderResult`，通过 `globalToolDisplayRegistry` 注册 `ToolDisplayAdapter`（详见 §8.1）
- **工具结构**：每个工具独立子目录 + `prompt.txt`，参考 `extra-tools`（详见 §8.4）
- **输出截断**：使用 `truncateHead` + `DEFAULT_MAX_BYTES`，不自建
- **拦截器范围**：GitHub 拦截器是重量级特性，可以后续按需添加

### 10.3 推荐的实现路径

**Phase 1 — 核心骨架**

1. `SearchProvider` / `FullProvider` / `ProviderMeta` 接口
2. 1-2 个 Provider（Brave search-only + Tavily full）
3. 通用 HTML 管线（`htmlToText` + `fetchViaGenericHtml`）
4. SSRF 防护
5. `web_search` + `web_fetch` 工具注册（参考 `extra-tools` 结构）
6. `ToolDisplayAdapter` 注册（参考 `web-search-prime.ts`）
7. `registerConfigItems("web-tools", [...])` 配置项注册

**Phase 2 — 扩展 Provider** 8. 添加其余 Provider（Serper、Exa、Jina 等）9. GitHub URL 拦截器

**Phase 3 — 生态集成** 10. subagent 工具白名单集成 11. protect-secrets URL 检查 12. Z.AI MCP Provider + 迁移（详见 §10.4）

### 10.4 Z.AI MCP Provider 设计与迁移

#### 10.4.1 现状

`packages/zai-coding-plan/` 直接注册了两个独立工具：

- `web_search_prime` — 通过 `mcpInit` / `mcpCall` 调用 Z.AI `web_search_prime/mcp` endpoint
- `web_read_prime` — 通过 `mcpInit` / `mcpCall` 调用 Z.AI `web_reader/mcp` endpoint

这两个工具绕过了 web-tools 的 Provider 体系，各自管理 MCP session 生命周期，与 web-tools 的 `web_search` / `web_fetch` 是平行的独立工具。

#### 10.4.2 Z.AI as FullProvider

将 Z.AI 的 web search + web read 能力封装为 `ZaiProvider`，实现 `FullProvider` 接口：

```typescript
// packages/web-tools/providers/zai.ts

class ZaiProvider implements FullProvider {
  readonly name = "zai";
  readonly label = "Z.AI";
  readonly envVar = "ZAI_API_KEY";

  constructor(private apiKey: string) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
    // 1. mcpInit → ZAI_SEARCH_MCP_URL
    // 2. mcpCall → tool "web_search_prime", args { search_query: query }
    // 3. 解析多层 JSON 编码的响应（最多 3 轮 JSON.parse）
    // 4. WebSearchResult[] → SearchResult[]（link→url, content→snippet）
    // 5. 截取 maxResults 条
  }

  async fetch(url: string, raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
    // 1. mcpInit → ZAI_READER_MCP_URL
    // 2. mcpCall → tool "webReader", args { url }
    // 3. 解析多层 JSON 编码的响应
    // 4. 提取 title + content → FetchResponse
  }
}
```

**关键实现细节：**

- Z.AI MCP 响应的 `content[0].text` 可能被多层 JSON 编码（最多 3 层），需要循环 `JSON.parse` 直到得到非 string 对象或 parse 失败
- `search()` 中 `WebSearchResult` 的字段映射：`link` → `url`，`content` → `snippet`，`refer` 丢弃
- `fetch()` 中 `WebReadResult` 的字段映射：`content` → `text`，`title` 保留
- 依赖 `@htwang-contrib/common` 的 `mcpInit` / `mcpCall`，不需要从 `zai-coding-plan` 重新导出
- 每次 `search` / `fetch` 调用都创建新的 MCP session（与现有行为一致），不做 session 复用

**Provider 元数据：**

```typescript
export const ZAI_PROVIDER_META: ProviderMeta = {
  name: "zai",
  label: "Z.AI",
  envVar: "ZAI_API_KEY",
  roles: ["search", "fetch"] as const,
};
```

#### 10.4.3 迁移策略

迁移分三步，每步可独立验证：

**Step 17 — 新增 Z.AI Provider（增量）**

- 新建 `packages/web-tools/providers/zai.ts`
- 在 `PROVIDERS` 数组加入 `ZAI_PROVIDER_META`
- 在 `createSearchProvider` 工厂加入 `"zai"` 分支
- 不影响任何现有功能——`zai-coding-plan` 的 `web_search_prime` / `web_read_prime` 继续工作

**Step 18 — 迁移工具注册（替换）**

- `zai-coding-plan/index.ts`：移除 `web_search_prime` / `web_read_prime` 的 `registerTool` 调用和 `setActiveTools` 逻辑
- `zai-coding-plan/search.ts`：删除 `zaiWebSearch` / `zaiWebRead` 函数（逻辑已迁移到 `ZaiProvider`）
- 此后 Z.AI 的 web 能力完全通过 web-tools 的 `web_search` / `web_fetch` + `provider: "zai"` 配置提供
- `zai-coding-plan` 包的其他功能（provider 注册、quota 命令、事件钩子）不受影响

**Step 19 — 清理遗留（删除）**

- 移除 `tool-display` 中 `web_search_prime` / `web_read_prime` 的适配器和注册
- 删除 `packages/zai-coding-plan/search.ts`
- 全量 `tsc --build` + `npm test` 验证

#### 10.4.4 迁移前后对比

| 方面         | 迁移前                                 | 迁移后                                           |
| ------------ | -------------------------------------- | ------------------------------------------------ |
| 工具名       | `web_search_prime` / `web_read_prime` | `web_search` / `web_fetch`                       |
| 代码位置     | `zai-coding-plan/search.ts`           | `web-tools/providers/zai.ts`                     |
| 调用方式     | 独立 `registerTool` + `setActiveTools`| 统一 Provider 体系 + `instantiateActiveProvider` |
| MCP 逻辑     | `zaiWebSearch` / `zaiWebRead` 独立函数 | `ZaiProvider.search()` / `.fetch()` 方法          |
| 配置         | 无（依赖 `ZAI_API_KEY` env）          | `/config` TUI + env var 优先级                    |
| 渲染         | `web-search-prime` / `web-read-prime` 适配器 | `web-search` / `web-fetch` 适配器         |
| 与其他 Provider | 独立，不可切换                       | 统一，可通过 `/config` 一键切换                   |
