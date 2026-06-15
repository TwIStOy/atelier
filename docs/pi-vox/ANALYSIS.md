# pi-vox 源码分析与语音输入集成方案

本文审计 [denismrvoljak/pi-vox](https://github.com/denismrvoljak/pi-vox)(commit: `2026-06-11-ffmpeg-255-fallback`,version 0.1.0),完整阅读 `src/` 8 个文件 + `extensions/pi-vox.js` 入口 + 9 个测试文件后整理而成。目的是搞清楚它如何把语音输入「集成进 pi」,以及哪些设计可被本仓库(`hawtian-pi-extensions`)借鉴/复用。

---

## 1. pi-vox 是什么

一句话:**录麦克风 → 发给 ElevenLabs STT → 把识别文本塞回 pi 输入框**。它**不是** TTS、不是唤醒词、不是常驻守护进程,只是一个「按一下说话,再按一下插入文本」的听写工具。

| 维度 | 选择 |
| --- | --- |
| STT 提供商 | 仅 [ElevenLabs Scribe](https://api.elevenlabs.io/v1/speech-to-text),模型 `scribe_v1` |
| 本地录音 | spawn `rec` / `sox` / `ffmpeg` 三选一(`auto` 模式按优先级探测) |
| 触发方式 | **命令式 toggle**(`/voice-toggle`)为默认;hold-to-talk 是「内部支持但默认关闭」的隐藏路径 |
| 文本落点 | `ctx.ui.setEditorText()` 直接改输入框,默认 append 模式 |
| 进程模型 | **不起新进程**,纯扩展内 `child_process.spawn`,临时 wav 文件用完即删 |
| 配置 | `~/.pi/pi-vox/config.json` + `.env` 文件 + 环境变量三层合并 |

---

## 2. 仓库结构

```
pi-vox/
├── extensions/pi-vox.js      ← 扩展入口(pi.extensions 指向它)
├── src/
│   ├── audio.js              ← LocalAudioCapture:spawn 录音器
│   ├── config.js             ← 配置默认值 / .env 解析 / 密钥脱敏
│   ├── flow.js               ← VoiceInputFlow:录音→转写→插入编排
│   ├── key-handler.js        ← VoiceKeyHandler:键盘事件→状态机事件
│   ├── providers.js          ← ElevenLabs HTTP 客户端
│   ├── state-machine.js      ← 纯函数状态机
│   ├── transcript-cleanup.js ← 识别文本「术语校正」(py vox → pi-vox)
│   └── transcript-normalizer.js ← 仅 re-export
├── tests/*.test.js           ← 9 个 node:test 单元测试
└── package.json              ← "type":"module",pi.extensions=["./extensions"]
```

关键点:

- **没有构建步骤**,纯 ESM `.js`,pi 直接加载(与本仓库「No build step」一致,但本仓库是 `.ts`)。
- `package.json` 通过 `"pi": { "extensions": ["./extensions"] }` 让 `pi install` 知道入口在哪。`peerDependencies` 只声明 `@earendil-works/pi-coding-agent: *`。
- 测试用 Node 20 原生 `node:test`,无测试框架依赖。

---

## 3. 集成进 pi 的三条腿

pi-vox 把「语音输入」接入 pi 用了**三个独立的 pi 扩展 API**,缺一不可。下面逐个拆解。

### 3.1 腿一:`session_start` 事件 → 注入 CustomEditor

这是最核心、也最 hacky 的一步。pi 的输入框是一个 **Editor Component**,pi-vox 通过 `ctx.ui.setEditorComponent()` 把它**整个替换**成一个自己的子类,从而能拦截每一次按键。

```js
// extensions/pi-vox.js(简化)
pi.on('session_start', async (_event, ctx) => {
  const config = loadRuntimeVoiceConfig({});
  await installVoiceEditor(ctx, pi, config);
});

async function installVoiceEditor(ctx, pi, config) {
  const { CustomEditor } = await import('@earendil-works/pi-coding-agent');

  // 关键:拿到「上一个」factory,自己包一层
  const previousFactory = ctx.ui.getEditorComponent?.();
  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    const base = previousFactory?.(tui, theme, keybindings);  // 原始 editor 实例
    // ... 构造 VoiceEditor 子类 ...
    return new VoiceEditor(tui, theme, keybindings);
  });
}
```

`VoiceEditor extends CustomEditor`,重写 `handleInput(data)`:

- **Space 键**:`holdToTalk=false`(默认)时直接透传给 `base.handleInput`,**完全不影响正常打字**;`holdToTalk=true` 时才进入「按下启动 warmup → 超过阈值开始录音 → 松开 finalize」的流程。
- **`ctrl+v` / `escape`**:分别匹配 fallback toggle 和 cancel 快捷键。
- 其它所有键:**透传**给原始 editor,保证输入功能不破坏。

> ⚠️ **为什么 hold-to-talk 默认关掉?** README「Why it uses commands instead of hold-space」一节明确说:不同终端对 key press/release 的处理不一致,长按空格不可靠,还会干扰正常打字。所以默认走命令式 `/voice-toggle`,hold-to-talk 留作实验性内部能力。这是一个**重要的工程判断**——把「能用」放在「酷」前面。

`VoiceEditor` 还设了 `wantsKeyRelease = true`,告诉 pi 「我需要 release 事件」,否则 hold-to-talk 拿不到松开事件。

### 3.2 腿二:`registerCommand` → 三个用户命令

| 命令 | 作用 |
| --- | --- |
| `/voice-toggle` | **模块级 `commandFlow`/`commandRecording` 两个变量**记录状态。idle 时创建 flow + `startRecording`,recording 时 `finalizeRecording` + 清 UI |
| `/voice-cancel` | 调 `flow.cancel()` 删临时文件、清 UI |
| `/voice-glossary` | `list` / `add <canonical> <alias...>` / `clear`,直接读写 `~/.pi/pi-vox/config.json` |
| `/voice-status` | 打印版本、provider、key 是否配置、cleanup 开关、可用的录音器 |

注意 `/voice-toggle` 用的是**模块级全局变量**(`let commandFlow = null`)而不是把 flow 挂在 ctx 上——因为命令是 stateless handler,没有地方持久存 session 级状态。这是一种**简化但脆弱**的做法(多 session / reload 时可能漏清)。

还藏了一个 `finalizeCommandFlowWithFfmpegFallback`:ffmpeg 在 macOS avfoundation 下 `SIGINT` 停止时**经常以 exit code 255 退出**(本来是正常停止),所以这里捕获 255 错误后**强行继续转写**——这是一个针对 ffmpeg 怪行为的硬编码 workaround。

### 3.3 腿三:`ctx.ui` → 状态与文本注入

pi-vox 用到的 `ctx.ui` 方法清单(这是本仓库移植时最该确认的 API surface):

| 方法 | 用途 |
| --- | --- |
| `ctx.ui.setEditorComponent(factory)` | 腿一:替换输入框组件 |
| `ctx.ui.getEditorComponent()` | 拿到上一个 factory 做包装 |
| `ctx.ui.setEditorText(text)` | **把转写文本写回输入框**(核心) |
| `ctx.ui.getEditorText()` | 读当前输入框内容(append 模式需要) |
| `ctx.ui.setStatus('voice-input', str)` | 状态栏显示「recording / finalizing」 |
| `ctx.ui.setWidget('voice-input', lines)` | 输入框上方浮层显示「🎙 recording」 |
| `ctx.ui.notify(msg, level)` | 命令执行结果提示 |

另外 `ctx.pi.sendUserMessage(text, { deliverAs })` 用于 `autoSubmit=true` 时自动发送。`ctx.isIdle()` 判断 agent 是否空闲,决定 `deliverAs` 用默认还是 `'followUp'`。

---

## 4. 核心数据流(命令式 toggle 路径)

```
用户执行 /voice-toggle (idle)
  └─ createVoiceRuntime() → new VoiceInputFlow({ recorder, provider, machine })
  └─ flow.startRecording()
       └─ recorder.start()
            └─ mkdtemp /tmp/pi-voice-XXX
            └─ spawn('rec'|'sox'|'ffmpeg', [...args, file])
       └─ setStatus('voice: recording')
       └─ setWidget(['🎙 recording ...'])

用户执行 /voice-toggle (recording)
  └─ flow.finalizeRecording()
       └─ recorder.stop()
            └─ child.kill('SIGINT')
            └─ 等 'exit' 事件(超时 2000ms 抛 timeout)
            └─ 校验 exit code(ffmpeg 允许 0/130/255)
       └─ provider.transcribe(file)
            └─ POST https://api.elevenlabs.io/v1/speech-to-text
                 header: xi-api-key
                 body: FormData(file + model_id=scribe_v1)
       └─ insertTranscript(text)
            └─ cleanupTranscript() ← 术语校正
            └─ mergeTranscript(current, text, 'append')
            └─ setEditorText(merged)
            └─ [autoSubmit=true] sendUserMessage(merged)
       └─ recorder.cleanup() ← rm -rf 临时目录
```

---

## 5. 关键模块细节

### 5.1 `audio.js` — 本地录音抽象

`LocalAudioCapture` 是一个**可注入**的录音器(spawn/fs/tmpdir 都能从构造参数替换,方便测试):

- `rec` / `sox`:`[file]` 或 `['-d', file]`
- `ffmpeg`:macOS 专用 `['-y','-f','avfoundation','-i',':0', file]`(`:0` 表示默认音频输入设备)
- `stop()`:发 `SIGINT`,等 `exit` 事件,**2 秒超时**直接抛错
- 退出码白名单:`rec`/`sox` 允许 `0`/`130`(130 = SIGINT 正常退出),`ffmpeg` 额外允许 `255`(avfoundation 的怪行为)
- `cancel()`:SIGINT + 立即 cleanup(不等 exit)
- `cleanup()`:`rmSync(dir, { recursive, force })`

> **平台限制**:`-f avfoundation` 是 macOS 专属。Linux/Windows 上 ffmpeg 路径需要换 `-f pulse` / `-f dshow`,pi-vox 目前**没有处理**这一点——所以它的 ffmpeg 支持实际上只对 macOS 有效。`sox`/`rec` 是跨平台的,这才是它真正的主推方案。

### 5.2 `providers.js` — ElevenLabs 客户端

`transcribeWithElevenLabs(file, config, deps)`:

- 依赖注入 `fetch` / `readFileSync` / `signal`,便于测试 mock
- `new FormData()` + `new Blob([audio])` 拼请求体(ElevenLabs 要 multipart)
- 自定义错误类 `TranscriptionError` 带 `code`:`missing_api_key` / `network_error` / `auth_error`(401/403)/ `api_error` / `empty_transcript`
- **所有错误信息都过 `safeError()`**(见下文),保证 API key 不泄漏

`createProvider(config)` 是工厂,目前写死校验 `provider === 'elevenlabs'`,但**留了扩展点**——换 provider 只需加一个分支。

### 5.3 `config.js` — 配置与脱敏

三层合并:环境变量 > `.env` 文件 > `VOICE_CONFIG_DEFAULTS`。

**`redactSecrets()` 是亮点**:正则匹配 `ELEVENLABS_API_KEY=xxx` / `Authorization: Bearer xxx` / `Bearer xxx` 三种模式,以及把 `process.env.ELEVENLABS_API_KEY` 原值全局替换为 `<redacted>`。所有对外可见的字符串(notify、错误、diagnostics)**都过这个函数**。这是一个值得借鉴的安全实践——避免在 status bar / error toast 里意外暴露 key。

`.env` 解析是手写的简易 parser(`parseDotEnv`),支持引号剥离和注释,没引第三方库。

### 5.4 `state-machine.js` — 纯函数状态机

状态:`IDLE → WARMUP → RECORDING → FINALIZING → IDLE`(失败回 `IDLE` + error)。

`transitionVoiceState(current, event, config)` 是**纯函数**,返回 `[nextState, action]`。事件类型:`space_down` / `space_up` / `tick` / `toggle` / `cancel` / `finalized` / `empty_transcript` / `failure` / `timeout`。

**这是 hold-to-talk 路径的核心**,命令式 toggle 其实只用到 `toggle` / `cancel` / `finalized` 几个事件。warmup 状态是为了实现「按住超过 `holdThresholdMs`(默认 350ms)才真正开始录音,否则当作普通空格插入」——避免误触。

`hold` 和 `toggle` 两种 mode 区分:`hold` 模式下 RECORDING 状态收到 `toggle` 事件**不**会 finalize(防止 hold 和 toggle 混用混乱)。

### 5.5 `key-handler.js` — 键盘事件→状态机

`VoiceKeyHandler.handle(data, kind, originalData)`:

- 把原始按键映射成状态机事件(space → space_down/up,ctrl+v → toggle,escape → cancel)
- `apply()` 执行状态机返回的 action:`start_recording` / `finalize_recording` / `cancel_recording` / `insert_space`
- `passThrough` 回调:不被 voice 消费的事件回传给原始 editor
- action 失败时往状态机送 `failure` 事件,不抛出中断流程

### 5.6 `transcript-cleanup.js` — 术语校正

STT 经常把 `pi-vox` 识别成 `py vox` / `pie vox` / `bye vox`。这个模块:

- 内置 `DEFAULT_TRANSCRIPT_GLOSSARY`(pi-overwatch / pi-coding-agent / pi-vox / pi-tutor 四个本生态项目名)
- `aliasPattern(alias)`:把多词 alias 编译成正则,允许词间是空格/逗号/点/横线(`py-coding agent` 也能匹配 `py coding agent`)
- `\b...\b` 词边界 + `gi` 大小写不敏感
- 用户可在 config 里加自定义 glossary,或直接传 `transcriptReplacements` 二元组数组绕过 glossary 结构

`/voice-glossary add/clear/list` 命令就是操作这个配置。

---

## 6. 与本仓库(`hawtian-pi-extensions`)的对比

### 6.1 技术栈差异

| 项 | pi-vox | 本仓库 |
| --- | --- | --- |
| 语言 | 纯 ESM `.js` | ESM **`.ts`**,project references |
| 测试 | `node:test` | `npm test`(需确认 runner) |
| 格式化 | 无配置 | **每次改完必须 `npm run format`** |
| 配置位置 | `~/.pi/pi-vox/config.json` | 各包自定义(如 `extension-config-ui` 管) |
| 共享代码 | 无,单包 | `packages/common` 共享库 |
| 注释 | 几乎无 | 「No comments unless requested」 |

### 6.2 已存在的能力重叠

- **`packages/common`**:pi-vox 的 `redactSecrets` / `safeError` 这类工具,本仓库可考虑沉淀到 common(目前 `protect-secrets` 是**阻止**读 secret 文件,角度不同)。
- **`packages/ask-user-question`** / **`goal`** 都用过 `ctx.ui.setEditorComponent` 的「包装而非替换」模式——pi-vox 的 `previousFactory` 包装手法与之一致。
- **`packages/extra-tools`** 的 `grep`/`glob`/`ls` 也是「同名覆盖内置」,思路类似 CustomEditor 包装。

### 6.3 pi-vox 做得好的地方(值得学)

1. **密钥脱敏全覆盖**:所有对外字符串过 `redactSecrets`,不只在「显而易见」的地方。
2. **依赖注入**:recorder / provider / fs / fetch / clock 全部可从构造参数替换,测试不用 mock 全局。
3. **纯函数状态机**:`transitionVoiceState` 无副作用,逻辑可单测,与 `flow`(有副作用)分离干净。
4. **CustomEditor 包装而非覆盖**:保留 `previousFactory`,非 voice 按键透传,不破坏原有输入体验。
5. **ffmpeg 255 workaround**:针对真实平台怪行为的硬编码兜底,注释了 `2026-06-11-ffmpeg-255-fallback` 版本号溯源。
6. **默认安全**:`holdToTalk=false`,不干扰正常打字;临时音频文件用完即删;`autoSubmit=false` 默认不自动发送。

### 6.4 pi-vox 做得弱的地方(移植时要改)

1. **模块级全局状态**:`let commandFlow = null` 在多 session / reload 下可能漏清,本仓库应挂在 ctx 或 session store 上。
2. **平台假设**:`ffmpeg -f avfoundation` 硬编码 macOS,Linux/Windows 不工作。本仓库作者用 NixOS,需改 pulse/alsa。
3. **单 provider**:ElevenLabs 写死。本仓库 `inference-self-host` 已聚合多上游,STT 也可考虑接自建网关或 OpenAI Whisper 等替代。
4. **无 TypeScript**:本仓库强制 `.ts`,移植要补类型。
5. **无流式转写**:整段录完才发,延迟高。ElevenLabs Scribe 目前也不支持流式,换 provider 才能解决。
6. **glossary 写死本生态项目名**:pi-vox 内置 `pi-overwatch` 等,移植时应清空或参数化。

---

## 7. 移植到本仓库的可行性评估

### 7.1 API surface 确认(移植前必须做)

pi-vox 依赖的 pi API,需在本仓库当前版本的 `@earendil-works/pi-coding-agent` 里逐一验证(参考 `packages/goal/STEPS.md` Phase 0 的做法):

| API | 用途 | 风险 |
| --- | --- | --- |
| `CustomEditor`(named export) | 继承重写 `handleInput` | **高**:这是相对内部的 API,需确认导出路径与稳定性 |
| `ctx.ui.setEditorComponent` / `getEditorComponent` | 替换/包装输入框 | 中,ask-user-question 已用过类似机制 |
| `ctx.ui.setEditorText` / `getEditorText` | 读写输入框文本 | 中 |
| `ctx.ui.setStatus` / `setWidget` | 状态栏与浮层 | 低,goal/btw 都在用 |
| `pi.on('session_start')` | 装入 editor | 低,广泛使用 |
| `pi.registerCommand` | 命令 | 低 |
| `ctx.pi.sendUserMessage` | autoSubmit | 中,goal 的 continuation 用过 |

### 7.2 推荐架构(若要在本仓库实现)

```
packages/voice-input/
├── package.json          ← peerDep: @earendil-works/pi-coding-agent
├── tsconfig.json         ← project reference
├── index.ts              ← 扩展入口(session_start + 4 个命令)
├── audio.ts              ← LocalAudioCapture,跨平台 recorder 选择
├── providers/
│   ├── index.ts          ← createProvider 工厂
│   ├── elevenlabs.ts     ← ElevenLabs Scribe
│   └── openai.ts         ← (可选)Whisper,接 inference-self-host 网关
├── flow.ts               ← VoiceInputFlow(去掉模块级全局,挂 ctx)
├── state-machine.ts      ← 纯函数状态机(几乎照搬)
├── key-handler.ts        ← VoiceKeyHandler
├── config.ts             ← 配置 + redactSecrets(考虑抽到 common)
├── transcript-cleanup.ts ← 术语校正(清空默认 glossary)
└── __tests__/
```

### 7.3 必须改造的点

1. **`.js` → `.ts`**:补全类型,`CustomEditor` 子类化需参考 `packages/ask-user-question` 的做法。
2. **跨平台录音**:Linux 用 `parec` / `ffmpeg -f pulse`,macOS 保留 `avfoundation`,Windows 用 `dshow`。`selectRecorder` 要扩成平台感知。
3. **去模块级全局**:`commandFlow` 挂到 session 级存储(参考 goal 的 `store.ts` 按 threadId 存)。
4. **redactSecrets 抽 common**:≥2 个包可能用(secrets 相关),按 AGENTS.md「Promote to common」原则提升。
5. **格式化 + 无注释**:去掉 pi-vox 里少数 inline 注释,符合本仓库约定。
6. **provider 扩展**:至少留 OpenAI Whisper 接口,接 `inference-self-host` 既能复用 key 又能降本。

---

## 8. 给本仓库的可执行结论

| 结论 | 说明 |
| --- | --- |
| **集成机制清晰** | pi-vox 用「CustomEditor 包装 + registerCommand + ctx.ui 注入」三件套实现语音输入,机制可复制 |
| **状态机与 flow 设计干净** | 纯函数状态机 + 依赖注入的 flow,几乎可直接移植到 TypeScript |
| **hold-to-talk 默认关闭是正确判断** | 终端按键事件不可靠,命令式 toggle 更稳。移植时保留这个默认 |
| **平台与 provider 是主要改造工作** | macOS-only 的 ffmpeg + 单一 ElevenLabs,在本仓库多平台/多 provider 环境下都要重写 |
| **密钥脱敏值得沉淀到 common** | `redactSecrets` 模式可复用,不止 voice 场景 |
| **优先级**:中 | 语音输入非本仓库核心路径,但移植成本低、收益明确,适合作为一个独立 package |

---

## 附:源码文件速查

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `extensions/pi-vox.js` | ~230 | 入口:session_start 装 editor + 4 个命令 |
| `src/audio.js` | ~85 | LocalAudioCapture(spawn rec/sox/ffmpeg) |
| `src/config.js` | ~75 | 配置默认值、.env 解析、redactSecrets |
| `src/flow.js` | ~70 | VoiceInputFlow(录音→转写→插入编排) |
| `src/key-handler.js` | ~45 | 键盘事件→状态机事件 |
| `src/state-machine.js` | ~50 | 纯函数状态机 |
| `src/providers.js` | ~60 | ElevenLabs HTTP 客户端 |
| `src/transcript-cleanup.js` | ~65 | 术语校正(py vox → pi-vox) |
