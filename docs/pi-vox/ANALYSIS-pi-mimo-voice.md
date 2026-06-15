# pi-mimo-voice 源码分析与语音集成方案

本文审计 [wenjinnn/pi-mimo-voice](https://github.com/wenjinnn/pi-mimo-voice)(npm `@wenjinnn/pi-mimo-voice` v1.1.1),完整阅读单文件入口 `index.ts`(~600 行)+ 中英文 README + package.json 后整理而成。与同目录 [pi-vox/ANALYSIS.md](./ANALYSIS.md) 对照阅读,两者代表了「语音集成进 pi」的**两条完全不同技术路线**。

---

## 1. pi-mimo-voice 是什么

一句话:**用小米 MiMo V2.5 API 给 pi 加双向语音**——既能把麦克风语音转成文字(STT),也能把文字合成语音播报(TTS)。比 pi-vox 多了 TTS,并且实现了「连续对话」(live mode)。

| 维度 | 选择 |
| --- | --- |
| STT 提供商 | **本地 whisper.cpp 优先**,失败 fallback 到 MiMo 音频理解 API(`mimo-v2.5` 多模态模型) |
| TTS 提供商 | 小米 MiMo V2.5 TTS(3 个模型:preset / voicedesign / voiceclone) |
| API key 来源 | **复用 pi 的 `~/.pi/agent/auth.json`**(`/login` 写入)+ 环境变量兜底 |
| 本地录音 | Linux `parecord` 优先 → 否则跨平台 `ffmpeg`(avfoundation/dshow/pulse) |
| 本地播放 | macOS `afplay` / Linux `paplay`/`aplay` / 通用 `ffplay`/`mpv`,按平台给优先级 |
| 触发方式 | **纯命令式**(`/listen`、`/live`)+ **LLM tool**(`mimo_tts`/`mimo_stt`) |
| 文本落点 | **`pi.sendUserMessage(text)` 直接发送**,不碰输入框 |
| 配置 | `/voice-config` 交互式菜单(`ctx.ui.select`/`input`),内存 state,无持久化文件 |
| 进程模型 | 扩展内 `child_process.spawn`,模块级全局变量持有录音/播放进程 |

---

## 2. 仓库结构

```
pi-mimo-voice/
├── index.ts                ← 唯一源文件(扩展入口,~600 行)
├── package.json            ← peerDep: pi-coding-agent / pi-tui / typebox
├── README.md               ← 英文文档
└── docs/README.zh-CN.md    ← 中文文档
```

**极简单文件架构**,与 pi-vox 的 8 文件分离形成鲜明对比。所有逻辑(常量、state、录音、TTS、STT、命令、tool、事件)都塞在一个 `index.ts` 里。

`package.json` 关键字段:

```jsonc
{
  "name": "@wenjinnn/pi-mimo-voice",
  "pi": { "extensions": ["./index.ts"] },   // 直接指向 .ts,pi 原生加载
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",          // 用到了 Text 组件
    "typebox": "*"                           // tool 参数 schema
  }
}
```

注意它比 pi-vox 多依赖 **`@earendil-works/pi-tui`**(用 `Text` 渲染 message)和 **`typebox`**(声明 tool 参数类型),少一个 `files` 白名单——意味着发包时连 docs 一起带上(`.npmignore` 只排除了 assets/docs/.git)。

---

## 3. 集成进 pi 的四条腿

pi-mimo-voice 用了**四个** pi 扩展 API,比 pi-vox 多一条(tool 注册 + message renderer)。

### 3.1 腿一:`registerCommand` → 5 个用户命令

| 命令 | 作用 |
| --- | --- |
| `/speak <text>` | TTS 朗读文字,播完用 `pi.sendMessage` 记录一条 `🔊 [TTS]` 消息 |
| `/listen`、`/listen stop`、`/listen N`、`/listen auto-stop N` | STT 录音,转写后 **`pi.sendUserMessage(text)` 直接发给 agent**(不入输入框) |
| `/live`、`/live reply` | 连续对话模式,详见 §5 |
| `/auto-speak`、`/auto-speak on\|off` | 开关「自动朗读 assistant 回复」 |
| `/voice-config` | 交互式菜单配置 voice/model/engine/region(详见 §6) |

**关键差异**:pi-vox 把转写文本 `setEditorText()` 塞回输入框让用户再编辑/发送;pi-mimo-voice **直接 `sendUserMessage`**,不给用户修改机会——更接近「对话」,pi-vox 更接近「听写」。

### 3.2 腿二:`registerTool` → 两个 LLM 工具

这是 pi-vox **完全没有**的能力——把语音能力暴露给 **agent 自己**调用:

```ts
pi.registerTool({
  name: "mimo_tts",
  label: "MiMo TTS",
  description: "Convert text to speech using MiMo V2.5 TTS...",
  promptSnippet: "Speak text aloud using MiMo TTS voice synthesis",
  promptGuidelines: [
    "Use mimo_tts when the user asks to hear text spoken aloud... or says '说给我听' / '读出来'.",
    "Use mimo_tts with a style instruction for expressive speech...",
  ],
  parameters: Type.Object({
    text: Type.String({...}),
    style: Type.Optional(Type.String({...})),
  }),
  async execute(_toolCallId, params, _signal, onUpdate, ctx) { ... }
});
```

`mimo_stt` 同理。`promptGuidelines` 用中英双语触发词(`说给我听`/`读出来`/`listen`/`record`),引导 agent 在合适时机调用。

这意味着 **agent 可以自主决定「这句话我念给你听」或「我录一下你说的话」**,无需用户敲命令。

### 3.3 腿三:`message_end` 事件 → auto-speak

监听 assistant 消息结束,自动 TTS:

```ts
pi.on("message_end", async (event, ctx) => {
  if (!state.autoSpeak || event.message.role !== "assistant") return;
  // ... 提取 text(content 可能是 string 或 content blocks 数组)...
  // 截断到 2000 字符
  const audioBuffer = await callMimoTTS(ttsText);
  await playAudio(audioFile);
  // 如果在 live mode,且这轮 TTS 期间没被 toggle,重启录音
  if (_liveMode && _liveModeGeneration === generationBeforeTTS) {
    await startLiveListen(ctx);
  }
});
```

这里有三个**精巧的防循环 / 防竞态设计**(详见 §5、§7):

- `_autoSpeakInProgress`:防止 TTS 输出又触发 message_end 递归
- `_ttsJustPlayed`:`mimo_tts` tool 播完后置位,让同 turn 的 message_end 跳过(避免 tool 播一次 + auto-speak 又播一次)
- `_liveModeGeneration`:live mode 的「代际计数器」,防止 TTS 播放期间用户 toggle 关闭后,旧 callback 还在重启录音

### 3.4 腿四:`registerMessageRenderer` + `sendMessage` → 持久化语音记录

```ts
pi.registerMessageRenderer("mimo-voice", (message, _options, theme) => {
  return new Text(theme.fg("accent", message.content), 0, 0);
});
```

每次 `/speak` 或 `/listen` 转写完,都用 `pi.sendMessage({ customType: "mimo-voice", content, display: true }, { deliverAs: "followUp" })` 注入一条带 customType 的消息,由上面注册的 renderer 渲染成 accent 色。这让语音事件在聊天历史里**留痕可回溯**(显示 `🎤 [STT 3.2s] xxx` / `🔊 [TTS] xxx`)。

---

## 4. API key 解析链(亮点设计)

`getApiKey()` 是这个项目最值得借鉴的部分,它**复用了 pi 的 `/login` 体系**而不是自建一套:

```ts
function getApiKey(): string {
  if (_cachedApiKey) return _cachedApiKey;          // 进程内缓存

  // 1. 环境变量(按优先级)
  const envVars = [
    ["MIMO_API_KEY", "xiaomi"],
    ["XIAOMI_TOKEN_PLAN_CN_API_KEY", "xiaomi-token-plan-cn"],
    ["XIAOMI_API_KEY", "xiaomi"],
  ];
  for (const [envKey, provider] of envVars) { ... }

  // 2. 读 pi 的 ~/.pi/agent/auth.json
  const providers = [
    "xiaomi-token-plan-cn", "xiaomi",
    "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp",
  ];
  for (const p of providers) {
    const key = resolvePiAuthKey(p);  // 支持 !command / ENV_VAR / 字面量
    if (key) return key;
  }
  throw new Error("MiMo API key not found...");
}
```

`resolvePiAuthKey` 支持 auth.json 里 key 字段的三种形态:

| 形态 | 含义 |
| --- | --- |
| `"!some-shell-command"` | 执行后面的 shell 命令取 stdout(适配 password manager / 1pass-cli) |
| `"ENV_VAR_NAME"` | 从环境变量取(注意不是字面量) |
| `"sk-xxxxx"` 或长度 > 20 | 当作字面量 key |

这跟 pi 原生 provider 的 key 解析规则一致,所以**用户只要 `pi /login` 选 MiMo provider 输一次 key,语音扩展自动就能用**——零额外配置。这是 pi-vox 做不到的(pi-vox 要单独 `export ELEVENLABS_API_KEY`)。

还内置 4 个 region 端点(CN/AMS/SGP/Global),`getApiBase()` 根据 resolved provider 自动选,用户也能 `/voice-config` 手动覆盖。

> ⚠️ **安全注意**:`resolvePiAuthKey` 用 `execSync(\`cat '${authPath}'\`)` 读文件 + 可能 `execSync(keyValue.slice(1))` 执行任意命令。前者有路径注入风险(虽然 HOME 可控),后者是 auth.json 里 `!` 前缀的**设计功能**但等于赋予 auth.json 作者任意命令执行权——在本仓库 `protect-secrets` 的语境下值得审视。

---

## 5. Live Mode(连续对话)的状态机

live mode 是这个项目最复杂的状态管理,目标是实现「说话→AI 回→AI 念→再听」的循环:

```
/live          → _liveMode=true, autoSpeak=true, startRecording()
                 (fire-and-forget,onFinish callback 会转写+发送)
用户说话
/live reply    → stopRecording() → 触发 onFinish callback
                 → transcribeAudio → sendUserMessage(text)
agent 回复     → message_end 事件 → auto-speak TTS 播报
                 → 播完后 if (_liveMode && generation 匹配) startLiveListen()
                 → 下一轮录音开始
/live          → _liveMode=false, generation++, stopAudio, stopRecording(cancel)
```

**`_liveModeGeneration` 是关键**:每次 toggle 都 `++`,TTS 开始前 capture `generationBeforeTTS`,TTS 结束后比对——如果不等,说明用户在 TTS 期间关掉了 live,**不重启录音**。这避免了「关掉后旧 callback 还在偷偷录」的竞态。

录音用 `startRecording(onFinish, maxDurationMs)`:spawn 进程 + setTimeout 兜底(默认 120s),`_recordingCancelled` 标志区分「正常 stop 要转写」vs「cancel 要删文件」。

---

## 6. 跨平台录音/播放矩阵

这是 pi-mimo-voice 明显**优于** pi-vox 的地方:

### 录音(`getFfmpegRecordArgs` + parecord 分支)

| 平台 | 首选 | ffmpeg 后端 | 默认设备 |
| --- | --- | --- | --- |
| Linux | `parecord`(PulseAudio,16kHz mono s16le) | `-f pulse -i default` | `default` |
| macOS | ffmpeg | `-f avfoundation -i :0` | `:0` 或 `$MIC_DEVICE` |
| Windows | ffmpeg | `-f dshow -i "audio=麦克风"` | `audio=麦克风` 或 `$MIC_DEVICE` |

统一参数 `-ar 16000 -ac 1`(16kHz 单声道),STT 够用且省带宽。

### 播放(`playAudio`)

按平台给候选列表,**第一个 `cmdExists` 的就用**:

- macOS:`afplay`(系统自带,最可靠)→ `ffplay` → `mpv`
- Linux:`paplay` → `aplay` → `ffplay` → `mpv`
- 通用兜底:`ffplay` → `mpv`

`stopAudio()` kill 当前播放进程,用于 `/auto-speak off` 或 live mode 关闭时打断。

> 对比 pi-vox:pi-vox 的 ffmpeg `-f avfoundation` **只在 macOS 工作**,Linux/Windows 直接废;pi-mimo-voice 是真·跨平台。本仓库作者主力 NixOS,这个差异很关键。

---

## 7. STT 双引擎与 fallback

```ts
async function transcribeAudio(audioPath: string): Promise<string> {
  if (state.sttEngine === "whisper") {
    try { return await transcribeWithWhisper(audioPath); }
    catch (e) {
      console.error(`whisper failed, falling back to MiMo: ${e}`);
      return await transcribeWithMimo(audioPath);   // 自动降级
    }
  }
  return await transcribeWithMimo(audioPath);
}
```

- **whisper.cpp(本地)**:`spawn` whisper-cpp 二进制 + ggml 模型,输出 txt 文件再读回。`findWhisper()`/`findWhisperModel()` 在 `session_start` 时探测,探测失败自动切 `sttEngine = "mimo"`。模型查找路径包括 `~/.cache/whisper/ggml-*.bin` 和 `$WHISPER_MODEL`。
- **MiMo API(云)**:用 `mimo-v2.5` 多模态模型,音频 base64 塞进 `input_audio` content block,prompt 要求「只输出转写文本,无语音输出 `[NO SPEECH]`」。

`session_start` 自动探测本地能力,有 whisper 就优先本地(更快、零 API 成本、隐私好),失败再 fallback 云端——**渐进增强**思路。

---

## 8. 与 pi-vox 的路线对比(核心章节)

两者解决「语音 + pi」但选了**正交的两条路**:

| 维度 | pi-vox | pi-mimo-voice |
| --- | --- | --- |
| **集成哲学** | 听写工具(dictation) | 对话助手(voice assistant) |
| **方向** | 仅 STT(语音→文字) | STT + TTS(双向) |
| **输入框** | **包装 CustomEditor**,文本塞进输入框可编辑 | **不碰输入框**,`sendUserMessage` 直接发 |
| **触发** | `/voice-toggle` 或 hold-space(实验) | `/listen`、`/live`、`mimo_stt` tool |
| **agent 参与** | 无,纯用户操作 | **agent 可调 mimo_tts/mimo_stt tool** |
| **TTS** | 无 | MiMo V2.5(含 voice clone / design) |
| **STT 引擎** | ElevenLabs Scribe(仅云) | whisper.cpp 本地优先 + MiMo API fallback |
| **API key** | 自建 `$ELEVENLABS_API_KEY` + `.env` | **复用 pi auth.json `/login`** |
| **平台** | macOS(sox/rec)或半残 ffmpeg | 真·跨平台(Linux/macOS/Windows) |
| **配置 UI** | 手改 JSON + `/voice-glossary` | `/voice-config` 交互菜单 |
| **配置持久化** | `~/.pi/pi-vox/config.json` | **无持久化**,内存 state(重启丢失) |
| **状态管理** | 模块级全局(commandFlow) | 模块级全局(_recordingProc 等,更多) |
| **代码组织** | 8 文件分离 + 纯函数状态机 | 单文件 600 行,无状态机抽象 |
| **语言/类型** | 纯 .js | TypeScript |
| **测试** | 9 个 node:test 单测 | **无测试** |
| **密钥脱敏** | 全覆盖 redactSecrets | **无**,错误信息原样抛 |
| **术语校正** | 有(py vox→pi-vox glossary) | 无 |
| **消息留痕** | 无,只改输入框 | 有,sendMessage + customType renderer |

### 8.1 各自的核心优势

**pi-vox 强在**:

- 工程严谨:纯函数状态机、依赖注入、密钥脱敏全覆盖、9 个单测
- 「听写」语义清晰:文本进输入框可编辑,符合「语音替代打字」心智
- CustomEditor 包装透传按键,不破坏正常输入

**pi-mimo-voice 强在**:

- 功能完整:双向语音 + live mode + agent tool 调用
- 用户体验零配置:复用 `/login`,开机即用
- 真·跨平台录音/播放矩阵
- 本地 STT 优先(隐私 + 成本 + 离线)
- 把语音能力暴露给 agent(promptGuidelines 引导),打开了「语音 agent」的可能性

### 8.2 各自的主要短板

**pi-vox 弱在**:macOS-only、单 provider、无 TTS、无 agent 集成、模块级全局状态。

**pi-mimo-voice 弱在**:

- **无配置持久化**——每次重启 voice/model/region 都重置,只能靠 env var 兜底,这是明显的产品缺陷
- **无测试**——600 行单文件零覆盖,live mode 那套 generation 计数器逻辑很容易回归
- **无密钥脱敏**——错误信息 `MiMo TTS API 401: <body>` 可能带 key,与 pi-vox 形成对比
- **单文件 600 行**——录音/TTS/STT/命令/tool/事件全混一起,可读性和可维护性差
- **模块级全局状态过多**:`_recordingProc`、`_liveMode`、`_liveModeGeneration`、`_autoSpeakInProgress`、`_ttsJustPlayed`、`_cachedApiKey`、`_resolvedProvider` 七八个全局,并发/reload 下脆弱
- **`resolvePiAuthKey` 的 `!command` 执行**——安全面值得审视

---

## 9. 对本仓库(`hawtian-pi-extensions`)的可借鉴点

### 9.1 直接可复用的模式

| 模式 | 来源 | 用途 |
| --- | --- | --- |
| **复用 pi auth.json 拿 key** | pi-mimo-voice `resolvePiAuthKey` | 本仓库 `inference-self-host`、`zai-coding-plan` 都读特定 env var,可考虑统一对接 `/login` 体系,降低用户配置成本 |
| **`registerMessageRenderer` + customType** | pi-mimo-voice | 本仓库各种事件(todo、goal、btw)若要留痕可借鉴,goal 的 continuation prompt 是 `display:false`,这里是 `display:true` 留痕 |
| **tool 的 `promptGuidelines` 中英双语触发词** | pi-mimo-voice mimo_tts | 本仓库给 agent 暴露工具时(prompt-driven)可参考,引导 agent 调用 |
| **跨平台 recorder/player 矩阵** | pi-mimo-voice | 比 pi-vox 完整,移植语音包时直接照搬 |
| **本地优先 + 云 fallback** | pi-mimo-voice STT | 渐进增强,适合本仓库多环境(NixOS 本地 + 云) |
| **generation 计数器防竞态** | pi-mimo-voice live mode | 任何「异步 callback + 用户可 toggle」场景通用 |

### 9.2 若移植语音包,推荐融合两者

结合 [pi-vox/ANALYSIS.md §7](./ANALYSIS.md) 的结论,一个理想的 `packages/voice-input` 应该:

```
packages/voice-input/
├── config.ts          ← 融合:pi-vox 的 redactSecrets + pi-mimo-voice 的 auth.json 解析 + 持久化(补 pi-mimo-voice 的缺失)
├── state-machine.ts   ← 照搬 pi-vox 的纯函数状态机(pi-mimo-voice 没有)
├── audio/
│   ├── capture.ts     ← 照搬 pi-mimo-voice 的跨平台矩阵 + pi-vox 的 LocalAudioCapture 注入设计
│   └── playback.ts    ← pi-mimo-voice 的 playAudio + stopAudio
├── providers/
│   ├── stt/           ← whisper.cpp(本地)+ ElevenLabs + MiMo + OpenAI Whisper(可接 inference-self-host)
│   └── tts/           ← MiMo + 可选其他
├── flow.ts            ← pi-vox 的 flow 抽象,但文本落点支持两种模式:
│                         'dictation'(setEditorText,pi-vox 风格)
│                         'conversation'(sendUserMessage,pi-mimo-voice 风格)
├── tools.ts           ← pi-mimo-voice 的 registerTool(语音能力给 agent)
├── live-mode.ts       ← pi-mimo-voice 的 live mode + generation 计数器
└── index.ts           ← 命令 + 事件注册
```

**关键决策**:

1. **状态机要从 pi-vox 借**——pi-mimo-voice 没有状态抽象,7 个全局变量是债。
2. **配置要持久化**——补 pi-mimo-voice 的缺口,参考 pi-vox 的 `~/.pi/pi-vox/config.json` 或本仓库 `extension-config-ui`。
3. **密钥脱敏要从 pi-vox 借**——pi-mimo-voice 完全没有,是安全 regression。
4. **跨平台要从 pi-mimo-voice 借**——pi-vox 的 ffmpeg 只在 macOS 工作。
5. **agent tool 要从 pi-mimo-voice 借**——这是「语音 agent」的入口,pi-vox 完全没有。
6. **测试要从 pi-vox 借**——pi-mimo-voice 零测试不可接受。

### 9.3 provider 融合机会

本仓库已有 `inference-self-host`(聚合 GLM/Qwen/DeepSeek/Kimi 等上游)。若这些上游或自建网关支持 STT/TTS(如 OpenAI 兼容的 `/audio/transcriptions`、`/audio/speech`),voice 包的 provider 层可**直接复用 `INFERENCE_TWISTOY_API_KEY`**,无需用户再配 MiMo/ElevenLabs key。这是 pi-vox 和 pi-mimo-voice 都没做到的**第三个 key 来源**。

---

## 10. 结论

| 结论 | 说明 |
| --- | --- |
| **两条正交路线** | pi-vox = 听写(输入框集成),pi-mimo-voice = 对话(消息流集成 + agent tool)。互补而非互斥 |
| **pi-mimo-voice 产品更完整** | 双向 + live + agent tool + 跨平台 + 零配置,功能面完胜 pi-vox |
| **pi-vox 工程更扎实** | 状态机 + 依赖注入 + 测试 + 脱敏,代码质量明显更高 |
| **理想方案是融合** | 取 pi-vox 的工程严谨 + pi-mimo-voice 的功能完整,详见 §9.2 |
| **本仓库可立即借鉴** | auth.json key 解析、message renderer、tool promptGuidelines、跨平台录音矩阵、generation 防竞态——这些模式不止用于语音 |
| **优先级**:中高 | 比 pi-vox 更值得移植(功能完整 + 真·跨平台),但要补工程债 |

---

## 附:源码规模速查

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `index.ts` | ~600 | **全部**:常量、state、录音/播放、TTS/STT、5 命令、2 tool、message renderer、事件、live mode |

(无 `src/` 目录,无测试,无构建配置)
