# Voice Input 扩展分步执行清单

本文与 [DESIGN.md](./DESIGN.md) 配套,按顺序执行。每一步都标注了对应设计文档的章节,便于溯源。

---

## 总进度 TODO

完成某一 phase 后把 `[ ]` 改成 `[x]`。「阻塞 / 备注」写一行备忘。

| Phase | 目标 | → DESIGN.md 章节 | 状态 |
| --- | --- | --- | --- |
| 0 | API 验证:确认 `ctx.ui.setWidget` / `getEditorText` / `setEditorText` / `notify`、`registerCommand`、`session_start`、`@htwang-contrib/common` 配置 API 可用 | § 2.2 / § 9 / § 12 | [x] |
| 1 | 仓库骨架:`packages/voice-input` 目录、`package.json`、`tsconfig.json`、空扩展可加载、根 `tsconfig` reference | § 3 | [x] |
| 2 | 配置层:`config.ts` schema + `loadConfig` + `registerConfigItems` + provider 预设 | § 5 / § 12 | [x] |
| 3 | 安全层:`secrets.ts`(`redactSecrets` / `safeError`) | § 11.1 | [x] |
| 4 | 录音抽象:`audio/recorder.ts`(跨平台命令选择)+ `audio/capture.ts`(`LocalAudioCapture`) | § 6 | [ ] |
| 5 | STT Provider:`providers/mimo-stt.ts` + `providers/index.ts` + `providers/presets.ts` | § 5.2 / § 7 | [ ] |
| 6 | Flow 编排:`flow.ts`(`VoiceInputFlow` + `mergeTranscript` + `withTimeout`) | § 4 / § 8 | [ ] |
| 7 | 扩展入口:`index.ts`(3 命令 + `session_start` + 模块级 `commandFlow`) | § 9 | [ ] |
| 8 | 收尾:README、AGENTS.md 链接、`tsc --build`、`npm run format`、验收清单逐项过 | § 13 | [ ] |

**当前停在哪一 phase:** Phase 3 完成(secrets.ts redactSecrets/safeError + 23 单测全绿,含 API_KEY 引号边界修复),待进 Phase 4 录音抽象

---

## Phase 0:API 验证

> **关联**:DESIGN.md § 2.2(extension-config-ui 接入范式)、§ 9(扩展入口依赖的 ctx.ui 方法)、§ 12(与 common 的边界)。所有后续 Phase 的前提。

### API 验证结果(2026-06-15 完成)

- **@earendil-works/pi-coding-agent 版本**: dist 类型定义实测
- **Step 0.1 ctx.ui 方法**: ✅ 齐全 — `setWidget(key, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" })`、`getEditorText(): string`、`setEditorText(text: string)`、`notify(message, type?: "info"|"warning"|"error")` 签名完全匹配。`setWidget` 默认 placement 是 `aboveEditor`(与 DESIGN § 10 浮层设计一致)。注意:命令 handler 收到的是 `ExtensionCommandContext`(含 `waitForIdle`/`reload` 等),事件 handler 收到 `ExtensionContext`。
- **Step 0.2 registerCommand / on**: ✅ 齐全 — `pi.registerCommand(name, { description, handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> })`;`pi.on("session_start", handler)` 支持。
- **Step 0.3 @htwang-contrib/common 配置 API**: ✅ 齐全 — `registerConfigItems`/`readConfig`/`writeConfig`/`ExtensionConfigSchema`/`ConfigItem` 及子类型(`SelectConfigItem`/`StringConfigItem`/`NumberConfigItem`)均为 runtime export(common `main: "index.ts"`,pi 直接加载 .ts,无构建步骤)。用临时骨架跑 `tsc --noEmit` 零错误。
- **Step 0.4 inference 网关 mimo-v2.5 转写**: ✅ 实测通过,见下方独立小节。**发现关键差异:网关要求 OpenAI 标准 `input_audio: { format: "wav", data: <纯base64> }`,非 pi-mimo-voice 的 data URL 格式**(后者静默失败返回 `[NO SPEECH]`)。DESIGN.md § 2.2/§ 7.2 已据此更新。
- **结论**: 无缺失,Phase 1–8 可直接开工。

#### Step 0.4 实测详情(journal 20260615-062010-001)

用 macOS `say` 合成中英文音频 → ffmpeg 转 16kHz mono s16le wav → base64 → POST `inference.twistoy.cn/v1/chat/completions`:

| 格式 | 结果 |
| --- | --- |
| `{ input_audio: { format: "wav", data: <纯base64> } }`(OpenAI 标准) | ✅ HTTP 200,中英文都正确转写,~5s |
| `{ input_audio: { data: "data:audio/wav;base64,..." } }`(pi-mimo-voice 的 data URL) | ⚠️ HTTP 200 但返回 `[NO SPEECH]`、`audio_tokens: 0`(静默失败) |
| `{ image_url: { url: "data:audio/wav;base64,..." } }` | ❌ 400 "Multimodal data is corrupted" |

响应解析:`choices[0].message.content`(fallback `reasoning_content`,实测一般为空)。鉴权头 `Authorization: Bearer` 被网关接受。`usage.prompt_tokens_details.audio_tokens` 始终 0(网关未统计,不影响功能)。

### Step 0.1 — 确认 `ExtensionContext.ui` 方法

在 `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts`(或 `.d.ts`)中确认 `ExtensionContext` 上存在:

| 方法 | 用途 | → DESIGN.md |
| --- | --- | --- |
| `ctx.ui.setWidget(key, content)` | 浮层显示录音/转写状态 | § 10 |
| `ctx.ui.getEditorText()` | 读输入框当前文本(append 需要) | § 4 / § 8 |
| `ctx.ui.setEditorText(text)` | 写转写文本回输入框 | § 4 / § 8 |
| `ctx.ui.notify(message, level)` | 命令结果提示 | § 9 |

> ⚠️ `setWidget`、`getEditorText`、`setEditorText` 是本期核心依赖。若任一缺失或签名不同(如 `setWidget` 的 key/content 形态、`getEditorText` 是否返回 `string | undefined`),必须先在设计文档 § 8/§ 10 记录实际签名再开工。

### Step 0.2 — 确认 `pi.registerCommand` 与 `pi.on`

确认 `ExtensionAPI` 支持:

- `pi.registerCommand(name, { description, handler })` — handler 签名 `(args: string, ctx: ExtensionContext) => void | Promise<void>`
- `pi.on("session_start", (event, ctx) => ...)` — 用于在启动时 `registerConfigItems`

参考 `packages/goal/index.ts`、`packages/committer/index.ts` 的用法。

### Step 0.3 — 确认 `@htwang-contrib/common` 配置 API

确认 `@htwang-contrib/common` 导出且签名匹配:

- `registerConfigItems(extensionId: string, items: ConfigItem[])`
- `readConfig<T>(extensionId, schema: ExtensionConfigSchema<T>): T`
- `writeConfig<T>(extensionId, config: T): void`
- 类型 `ConfigItem`、`SelectConfigItem`、`StringConfigItem`、`NumberConfigItem`、`ExtensionConfigSchema`

以 `packages/web-tools/config.ts` 为参考实现(它用了完全相同的 API + per-provider key 模式)。

### Step 0.4 — 实测 inference-self-host 的 mimo-v2.5 chat 多模态转写

> ✅ **实测已完成(2026-06-15)**:网关透传成功,中英文均正确转写。但发现关键差异 —— **网关要求 OpenAI 标准 `input_audio: { format: "wav", data: <纯base64> }` 格式,不是 mimo-voice 的 data URL 格式**。详见 DESIGN.md § 2.2 和 journal。下面 curl 是最初的探测命令(用了错误格式),保留作参考:

---

DESIGN.md § 2.1/§ 2.2 采用 pi-mimo-voice 的 `/chat/completions` + `input_audio` 格式调 `mimo-v2.5`。**Phase 0 需实测 inference 网关是否透传多模态 audio content block**:

```bash
# 准备一段现成 wav,转 base64(去掉换行)
B64=$(base64 -w0 /tmp/test.wav)   # macOS 用:base64 -i /tmp/test.wav | tr -d '\n'

curl -s -X POST https://inference.twistoy.cn/v1/chat/completions \
  -H "Authorization: Bearer $INFERENCE_TWISTOY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mimo-v2.5",
    "messages": [{"role":"user","content":[
      {"type":"input_audio","input_audio":{"data":"data:audio/wav;base64,'"$B64"'"}},
      {"type":"text","text":"Transcribe the speech in this audio to text. Output only the transcribed text, no explanations. If no speech is detected, output [NO SPEECH]."}
    ]}],
    "max_completion_tokens": 4096
  }'
```

记录:

- 端点是否 200
- model `mimo-v2.5` 是否接受 audio content block(网关是否透传多模态)
- 鉴权头 `Authorization: Bearer` 是否被网关接受(inference-self-host provider 配置是 `authHeader: true`)
- 响应字段:转写文本在 `choices[0].message.content` 还是 `reasoning_content`(mimo-voice 两者都 fallback)

若网关不透传 audio block(返回 400/415 或 "model does not support audio"),**立即更新 DESIGN.md § 2.1**,改用直连小米官方 `api.xiaomimimo.com/v1`(鉴权头换成 `api-key`,见 mimo-voice `getApiBase`)或退本地 whisper.cpp。

### Step 0.5 — 记录验证结果

已完成,见上方「API 验证结果」小节。

### 后续 Phase 的 API 验证盘点

Phase 0 验证后,以下是后续 Phase 涉及的 API 分类。**类型检查全部通过**(Node ≥22 原生全局 + pi 类型定义),只有少数需运行时实测:

| Phase | API | 类型检查 | 运行时实测 | 备注 |
| --- | --- | --- | --- | --- |
| 4 录音 | `node:child_process` spawn/spawnSync | ✅ | ⏳ 手测 | web-tools `interceptors/github.ts` 已用同模式 |
| 4 录音 | `node:fs` mkdtempSync/rmSync/existsSync | ✅ | ✅ 稳定 | 同上 |
| 4 录音 | ffmpeg/parecord/sox 命令存在性 | N/A | ⏳ 各平台手测 | `commandExists` 用 `spawnSync('command',['-v',name])` |
| 4 录音 | ffmpeg exit code 白名单(0/130/255) | N/A | ⏳ macOS 手测 | 255 是 avfoundation SIGINT 怪行为 |
| 5 STT | `fetch` / `FormData` / `Blob` | ✅ | ✅ 实测 | Node 22 原生全局,Step 0.4 已验证 |
| 5 STT | `node:fs` readFile(音频进内存) | ✅ | ✅ 稳定 | |
| 5 STT | inference 网关 `/chat/completions` | ✅ | ✅ Step 0.4 实测 | OpenAI 标准 input_audio 格式 |
| 6 flow | `Promise.race` + setTimeout(withTimeout) | ✅ | ✅ 稳定 | |
| 7 入口 | `setWidget(placement?: 'aboveEditor'\|'belowEditor')` | ✅ | ⏳ 手测浮层渲染 | 默认 aboveEditor,与 DESIGN § 10 一致 |
| 7 入口 | `getEditorText` / `setEditorText` | ✅ | ⏳ 手测 append | |
| 7 入口 | `session_start` 事件 reload 重置 commandFlow | ✅ | ⏳ 手测 | DESIGN § 9 风险点 |

**需运行时实测的项**(留到 Phase 7 手测阶段一次性验证):

1. ffmpeg 录音 → SIGINT 停止 → exit code 是否落在白名单(macOS)
2. setWidget 浮层是否正确渲染在输入框上方并随状态切换
3. getEditorText/setEditorText 的 append 流程
4. `/reload` 后 `session_start` 是否可靠重置 `commandFlow`(避免漏清)

这些都在 Phase 7 Step 7.2 的手测清单里,无需提前做。

---

## Phase 1:仓库骨架

> **关联**:DESIGN.md § 3 包结构。遵循 AGENTS.md「No build step」+ ESM + `.ts` imports + project references。

### Step 1.1 — 创建 `packages/voice-input/package.json`

参考 `packages/goal/package.json`:

```jsonc
{
  "name": "@htwang-contrib/voice-input",
  "version": "0.1.0",
  "type": "module",
  "main": "index.ts",
  "types": "index.ts",
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "@htwang-contrib/common": "*",
    "@types/node": "^25.9.1",
    "typescript": "^6.0.0"
  }
}
```

- 无运行时 `dependencies`(DESIGN.md § 3:不引入 native 包;`common` 走 workspace)
- `peerDependencies` 不强制(pi-coding-agent 由宿主提供)

### Step 1.2 — 创建 `packages/voice-input/tsconfig.json`

照搬 `packages/goal/tsconfig.json`:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 1.3 — 创建空入口 `packages/voice-input/index.ts`

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (_pi: ExtensionAPI): void {
  // Phase 2 起填充
}
```

### Step 1.4 — 注册到根 `tsconfig.json`

在根 `tsconfig.json` 的 `references` 数组末尾追加:

```jsonc
{ "path": "packages/voice-input" }
```

### Step 1.5 — 类型检查 + format

```bash
npx tsc --build
npm run format
```

确认零错误。此时 `packages/voice-input` 可被 pi 加载(`pi -e packages/voice-input/index.ts`)但不做任何事。

---

## Phase 2:配置层

> **关联**:DESIGN.md § 5 配置模型、§ 12 与 common 的边界。**完全照搬 `packages/web-tools/config.ts` 的范式**。

### Step 2.1 — 定义 `types.ts`

按 DESIGN.md § 5.1:

```ts
export interface SttProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface VoiceInputConfig {
  provider: string;                  // 本期默认 "inference-self-host"
  providers: Record<string, SttProviderConfig>;
  recorder: "auto" | "ffmpeg" | "parecord" | "sox";
  micDevice: string;
  transcribeTimeoutMs: number;
}
```

### Step 2.2 — 实现 `providers/presets.ts`

按 DESIGN.md § 5.2,本期**仅内置一个预设**:

```ts
export const STT_PROVIDER_PRESETS = [
  { name: "inference-self-host", label: "Inference Self-Host",
    baseUrl: "https://inference.twistoy.cn/v1",
    defaultModel: "mimo-v2.5",
    envVar: "INFERENCE_TWISTOY_API_KEY" },
];
```

> 不预置 openai/groq/elevenlabs —— 它们是 multipart `/audio/transcriptions` whisper 协议,与本期 chat 多模态格式不同(DESIGN.md § 5.2 备注)。

### Step 2.3 — 实现 `config.ts`

参考 `packages/web-tools/config.ts` 实现:

- `CONFIG_SCHEMA: ExtensionConfigSchema<VoiceInputConfig>` — `defaults` 填 DESIGN.md § 5.1 的默认值(provider 默认 `"inference-self-host"`、recorder 默认 `"auto"`、micDevice 默认 `""`、transcribeTimeoutMs 默认 `60000`、providers 默认 `{}`)
- `loadConfig(): VoiceInputConfig` — `readConfig("voice-input", CONFIG_SCHEMA)`
- `resolveApiKey(providerName): string | undefined` — 按 § 5.3 的「config > envVar」优先级
- `resolveProviderConfig(providerName): { baseUrl, model }` — 合并预设默认值 + config 覆盖(baseUrl/model)
- `registerVoiceInputConfigItems()` — 按 § 5.4 注册 provider select + 当前唯一 preset 的 baseUrl/apiKey/model + recorder select + micDevice string + transcribeTimeoutMs number

**注意**:ConfigItem 的 `value` 用 `() => loadConfig().xxx` 懒求值(与 web-tools 一致),保证 `/config` 打开时读最新值。`apiKey` item 标 `secret: true` + `envVar: preset.envVar` + `placeholder: preset.envVar`。

### Step 2.4 — 单元测试 `__tests__/config.test.ts`

覆盖:

- `loadConfig()` 在无配置文件时返回 defaults
- `resolveApiKey` 优先级:config 有 key → 用 config;config 无但 envVar 有 → 用 envVar;都没有 → undefined
- `resolveProviderConfig` 合并正确(预设 baseUrl + config 覆盖的 model)
- `STT_PROVIDER_PRESETS` 每个 preset 必填字段齐全

### Step 2.5 — 类型检查 + format + test

```bash
npx tsc --build
npm run format
npm test
```

---

## Phase 3:安全层

> **关联**:DESIGN.md § 11.1 密钥脱敏。取自 pi-vox `config.js` 的 `redactSecrets` / `safeError`。

### Step 3.1 — 实现 `secrets.ts`

- `SECRET_PATTERNS`:正则数组,匹配 `Authorization: Bearer xxx` / `Bearer xxx` / 各 provider 的 `XXX_API_KEY=xxx`
- `redactSecrets(value, additionalSecrets = [])`:把模式匹配到的替换为 `<redacted>`,再把 `additionalSecrets` 数组里的字面量全局替换为 `<redacted>`
- `safeError(error, additionalSecrets = [])`:error → message string → 过 `redactSecrets`

**注意**:`additionalSecrets` 应包含当前 provider 的实际 apiKey(从 `resolveApiKey` 取),保证 STT 响应体里若意外回显 key 也能脱敏。

### Step 3.2 — 单元测试 `__tests__/secrets.test.ts`

覆盖:

- `redactSecrets("Authorization: Bearer sk-abc123")` → 含 `<redacted>` 不含原 key
- `safeError(new Error("failed with key sk-secret"))` 配合 `additionalSecrets: ["sk-secret"]` → 脱敏
- `redactSecrets(undefined)` / 空串边界

### Step 3.3 — 类型检查 + format + test

```bash
npx tsc --build
npm run format
npm test
```

---

## Phase 4:录音抽象

> **关联**:DESIGN.md § 6 录音抽象。取自 pi-vox `audio.js` + pi-mimo-voice 跨平台矩阵。

### Step 4.1 — 实现 `audio/recorder.ts`

按 DESIGN.md § 6.2:

- `commandExists(name): boolean` — 用 `spawnSync(process.platform === "win32" ? "where" : "command", ["-v" 或 name])`,stdio ignore,看 exit code
- `selectRecorder(config, exists?)` — auto 模式按平台优先级探测(Linux 优先 parecord → ffmpeg → sox);非 auto 直接返回。探测失败抛带引导信息的 Error
- `buildRecorderArgs(recorder, file, device?)` — 三种 recorder 的参数拼装;`ffmpegInputArgs(device)` 按平台返回 pulse/avfoundation/dshow 输入参数

**关键**:`ffmpeg` 的 args 顺序是 `['-y', ...input, '-ar', '16000', '-ac', '1', '-f', 'wav', file]`(input 在前,output 在后)。参考 pi-mimo-voice `getFfmpegRecordArgs`。

### Step 4.2 — 实现 `audio/capture.ts`

`LocalAudioCapture` 类,按 DESIGN.md § 6.1:

- 构造参数 `{ spawn?, recorder?, device?, stopTimeoutMs? = 3000 }`,全部可选便于测试注入
- `start(): { file }` — `mkdtempSync($TMPDIR/voice-input-)` + `spawn(recorder, buildRecorderArgs(...))`;挂 `error`/`exit` 事件记录到实例字段
- `async stop(): Promise<{ file }>` — `kill('SIGINT')` + 等 `exit`(超时抛 timeout)+ **校验 exit code**(ffmpeg 允许 `0/130/255`,其它允许 `0/130`,DESIGN.md § 6.1)
- `async cancel()` — SIGINT + 立即 cleanup(不等 exit)
- `cleanup()` — `rmSync(dir, { recursive, force })`

**与 pi-vox 的差异**:pi-vox 用 `Object.assign` 风格的依赖注入;这里改成构造参数对象,更清晰。`spawn`/`fs`/`tmpdir` 都要可注入(测试用 fake)。

### Step 4.3 — 单元测试 `__tests__/recorder.test.ts`

覆盖:

- `selectRecorder({ recorder: "ffmpeg" })` 直接返回 ffmpeg(不探测)
- `selectRecorder({ recorder: "auto" })` 在「只有 sox」的 fake `exists` 下返回 sox
- `buildRecorderArgs` 三种 recorder 输出参数正确(断言数组包含关键 flag)
- `buildRecorderArgs` 在 device 非空时覆盖默认设备

### Step 4.4 — 单元测试 `__tests__/capture.test.ts`

用 fake spawn(返回模拟 ChildProcess)覆盖:

- `start()` 后 `stop()` 正常路径(exit 0)→ resolve file
- `stop()` ffmpeg exit 255 → 不抛错(macOS 怪行为兼容)
- `stop()` 非 ffmpeg exit 1 → 抛 "exited with code 1"
- `stop()` 超时 → 抛 timeout
- `cancel()` → cleanup 被调用,文件目录删除

### Step 4.5 — 类型检查 + format + test

```bash
npx tsc --build
npm run format
npm test
```

---

## Phase 5:STT Provider

> **关联**:DESIGN.md § 5.2 预设、§ 7 STT Provider。依赖 Phase 0.4 的实测结果。

### Step 5.1 — 实现 `providers/mimo-stt.ts`(chat 多模态,对齐 pi-mimo-voice)

按 DESIGN.md § 7.2(格式完全对齐 pi-mimo-voice `transcribeWithMimo`):

- `transcribeWithMimoChat(file, config: { baseUrl, model }, apiKey, signal?)`:
  - `readFile(file)` → `audioBuffer.toString('base64')`
  - `mime = file.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav'`(本期只产 wav)
  - 拼请求体 JSON(⚠️ **OpenAI 标准格式,非 data URL**):
    - `model: config.model`(mimo-v2.5)
    - `messages: [{ role: "user", content: [
        { type:"input_audio", input_audio:{ format:"wav", data: base64Audio } },   // 纯 base64,无 data: 前缀
        { type:"text", text:"Transcribe the speech...output [NO SPEECH]." } ] }]`
    - `max_completion_tokens: 4096`
  - POST `${config.baseUrl}/chat/completions`,headers `{ Authorization: "Bearer ${apiKey}", "Content-Type": "application/json" }`,body `JSON.stringify(...)`
  - fetch 外层 try/catch → 网络错误抛 `SttError("network_error", safeError(err, [apiKey]))`
  - 非 ok → 抛 `SttError(code, safeError(...))`,code 按 status 分 `auth_error`(401/403)/`api_error`
  - ok → `data.choices?.[0]?.message`,取 `msg.content ?? msg.reasoning_content ?? ''`,trim
  - 空或 === `'[NO SPEECH]'` → 抛 `SttError('empty_transcript', 'No speech detected.')`
- `SttError` 类(带 `code: "missing_api_key" | "network_error" | "auth_error" | "api_error" | "empty_transcript"`)

**与 pi-mimo-voice 的关键差异**(实测发现,DESIGN.md § 2.2/§ 7.2 已记):

- **input_audio 格式(最重要)**:mimo-voice 直连用 data URL(`data:"data:audio/wav;base64,..."`);经 inference 网关**必须**用 `{ format:"wav", data: <纯base64> }`。data URL 在网关下静默失败。**实现时切勿照抄 mimo-voice 源码!**
- 鉴权头:网关用 `Authorization: Bearer`(mimo-voice 直连用 `api-key` header)
- 错误处理:包成 `SttError(code, safeError(...))` 而非原样抛 message
- 空转写:抛 `SttError('empty_transcript')` 而非返回 `"[NO SPEECH]"` 让调用方判

**依赖 Phase 0.4 实测**:model `mimo-v2.5` 已确定,但需确认 inference 网关透传 audio content block、响应字段在 `content` 还是 `reasoning_content`。

### Step 5.2 — 实现 `providers/index.ts`

按 DESIGN.md § 7.1:

- `SttProvider` 接口:`{ transcribe(file, signal?): Promise<string> }`
- `createSttProvider(providerName): Promise<SttProvider>`:
  - `resolveProviderConfig(providerName)` 拿 `{ baseUrl, model }`
  - `resolveApiKey(providerName)` 拿 key;**无 key 抛 `SttError("missing_api_key", ...)`**(message 提示去 `/config` 或设 envVar)
  - 返回 `{ transcribe: (file, signal) => transcribeWithMimoChat(file, config, apiKey, signal) }`

### Step 5.3 — 单元测试 `__tests__/mimo-stt.test.ts`

用 fake `fetch`(注入或全局 stub)覆盖:

- 200 + JSON `{ choices: [{ message: { content: "hello" } }] }` → 返回 `"hello"`
- 200 + 只有 `reasoning_content` → fallback 取到文本
- 200 + `content: "[NO SPEECH]"` → 抛 `SttError("empty_transcript")`
- 401 → 抛 `SttError("auth_error", ...)`,且 message **不含明文 apiKey**(验证脱敏)
- fetch reject → 抛 `SttError("network_error", ...)`

## Phase 6:Flow 编排

> **关联**:DESIGN.md § 4 数据流、§ 8 Flow 编排。整合 Phase 2–5 的产物。

### Step 6.1 — 实现 `flow.ts` 的纯函数

- `mergeTranscript(existing, transcript, mode = "append")` — 按 DESIGN.md § 4 的逻辑:空 transcript 返回 existing;current 为空返回 text;current 末尾是空白直接拼接,否则补一个空格
- `withTimeout<T>(promise, timeoutMs, label): Promise<T>` — `Promise.race([promise, timeout])`,超时 reject `${label} timed out after ${timeoutMs}ms`。参考 talk-pi `voice-capture.ts`

### Step 6.2 — 实现 `VoiceInputFlow` 类

按 DESIGN.md § 8:

- 构造参数 `{ ctx, recorder, provider, config }`
- `startRecording()` — `recorder.start()` 存 activeFile + setWidget(`['🎙 recording — /voice-toggle 再次执行停止, /voice-cancel 取消']`)
- `finalizeRecording()` — setWidget(`['… transcribing']`) → `recorder.stop()` → `withTimeout(provider.transcribe(file), config.transcribeTimeoutMs, "Transcription")` → `insertTranscript(text)`;finally 里 `recorder.cleanup()` + setWidget(undefined) + activeFile=null
- `cancel()` — `recorder.cancel()` + setWidget(undefined)
- `insertTranscript(transcript)` — trim;空则 notify "No speech detected" warning + 返回 `{ inserted: false }`;非空则 `getEditorText` + `mergeTranscript` + `setEditorText` + notify "Transcript inserted" info
- 私有 `setWidget(lines | undefined)` / `fail(error)`(notify + safeError)

### Step 6.3 — 单元测试 `__tests__/flow.test.ts`

用 fake recorder / provider / ctx 覆盖:

- `mergeTranscript` 各种 current/transcript 组合(空、无尾空格、有尾空格)
- `withTimeout` 超时抛错、正常返回
- `finalizeRecording` 全流程:start → stop → transcribe "hello" → setEditorText 收到 append 后的文本 → cleanup 被调用
- `finalizeRecording` 空转写 → notify warning,不 setEditorText
- `finalizeRecording` transcribe 抛错 → fail notify,finally 仍 cleanup
- `cancel` → recorder.cancel 调用 + setWidget(undefined)

### Step 6.4 — 类型检查 + format + test

```bash
npx tsc --build
npm run format
npm test
```

---

## Phase 7:扩展入口

> **关联**:DESIGN.md § 9 扩展入口、§ 10 状态可视化。整合所有 Phase。

### Step 7.1 — 实现 `index.ts`

按 DESIGN.md § 9:

- 模块级 `let commandFlow: VoiceInputFlow | null = null` + `isRecording()` / `clearUi(ctx)` helper
- `newFlow(ctx, pi)` — loadConfig → selectRecorder → createSttProvider → `new VoiceInputFlow({ ctx, provider, config, recorder: new LocalAudioCapture({ recorder, device }) })`
- `pi.on("session_start", () => registerVoiceInputConfigItems())` — 启动时注册 config items,让 `/config` 能看到
- `pi.registerCommand("voice-toggle", ...)` — idle 时 newFlow + startRecording;recording 时 finalizeRecording;catch 里 clearUi + commandFlow=null + notify safeError
- `pi.registerCommand("voice-cancel", ...)` — 取 commandFlow 置 null + cancel + clearUi + notify
- `pi.registerCommand("voice-status", ...)` — loadConfig + resolveApiKey,notify 显示 provider/key configured or missing/recorder/recording 状态

**关键**:`voice-toggle` 在切换前先把 `commandFlow` 局部变量保存(`const flow = commandFlow; commandFlow = null;`),再 await finalize,避免重入。所有 catch 路径都显式 `commandFlow = null`。

### Step 7.2 — 手测

```bash
pi -e packages/voice-input/index.ts
```

在 TUI 中:

1. `/config` → 看到 voice-input section,可编辑 provider / apiKey / recorder
2. `/voice-status` → 显示当前配置
3. `/voice-toggle` → 浮层出现「🎙 recording」
4. 说话 → `/voice-toggle` → 浮层变「… transcribing」→ 输入框出现转写文本
5. `/voice-toggle` 开始 → `/voice-cancel` → 浮层消失,无文本插入
6. 故意填错 apiKey → `/voice-toggle` 两次 → notify 错误且**不含明文 key**

macOS + Linux(若可行 NixOS)双平台各跑一遍。

### Step 7.3 — 类型检查 + format + test

```bash
npx tsc --build
npm run format
npm test
```

---

## Phase 8:收尾

> **关联**:DESIGN.md § 13 实现验收清单。

### Step 8.1 — 编写 `packages/voice-input/README.md`

包含:

- 功能简介(STT 听写,云端优先,多 provider)
- 命令列表(`/voice-toggle`、`/voice-cancel`、`/voice-status` 用法)
- 快速开始(配置 apiKey → `/voice-toggle`)
- provider 说明(本期仅 inference-self-host,model mimo-v2.5,envVar INFERENCE_TWISTOY_API_KEY)
- 录音器依赖(NixOS/Linux ffmpeg 或 pulseaudioUtils,macOS ffmpeg,Windows ffmpeg)
- 配置说明(指向 `/config` 与 extension-config-ui)
- 链接到 `docs/pi-vox/DESIGN.md`

### Step 8.2 — 更新根 `AGENTS.md`

在 `packages/` 列表中新增条目:

```
- `packages/voice-input/` -- 语音听写扩展:spawn 跨平台录音 + 云端 OpenAI 兼容 STT + append 到输入框。命令 `/voice-toggle`/`/voice-cancel`/`/voice-status`。参考 `docs/pi-vox/`.
```

### Step 8.3 — 验收清单逐项过

对照 DESIGN.md § 13:

- [ ] `npx tsc --build` 无错
- [ ] `npm run format` 通过
- [ ] `npm test` 通过(config / secrets / recorder / capture / mimo-stt / flow 六套单测)
- [ ] `pi` 加载扩展后 `/config` 能看到 voice-input section,可编辑 provider/apiKey/recorder
- [ ] `/voice-status` 正确显示 provider / key / recorder 状态
- [ ] macOS + Linux 双平台录音→转写→插入流程跑通
- [ ] 转写失败时(故意填错 key)错误信息**不含明文 key**
- [ ] `/voice-cancel` 能中断录音并清浮层
- [ ] 临时录音文件在转写/取消后都被删除(检查 `$TMPDIR/voice-input-*` 无残留)

### Step 8.4 — 最终验证

```bash
npx tsc --build
npm run format
npm test
```

确认零错误、零格式问题、所有测试通过。

### Step 8.5 — 更新本文件 TODO 表

将 Phase 0–8 状态全部更新为 `[x]`,填写完成日期与 Phase 0 的 API 验证结果小节。

---

## 风险与回退点

| 风险 | 触发条件 | 回退方案 |
| --- | --- | --- |
| inference 网关不透传 audio content block(返回 400/415) | Phase 0.4 实测失败 | DESIGN.md § 2.1 改用直连小米官方 api.xiaomimimo.com(鉴权头 api-key)或退本地 whisper.cpp |
| `ctx.ui.setWidget` 签名不符 | Phase 0.1 发现 | DESIGN.md § 10 改用 `setStatus` 或 notify 兜底 |
| `getEditorText`/`setEditorText` 不可用 | Phase 0.1 发现 | DESIGN.md § 4 落点改为 `pasteToEditor`(talk-pi 有此 API)或退化为 notify 显示文本让用户复制 |
| ffmpeg exit code 白名单不准 | Phase 4/7 实测报错 | 扩展白名单或在 `selectRecorder` 文档化各平台预期 exit code |
| mimo-v2.5 转写文本在 reasoning_content 而非 content | Phase 0.4/5 实测 | `mimo-stt.ts` 已 fallback 两者;若都不在,记录响应结构后更新解析 |
| 模块级 `commandFlow` 在 reload 漏清 | Phase 7 手测发现 | 加 `session_start` 时 `commandFlow = null` 重置(DESIGN.md § 9 已提) |
