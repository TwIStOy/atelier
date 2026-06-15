# voice-input 设计文档

本文是 `packages/voice-input` 的实现设计,基于同目录三份审计文档的结论融合而成:

- [pi-vox/ANALYSIS.md](./ANALYSIS.md) — 听写 + 命令式 toggle + 纯函数状态机 + 密钥脱敏
- [ANALYSIS-pi-mimo-voice.md](./ANALYSIS-pi-mimo-voice.md) — 跨平台录音矩阵 + 多 provider + extension-config-ui 接入范式
- [ANALYSIS-talk-pi.md](./ANALYSIS-talk-pi.md) — WAV 手工封装 + 配置持久化 + footer 状态机

配套执行清单见 [DESIGN-STEPS.md](./DESIGN-STEPS.md)。

---

## 1. 范围与定位

| 维度 | 决策 |
| --- | --- |
| 功能范围 | **仅 STT 听写**(不做 TTS、不做 live mode、不暴露 LLM tool) |
| 引擎来源 | **云端优先**,复用 inference-self-host 的 `mimo-v2.5` 多模态 chat completions 转写(与 pi-mimo-voice 同一格式)。provider 抽象保留,本期仅内置一个预设 |
| 默认 provider | inference-self-host(`inference.twistoy.cn`,复用 `INFERENCE_TWISTOY_API_KEY`,model `mimo-v2.5`,走 `/chat/completions` 多模态) |
| 录音实现 | **spawn 跨平台命令**(ffmpeg/parecord/sox),无 native npm 依赖 |
| 触发方式 | **纯命令 toggle**:`/voice-toggle` 开始/停止,`/voice-cancel` 取消 |
| 文本落点 | **append 到输入框末尾**,autoSubmit 默认关闭,用户手动回车 |
| 配置管理 | 接入 **`extension-config-ui`**(`/config` 弹窗编辑),存 `$XDG_CONFIG_HOME/pi/extensions.json` |
| 状态可视化 | **`ctx.ui.setWidget` 浮层**(输入框上方「🎙 recording」/「… transcribing」) |

**非目标**(明确排除,避免范围蔓延):TTS 播放、push-to-talk 快捷键、CustomEditor 按键拦截、LLM 可调 tool、live 连续对话、术语校正 glossary、hold-to-talk。这些已在三份审计里评估,本期不做。

---

## 2. 关键约束与前置事实

### 2.1 inference-self-host 的 mimo-v2.5 支持多模态 chat 转写(与 pi-mimo-voice 一致)

`inference.twistoy.cn` 代理 `mimo-v2.5`,该模型支持多模态 audio input —— 通过标准的 OpenAI **chat completions** 接口(`/chat/completions`),把音频作为 `input_audio` content block、配合一条 text 指令要求转写。这是 pi-mimo-voice 已验证可行的格式(见 [ANALYSIS-pi-mimo-voice.md §4](./ANALYSIS-pi-mimo-voice.md)),复用 `INFERENCE_TWISTOY_API_KEY`。

**注意:不是 OpenAI 的 `/audio/transcriptions` multipart whisper 端点。** MiMo 的转写走的是 chat 多模态路径,请求体是 JSON,响应解析 `choices[0].message.content`。本设计完全采用这个格式。

### 2.2 调用格式(经 inference 网关,实测验证)

> ⚠️ **与 pi-mimo-voice 的格式不同!** mimo-voice 直连小米官方用 data URL 格式(`data: "data:audio/wav;base64,..."`),但经 inference.twistoy.cn 网关(byok 模式)时**必须用 OpenAI 标准格式**(`format` 字段 + 纯 base64)。data URL 格式在网关下会静默失败(返回 `[NO SPEECH]`、`audio_tokens: 0`)。详见实测 journal。

```ts
POST ${baseUrl}/chat/completions
Headers: {
  "Authorization": "Bearer ${apiKey}",   // 走 inference 网关用 Bearer
  "Content-Type": "application/json",
}
Body (JSON):
{
  "model": "mimo-v2.5",
  "messages": [{
    "role": "user",
    "content": [
      // ✅ OpenAI 标准格式(format + 纯 base64,无 data: 前缀)
      { "type": "input_audio",
        "input_audio": { "format": "wav", "data": "${base64Audio}" } },
      { "type": "text",
        "text": "Transcribe the speech in this audio to text. Output only the transcribed text, no explanations. If no speech is detected, output [NO SPEECH]." }
    ]
  }],
  "max_completion_tokens": 4096
}
响应解析:
  text = data.choices?.[0]?.message?.content
         ?? data.choices?.[0]?.message?.reasoning_content
         ?? ""
  // text === "[NO SPEECH]" 视为空转写
```

实测确认(2026-06-15):
- HTTP 200,响应 ~5 秒
- 中文/英文都正确转写
- 转写文本在 `choices[0].message.content`(`reasoning_content` 一般为空,作为 fallback)
- `usage.prompt_tokens_details.audio_tokens` 始终为 0(网关未统计 audio token,不影响功能)
- `image_url` 载体不被接受(400 "Multimodal data is corrupted")
- 鉴权头 `Authorization: Bearer` 被网关接受(inference-self-host provider 配置 `authHeader: true`)

### 2.2 extension-config-ui 接入范式(参考 `packages/web-tools`)

本仓库配置体系统一走 `@htwang-contrib/common` 的 `registerConfigItems` + `readConfig`/`writeConfig`,文件落在 `$XDG_CONFIG_HOME/pi/extensions.json` 的 `voice-input` section 下。多 provider 的 per-provider key 配置**完全照搬 web-tools 的 `apiKeys` 模式**(见 §5)。

### 2.3 跨平台录音命令矩阵(取自 pi-mimo-voice)

| 平台 | 首选 | ffmpeg 后端 | 默认设备 |
| --- | --- | --- | --- |
| Linux | `parecord`(PulseAudio) | `-f pulse -i default` | `default` |
| macOS | ffmpeg | `-f avfoundation -i :0` | `:0` 或 `$VOICE_INPUT_MIC_DEVICE` |
| Windows | ffmpeg | `-f dshow -i "audio=麦克风"` | `audio=麦克风` 或 `$VOICE_INPUT_MIC_DEVICE` |

统一输出 16kHz mono s16le WAV(STT 够用,省带宽)。NixOS 在 `shell.nix`/flake devShell 声明 `ffmpeg` 或 `pulseaudioFull` 即可,无需 native npm 包。

### 2.4 不碰 CustomEditor(刻意决策)

pi-vox 和 talk-pi 都重写 `CustomEditor.handleInput` 做 push-to-talk。本期**纯命令 toggle 不需要碰编辑器按键**,降低风险与复杂度——这也避开了 `CustomEditor` 相对内部 API 的稳定性问题(三份审计都标注为「高风险依赖」)。

---

## 3. 包结构

```
packages/voice-input/
├── package.json          ← @htwang-contrib/voice-input, peerDep: pi-coding-agent
├── tsconfig.json         ← extends ../../tsconfig.base.json, 根 tsconfig 加 reference
├── index.ts              ← 扩展入口:session_start + 3 命令 + config 注册
├── config.ts             ← 配置 schema + loadConfig + registerConfigItems
├── types.ts              ← VoiceInputConfig / SttProvider / Recorder 描述类型
├── audio/
│   ├── capture.ts        ← LocalAudioCapture(spawn recorder,start/stop/cancel/cleanup)
│   ├── recorder.ts       ← 跨平台命令选择(ffmpeg/parecord/sox + MIC_DEVICE)
│   └── wav.ts            ← spawn 产 WAV 的校验与 cleanup(不做手工 header,spawn 直接出 wav)
├── providers/
│   ├── index.ts          ← createSttProvider 工厂 + resolveProviderConfig
│   ├── mimo-stt.ts       ← MiMo chat 多模态转写客户端(POST /chat/completions + input_audio block)
│   └── presets.ts        ← 内置 provider 清单(本期仅 inference-self-host)
├── flow.ts               ← VoiceInputFlow:录音→上传→插入编排 + 状态回调
├── base64.ts             ← audio Buffer → base64 辅助(纯 base64,不拼 data URL)
├── secrets.ts            ← redactSecrets / safeError(取自 pi-vox,考虑后续提升到 common)
└── __tests__/
    ├── flow.test.ts
    ├── mimo-stt.test.ts
    ├── recorder.test.ts
    ├── capture.test.ts
    ├── secrets.test.ts
    └── config.test.ts
```

**为什么不像 pi-vox 那样拆 state-machine.ts?** 命令式 toggle 的状态极简(只有 idle / recording / transcribing),用 flow 内的局部状态 + 一个 `let commandFlow: VoiceInputFlow | null` 模块变量即可,无需纯函数状态机。状态机在 push-to-talk(hold warmup 阈值)场景才有价值,本期不做。

**为什么 secrets.ts 不直接放 common?** 按仓库 AGENTS.md「≥2 个包用才提升」原则,目前只有 voice-input 需要 redactSecrets。先放本包,若后续 web-tools 或其他包也暴露 key,再按 [pi-vox/ANALYSIS.md §9.1](./ANALYSIS.md) 提升到 `@htwang-contrib/common`。

---

## 4. 核心数据流

```
用户执行 /voice-toggle (idle)
  └─ flow.startRecording()
       └─ LocalAudioCapture.start()
            └─ mkdtemp $TMPDIR/voice-input-XXX
            └─ selectRecorder() → spawn('parecord'|'ffmpeg'|'sox', [...args, file])
       └─ ctx.ui.setWidget('voice-input', ['🎙 recording — /voice-toggle 再次执行停止'])
       └─ commandFlow = flow  (模块级引用)

用户执行 /voice-toggle (recording)
  └─ flow.finalizeRecording()
       └─ setStatus → setWidget(['… transcribing'])
       └─ LocalAudioCapture.stop()
            └─ child.kill('SIGINT')
            └─ 等 'exit'(超时 3000ms 抛 timeout,参考 pi-vox)
            └─ 校验 exit code(ffmpeg 允许 0/130/255,见 pi-vox ANALYSIS §5.1)
       └─ provider.transcribe(file)
            └─ 读 wav 进内存 → base64 → data URL
            └─ POST ${baseUrl}/chat/completions  (与 mimo-voice 同格式)
                 Authorization: Bearer ${apiKey}
                 JSON body: { model: "mimo-v2.5",
                              messages: [{ role:"user", content: [
                                { type:"input_audio", input_audio:{ data:"data:audio/wav;base64,..." }},
                                { type:"text", text:"Transcribe..." } ] }],
                              max_completion_tokens: 4096 }
            └─ text = data.choices[0].message.content ?? reasoning_content ?? ""
            └─ text === "[NO SPEECH]" 视为空转写
       └─ insertTranscript(text)
            └─ text.trim()
            └─ current = ctx.ui.getEditorText() ?? ''
            └─ next = mergeAppend(current, text)  // 智能补空格
            └─ ctx.ui.setEditorText(next)
            └─ ctx.ui.notify('Transcript inserted', 'info')
       └─ LocalAudioCapture.cleanup()  ← rm -rf 临时目录
       └─ setWidget(undefined)  ← 清浮层
       └─ commandFlow = null

用户执行 /voice-cancel (任意状态)
  └─ flow.cancel()
       └─ LocalAudioCapture.cancel()  ← SIGINT + 立即 cleanup
       └─ setWidget(undefined)
       └─ commandFlow = null
       └─ notify('Voice recording cancelled', 'info')
```

`mergeAppend(current, text)` 逻辑(取自 pi-vox `flow.js`):

```ts
export function mergeTranscript(existing, transcript) {
  const text = String(transcript ?? '').trim();
  if (!text) return existing ?? '';
  const current = existing ?? '';
  if (!current) return text;
  if (/\s$/.test(current)) return current + text;
  return `${current} ${text}`;
}
```

---

## 5. 配置模型

### 5.1 Schema(接入 extension-config-ui)

```ts
export interface VoiceInputConfig {
  provider: string;                  // 当前激活的 provider name(本期默认 "inference-self-host")
  providers: Record<string, { baseUrl: string; apiKey: string; model: string }>;
  recorder: 'auto' | 'ffmpeg' | 'parecord' | 'sox';  // 录音器选择
  micDevice: string;                 // 覆盖默认设备(空=平台默认)
  transcribeTimeoutMs: number;       // 转写超时,默认 60000
}
```

### 5.2 内置 provider 预设(`providers/presets.ts`)

本期仅内置一个预设(用户拍板)。provider 抽象保留以便后续扩展,但不预置其它:

```ts
export const STT_PROVIDER_PRESETS = [
  {
    name: 'inference-self-host',
    label: 'Inference Self-Host',
    baseUrl: 'https://inference.twistoy.cn/v1',
    defaultModel: 'mimo-v2.5',   // 网关现成的 MiMo 多模态模型
    envVar: 'INFERENCE_TWISTOY_API_KEY',   // key 解析优先级:config > envVar
  },
];
```

> 没有预置 openai/groq/elevenlabs,因为它们是 multipart `/audio/transcriptions` whisper 协议,与 mimo-v2.5 的 chat 多模态格式不同。若后续要支持,provider 抽象需扩展为多协议(见 §14 未纳入项)。

### 5.3 key 解析优先级

```ts
export function resolveApiKey(providerName: string): string | undefined {
  const config = loadConfig();
  const provider = config.providers[providerName];
  const preset = STT_PROVIDER_PRESETS.find(p => p.name === providerName);
  // 1. config 里显式存的 key
  if (provider?.apiKey?.trim()) return provider.apiKey.trim();
  // 2. 预设的 envVar
  if (preset?.envVar) {
    const env = process.env[preset.envVar]?.trim();
    if (env) return env;
  }
  return undefined;
}
```

这套「config > envVar」优先级**与 web-tools `resolveApiKey` 完全一致**。

### 5.4 extension-config-ui 注册项(`config.ts`)

```ts
export function registerVoiceInputConfigItems(): void {
  registerConfigItems('voice-input', [
    {
      key: 'provider', type: 'select', label: 'STT Provider',
      value: () => loadConfig().provider,
      options: () => STT_PROVIDER_PRESETS.map(p => ({
        label: resolveApiKey(p.name) ? `${p.label} ✓` : `${p.label} ✗`,
        value: p.name,
      })),
      description: '当前用于语音转写的 provider(本期仅 inference-self-host)',
      extensionLabel: 'Voice Input', order: 0,
    },
    ...STT_PROVIDER_PRESETS.flatMap((p, i) => [
      { key: `providers.${p.name}.baseUrl`, type: 'string' as const, label: `${p.label} Base URL`,
        value: () => loadConfig().providers[p.name]?.baseUrl ?? p.baseUrl,
        order: 10 + i*3, extensionLabel: 'Voice Input' },
      { key: `providers.${p.name}.apiKey`, type: 'string' as const, label: `${p.label} API Key`,
        value: () => resolveApiKey(p.name) ?? '',
        secret: true, envVar: p.envVar, placeholder: p.envVar,
        order: 11 + i*3, extensionLabel: 'Voice Input' },
      { key: `providers.${p.name}.model`, type: 'string' as const, label: `${p.label} Model`,
        value: () => loadConfig().providers[p.name]?.model ?? p.defaultModel,
        order: 12 + i*3, extensionLabel: 'Voice Input' },
    ]),
    { key: 'recorder', type: 'select', label: 'Recorder', /* ... */ order: 100, extensionLabel: 'Voice Input' },
    { key: 'micDevice', type: 'string', label: 'Mic Device Override', /* ... */ order: 101, extensionLabel: 'Voice Input' },
    { key: 'transcribeTimeoutMs', type: 'number', label: 'Transcribe Timeout (ms)', /* ... */ order: 102, extensionLabel: 'Voice Input' },
  ]);
}
```

> 去掉了原设计的 `transcribePath` 配置项 —— chat 多模态路径固定是 `/chat/completions`,无需配置。

---

## 6. 录音抽象(`audio/`)

### 6.1 LocalAudioCapture(`audio/capture.ts`)

取自 pi-vox `audio.js`,改造点:依赖注入保留(spawn/fs/tmpdir 可替换,便于测试)。

```ts
export class LocalAudioCapture {
  constructor(options: {
    spawn?: typeof spawn;
    recorder?: RecorderKind;          // 默认由 selectRecorder 决定
    device?: string;                  // micDevice 覆盖
    stopTimeoutMs?: number;           // 默认 3000
  }) {...}

  start(): { file: string } {
    // mkdtemp + spawn recorder,返回录音文件路径
  }
  async stop(): Promise<{ file: string }> {
    // SIGINT + 等 exit(超时抛错)+ 校验 exit code
  }
  async cancel(): Promise<void> {
    // SIGINT + 立即 cleanup(不等 exit)
  }
  cleanup(): void {
    // rmSync(dir, { recursive, force })
  }
}
```

exit code 白名单:**ffmpeg 允许 0/130/255**(255 是 macOS avfoundation SIGINT 的怪行为,见 [pi-vox ANALYSIS §5.1](./ANALYSIS.md));**parecord/sox 允许 0/130**。

### 6.2 跨平台命令选择(`audio/recorder.ts`)

```ts
export type RecorderKind = 'auto' | 'ffmpeg' | 'parecord' | 'sox';

export function selectRecorder(
  config: { recorder: RecorderKind },
  exists: (name: string) => boolean = commandExists,
): Exclude<RecorderKind, 'auto'> {
  if (config.recorder !== 'auto') return config.recorder;
  if (process.platform === 'linux' && exists('parecord')) return 'parecord';
  if (exists('ffmpeg')) return 'ffmpeg';
  if (exists('sox')) return 'sox';
  // 兜底:报错引导用户装
  throw new Error('No recorder found. Install ffmpeg, sox, or pulseaudioUtils (parecord).');
}

export function buildRecorderArgs(
  recorder: Exclude<RecorderKind, 'auto'>,
  file: string,
  device?: string,
): string[] {
  const rate = '16000', channels = '1';
  switch (recorder) {
    case 'ffmpeg': {
      // 取自 pi-mimo-voice getFfmpegRecordArgs
      const input = ffmpegInputArgs(device);
      return ['-y', ...input, '-ar', rate, '-ac', channels, '-f', 'wav', file];
    }
    case 'parecord':
      return ['--file-format=wav', '--channels=1', '--rate=16000', '--format=s16le', file];
    case 'sox':
      return ['-d', '-r', rate, '-c', channels, file];
  }
}

function ffmpegInputArgs(device?: string): string[] {
  switch (process.platform) {
    case 'darwin': return ['-f', 'avfoundation', '-i', device || ':0'];
    case 'win32':  return ['-f', 'dshow', '-i', device || 'audio=麦克风'];
    default:       return ['-f', 'pulse', '-i', device || 'default'];
  }
}
```

**与 pi-mimo-voice 的差异**:pi-mimo-voice 把 parecord 和 ffmpeg 分两段代码、两次 `new Promise`。这里统一成 `buildRecorderArgs` 一处,录音器选好后逻辑一致。

---

## 7. STT Provider(`providers/`)

### 7.1 统一接口

```ts
export interface SttProvider {
  transcribe(file: string, signal?: AbortSignal): Promise<string>;
}

export async function createSttProvider(providerName: string): Promise<SttProvider> {
  const config = resolveProviderConfig(providerName);
  const apiKey = resolveApiKey(providerName);
  if (!apiKey) throw new SttError('missing_api_key',
    `No API key for STT provider "${providerName}". Configure via /config or set env var.`);
  return { transcribe: (file, signal) => transcribeWithMimoChat(file, config, apiKey, signal) };
}
```

### 7.2 MiMo chat 多模态客户端(`providers/mimo-stt.ts`)

**完全采用 pi-mimo-voice `transcribeWithMimo` 的格式**(见 §2.2):

```ts
export async function transcribeWithMimoChat(
  file: string,
  config: { baseUrl: string; model: string },
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const base64Audio = (await readFile(file)).toString('base64');
  // 本期只产 wav;若未来支持 mp3,input_audio.format 改成 'mp3'

  let resp: Response;
  try {
    resp = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,    // 走 inference 网关用 Bearer
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,                   // mimo-v2.5
        messages: [{
          role: 'user',
          content: [
            // ⚠️ OpenAI 标准格式:format + 纯 base64(网关要求,非 data URL)
            { type: 'input_audio',
              input_audio: { format: 'wav', data: base64Audio } },
            { type: 'text',
              text: 'Transcribe the speech in this audio to text. Output only the transcribed text, no explanations. If no speech is detected, output [NO SPEECH].' },
          ],
        }],
        max_completion_tokens: 4096,
      }),
      signal,
    });
  } catch (error) {
    throw new SttError('network_error', safeError(error, [apiKey]));
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const code = resp.status === 401 || resp.status === 403 ? 'auth_error' : 'api_error';
    throw new SttError(code, safeError(`STT request failed (${resp.status}): ${body}`, [apiKey]));
  }

  const data = await resp.json() as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  };
  const msg = data.choices?.[0]?.message;
  const text = (msg?.content ?? msg?.reasoning_content ?? '').trim();
  if (!text || text === '[NO SPEECH]') {
    throw new SttError('empty_transcript', 'No speech detected.');
  }
  return text;
}
```

**与 pi-mimo-voice 的差异**(实测发现,见 journal):
- **input_audio 格式**:mimo-voice 直连小米官方用 data URL(`data: "data:audio/wav;base64,..."`);经 inference 网关**必须**用 OpenAI 标准 `{ format: "wav", data: "<纯base64>" }`。data URL 格式在网关下静默失败(返回 `[NO SPEECH]`)。
- 鉴权头:mimo-voice 直连小米官方用 `api-key: ${apiKey}`;我们走 inference 网关用标准 `Authorization: Bearer`(网关 `authHeader: true`)。
- 错误处理:mimo-voice 原样抛 message;我们包成 `SttError(code, safeError(...))`,message 过密钥脱敏。
- 空转写:mimo-voice 返回 `"[NO SPEECH]"` 让调用方判断;我们直接抛 `SttError('empty_transcript')`,flow 层统一处理。

`SttError` 带 code 字段:`missing_api_key` / `network_error` / `auth_error` / `api_error` / `empty_transcript`,flow 层可据 code 给不同 notify 提示。

---

## 8. Flow 编排(`flow.ts`)

```ts
export class VoiceInputFlow {
  constructor(private opts: {
    ctx: ExtensionContext;
    recorder: LocalAudioCapture;
    provider: SttProvider;
    config: VoiceInputConfig;
  }) {}

  private activeFile: string | null = null;

  async startRecording(): Promise<void> {
    const { file } = this.opts.recorder.start();
    this.activeFile = file;
    this.setWidget(['🎙 recording — /voice-toggle 再次执行停止, /voice-cancel 取消']);
  }

  async finalizeRecording(): Promise<{ inserted: boolean }> {
    this.setWidget(['… transcribing']);
    try {
      const stopped = await this.opts.recorder.stop();
      const text = await withTimeout(
        this.opts.provider.transcribe(stopped.file),
        this.opts.config.transcribeTimeoutMs,
        'Transcription',
      );
      return this.insertTranscript(text);
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.opts.recorder.cleanup();
      this.setWidget(undefined);
      this.activeFile = null;
    }
  }

  async cancel(): Promise<void> {
    await this.opts.recorder.cancel();
    this.setWidget(undefined);
    this.activeFile = null;
  }

  private async insertTranscript(transcript: string): Promise<{ inserted: boolean }> {
    const text = String(transcript ?? '').trim();
    if (!text) {
      this.opts.ctx.ui.notify('No speech detected', 'warning');
      return { inserted: false };
    }
    const current = this.opts.ctx.ui.getEditorText?.() ?? '';
    const next = mergeTranscript(current, text);
    this.opts.ctx.ui.setEditorText?.(next);
    this.opts.ctx.ui.notify('Transcript inserted', 'info');
    return { inserted: true, text: next };
  }

  private setWidget(lines: string[] | undefined): void {
    this.opts.ctx.ui.setWidget?.('voice-input', lines);
  }
  private fail(error: unknown): void {
    this.opts.ctx.ui.notify(`Voice input failed: ${safeError(error)}`, 'warning');
  }
}
```

`withTimeout` 用 `Promise.race` + setTimeout,取自 talk-pi `voice-capture.ts`。超时时间读 config(默认 60s)。

---

## 9. 扩展入口(`index.ts`)

```ts
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { loadConfig, registerVoiceInputConfigItems } from './config.ts';
import { LocalAudioCapture } from './audio/capture.ts';
import { selectRecorder, buildRecorderArgs } from './audio/recorder.ts';
import { createSttProvider } from './providers/index.ts';
import { VoiceInputFlow } from './flow.ts';
import { safeError } from './secrets.ts';

const EXTENSION_ID = 'voice-input';

let commandFlow: VoiceInputFlow | null = null;

function isRecording(): boolean {
  return commandFlow !== null;
}

function clearUi(ctx: ExtensionContext): void {
  ctx.ui.setWidget?.(EXTENSION_ID, undefined);
}

async function newFlow(ctx: ExtensionContext, pi: ExtensionAPI): Promise<VoiceInputFlow> {
  const config = loadConfig();
  const recorder = selectRecorder(config);
  const provider = await createSttProvider(config.provider);
  return new VoiceInputFlow({
    ctx,
    provider,
    config,
    recorder: new LocalAudioCapture({ recorder, device: config.micDevice }),
  });
}

export default function (pi: ExtensionAPI): void {
  pi.on('session_start', () => {
    registerVoiceInputConfigItems();
  });

  pi.registerCommand('voice-toggle', {
    description: 'Toggle voice recording on/off',
    handler: async (_args, ctx) => {
      try {
        if (!isRecording()) {
          commandFlow = await newFlow(ctx, pi);
          await commandFlow.startRecording();
          return;
        }
        const flow = commandFlow;
        commandFlow = null;
        await flow.finalizeRecording();
      } catch (error) {
        clearUi(ctx);
        commandFlow = null;
        ctx.ui.notify(`Voice toggle failed: ${safeError(error)}`, 'warning');
      }
    },
  });

  pi.registerCommand('voice-cancel', {
    description: 'Cancel active voice recording',
    handler: async (_args, ctx) => {
      const flow = commandFlow;
      commandFlow = null;
      await flow?.cancel();
      clearUi(ctx);
      ctx.ui.notify('Voice recording cancelled', 'info');
    },
  });

  pi.registerCommand('voice-status', {
    description: 'Show voice input configuration status',
    handler: async (_args, ctx) => {
      const config = loadConfig();
      const apiKey = resolveApiKey(config.provider);
      ctx.ui.notify(
        `Voice input: provider=${config.provider}, key=${apiKey ? 'configured' : 'missing'}, recorder=${config.recorder}, recording=${isRecording() ? 'yes' : 'no'}`,
        apiKey ? 'info' : 'warning',
      );
    },
  });
}
```

**模块级 `commandFlow` 的风险**:三份审计都批评过 pi-vox / pi-mimo-voice 用模块级全局。本期接受这个简化(理由:纯命令 toggle、单 session、reload 时 `session_start` 重置风险低),但在 `voice-cancel` 和 `voice-toggle` 的 catch 里都显式置 `null`,保证失败路径不泄漏。若后续支持多 session 再迁移到 session 级存储。

---

## 10. 状态可视化

仅用 `ctx.ui.setWidget('voice-input', lines)` 浮层,三态:

| 状态 | 浮层内容 |
| --- | --- |
| recording | `['🎙 recording — /voice-toggle 再次执行停止, /voice-cancel 取消']` |
| transcribing | `['… transcribing']` |
| idle/error | `undefined`(清浮层) |

**不用 `setStatus`**(statusline 集成),**不用 footer emoji**(talk-pi 风格),保持最小化。用户在 `/voice-toggle` 后从浮层知道在录音,转写时浮层变化,完成自动消失。

错误用 `ctx.ui.notify(msg, 'warning')` 提示,内容过 `safeError` 脱敏。

---

## 11. 安全

### 11.1 密钥脱敏(取自 pi-vox `config.js`)

`secrets.ts` 提供 `redactSecrets(value, additionalSecrets)` 和 `safeError(error, additionalSecrets)`:

- 正则匹配 `Authorization: Bearer xxx` / `Bearer xxx` / `INFERENCE_TWISTOY_API_KEY=xxx` 模式(本期仅这一个 provider)
- 把所有 known key 字面量(从 `loadConfig().providers[*].apiKey` + 已解析的 env)替换为 `<redacted>`
- **所有对外可见字符串**(`notify`、`SttError.message`、widget)都过这个函数

### 11.2 临时文件

录音文件落在 `$TMPDIR/voice-input-XXX/recording.wav`,**用完即删**(`finalizeRecording` 和 `cancel` 的 finally 都 cleanup)。不保留录音历史(隐私)。

---

## 12. 与本仓库现有包的边界

| 包 | 关系 |
| --- | --- |
| `@htwang-contrib/common` | 用 `readConfig`/`writeConfig`/`registerConfigItems`/`ExtensionConfigSchema`。**暂不**加 redactSecrets(等 ≥2 包需要再提升) |
| `extension-config-ui` | voice-input 注册 config items 后,`/config` 自动出现编辑 UI,无需 voice-input 自己实现菜单 |
| `inference-self-host` | voice-input 默认 provider 指向 `inference.twistoy.cn`,复用 `INFERENCE_TWISTOY_API_KEY`,但**不 import** inference-self-host 包(只是 baseUrl 重叠) |
| `statusline` | 本期不集成(setWidget 浮层足够) |
| `protect-secrets` | 无直接关系;voice-input 自己的 redactSecrets 处理输出脱敏,protect-secrets 管「阻止读 secret 文件」,角度不同 |

---

## 13. 实现验收清单

移植完成后必须全部通过:

- [ ] `npx tsc --build` 无错
- [ ] `npm run format` 通过
- [ ] `npm test` 通过(flow / mimo-stt / recorder / config / secrets / capture 六套单测)
- [ ] `pi` 加载扩展后 `/config` 能看到 voice-input section,可编辑 provider/apiKey/recorder
- [ ] `/voice-status` 正确显示 provider / key / recorder 状态
- [ ] macOS + Linux 双平台录音→转写→插入流程跑通
- [ ] 转写失败时(故意填错 key)错误信息**不含明文 key**
- [ ] `/voice-cancel` 能中断录音并清浮层
- [ ] 临时录音文件在转写/取消后都被删除

---

## 14. 未纳入本期但已评估的扩展点

供后续迭代参考,本期**不实现**:

| 能力 | 来源 | 何时考虑 |
| --- | --- | --- |
| TTS 播放 | pi-mimo-voice / talk-pi | 若用户需要「朗读助手回复」 |
| Push-to-talk 快捷键 | pi-vox / talk-pi | 需重写 CustomEditor,稳定后再加 |
| LLM tool(voice_stt) | pi-mimo-voice | 开启「语音 agent」时 |
| Live 连续对话 | pi-mimo-voice | 需要 generation 计数器防竞态,复杂度高 |
| 本地 whisper.cpp fallback | talk-pi | native 依赖,NixOS 适配成本高,云端够用时不需要;且与 mimo-v2.5 多模态转写是两条不同路径 |
| 多协议 provider(OpenAI multipart whisper + MiMo chat) | — | mimo-voice/openai 用 multipart `/audio/transcriptions`,与本期 chat 多模态格式不同;若要支持需 provider 抽象扩展为多协议,本期不做 |
| 播放队列(mute/stop/block) | talk-pi | 仅在有 TTS 后才有意义 |
| Footer emoji 状态机 | talk-pi | 若接入 statusline 包 |
| 术语校正 glossary | pi-vox | 特定项目名常被识别错时再加 |
| Hold-to-talk warmup | pi-vox 状态机 | push-to-talk 实现后才有意义 |

---

## 附:决策溯源(用户拍板记录)

| 决策点 | 选择 | 备选 | 理由 |
| --- | --- | --- | --- |
| 功能范围 | 仅 STT 听写 | STT+TTS / 全功能 | 聚焦核心,跑通再扩 |
| 引擎来源 | 云端优先 | 本地优先 / 双栈 | 复用 inference key,零 native 依赖,NixOS 无忧 |
| STT API 格式 | **mimo-v2.5 chat 多模态(`/chat/completions` + OpenAI 标准 `input_audio` block)** | ~~data URL 格式(照搬 mimo-voice)~~、~~multipart `/audio/transcriptions`~~ | 实测:经 inference 网关必须用 `{format:"wav", data:纯base64}`,data URL 格式静默失败(见 journal) |
| STT provider 清单 | **仅 inference-self-host** | 多 provider(openai/groq/...) | 用户拍板;实测 mimo-v2.5 经网关转写中英文均正确 |
| 录音实现 | spawn 跨平台命令 | decibri native / 双实现 | 无 native 依赖,NixOS 声明即可 |
| 触发方式 | 纯命令 toggle | 快捷键 / LLM tool / live | 不碰 CustomEditor,降低风险 |
| 文本落点 | append + 手动发送 | replace / autoSubmit / send 命令 | 听写语义清晰,用户可编辑 |
| 配置管理 | extension-config-ui | 自建 JSON / 纯 env | 与本仓库统一,零文件编辑 |
| 状态可视化 | setWidget 浮层 | statusline footer / 仅 setStatus | 最小化,不耦合 statusline 包 |
