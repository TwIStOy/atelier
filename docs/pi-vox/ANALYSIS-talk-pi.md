# talk-pi 源码分析与语音集成方案

本文审计 [RaphaCastelloes/talk-pi](https://github.com/RaphaCastelloes/talk-pi)(npm `talk-pi` v1.0.16),完整阅读 `talk-pi.ts` 入口 + `src/` 全部 30 个模块 + 50+ 测试 + 16 份 spec(spec-kit 驱动)+ AGENTS.md/README/package.json 后整理而成。与前两篇 [pi-vox/ANALYSIS.md](./ANALYSIS.md)、[ANALYSIS-pi-mimo-voice.md](./ANALYSIS-pi-mimo-voice.md) 对照阅读——三者代表「语音 + pi」的**三种哲学**:听写(pi-vox)、云对话(pi-mimo-voice)、**本地全离线**(talk-pi)。

---

## 1. talk-pi 是什么

一句话:**完全本地运行的 push-to-talk 语音扩展**——用 `decibri`(npm 包)录 PCM,`whisper-cpp-node`(本地)转写,`Piper`(本地)TTS。**零云依赖、零 API key**,首次运行自动下载模型。

| 维度 | 选择 |
| --- | --- |
| STT 引擎 | **`whisper-cpp-node`(本地,ggml 模型)**,无云 fallback |
| TTS 引擎 | **Piper(本地,ONNX 神经声学模型)**,spawn 二进制 |
| 录音方式 | **`decibri` npm 包**(跨平台 Node 原生录音,返回 Readable stream),非 spawn ffmpeg |
| 播放方式 | `play-sound` npm 包 + Windows 特殊路径(PowerShell `System.Media.SoundPlayer`) |
| API key | **无**(全本地) |
| 触发方式 | **F9(直接发送)/ F10(插入编辑器)** 两个快捷键,CustomEditor 拦截 |
| 文本落点 | F9 → `pi.sendUserMessage`(对话);F10 → `setEditorText` append(听写) |
| 配置 | 环境变量 + `~/.pi/tts/piper-preferences.json` 持久化(voice model / mute) |
| 工具分发 | **首次运行自动下载** Piper 二进制 + Whisper/Piper 模型(`tools-bootstrap.ts`) |
| 进程模型 | 扩展内 spawn + npm 包,临时 wav 用完即删 |
| 开发方法论 | **spec-kit 驱动**,16 份 spec + 契约测试,50+ 单元/集成测试 |

**核心定位差异**:talk-pi 把语音能力做成**完全离线、隐私优先**的方案——录音、识别、合成都不过网络,适合敏感场景和离线环境。代价是首次下载模型较大(Whisper base ~150MB + Piper 模型若干)。

---

## 2. 仓库结构(spec-kit 驱动)

talk-pi 是三个项目里**工程化程度最高**的。用 [spec-kit / speckit](https://github.com/speckit) 方法论,每个功能一个 spec 目录:

```
talk-pi/
├── talk-pi.ts                    ← 扩展入口(~250 行)
├── src/
│   ├── config.ts                 ← 环境变量 → 配置对象
│   ├── tools.ts                  ← 工具路径解析(user-scoped vs local)
│   ├── tools-bootstrap.ts        ← 首次运行下载 Piper/Whisper
│   ├── voice-settings.ts         ← 启动时恢复 mute/voice 偏好
│   ├── input/                    ← 输入处理层
│   │   ├── editor-insert.ts      ← setEditorText append
│   │   ├── f5-shortcut.ts        ← 快捷键防抖(2s 窗口)
│   │   ├── keyboard_listener.ts  ← push-to-talk 按键判定
│   │   ├── shortcut-config.ts    ← F9/F10 配置
│   │   └── voice-shortcut-interrupt.ts ← 录音前先停播放
│   ├── recording/                ← 录音控制层(较早抽象,部分被 voice/ 取代)
│   │   ├── microphone_capture.ts ← VoiceBridge 接口(桥接 /voice 命令)
│   │   ├── recording_controller.ts ← 状态机 idle/recording/error
│   │   └── recording_session.ts
│   ├── state/recording_state.ts  ← 纯数据 RecordingPhase
│   ├── voice/                    ← 实际录音 + STT 实现
│   │   ├── voice-capture.ts      ← createVoiceCaptureSession(核心)
│   │   ├── offline-recorder.ts   ← decibri → PCM → WAV 封装
│   │   ├── offline-whisper.ts    ← whisper-cpp-node + 模型下载
│   │   └── decibri-capture.ts    ← decibri 包适配层
│   ├── tts/                      ← TTS 播放层
│   │   ├── playback-queue.ts     ← 串行播放队列 + mute/stop 语义
│   │   ├── speech-job.ts         ← 单条 TTS 任务状态机
│   │   ├── piper-client.ts       ← spawn Piper 合成 WAV
│   │   ├── piper-config.ts       ← 配置解析
│   │   ├── piper-preferences.ts  ← 发现 ONNX 模型 + 持久化偏好
│   │   ├── wav-player.ts         ← play-sound + Windows PowerShell
│   │   ├── temp-wav.ts           ← 临时 WAV 文件管理
│   │   ├── spoken-text.ts        ← Markdown → 纯文本(给 TTS)
│   │   └── assistant-reply.ts    ← 从 message 提取 assistant 文本
│   └── ui/                       ← UI 层
│       ├── unified-talk-menu.ts  ← /talk-pi 菜单(while 循环)
│       ├── menu-actions.ts       ← 菜单选项解析
│       ├── mute-state.ts         ← mute 闭包状态
│       ├── footer-status.ts      ← 状态栏 emoji 渲染
│       ├── recording_status.ts / transcription-status.ts / spoken-reply-status.ts
├── specs/                        ← 16 份 spec-kit 规范
│   └── 001-push-to-talk-voice/ ... 015-extension-path-migration/
│     ├── spec.md / research.md / plan.md / tasks.md
│     ├── data-model.md / contracts/*.md
│     └── checklists/requirements.md
└── tests/                        ← 50+ 单元 + 集成测试
    ├── unit/                     ← 每个模块对应测试
    └── integration/              ← 跨模块流程(esc-stop、f5-flow、mute 等)
```

**spec-kit 方法论体现**:每个 spec 有标准 8 文件:`research.md`(决策 + 理由 + 备选)→ `spec.md`(需求)→ `plan.md`/`tasks.md`(实现计划)→ `data-model.md`(数据结构)→ `contracts/*.md`(模块间契约)→ `checklists/requirements.md`(验收清单)。例如 `001-push-to-talk-voice/research.md` 明确记录「为什么用 press-and-hold 而非 toggle」「为什么只支持 left control」等设计决策。

> 这是三个项目里唯一有**完整设计文档 + 契约 + 验收清单**的。AGENTS.md 用 `<!-- SPECKIT START -->` 标记引导 agent 读 `015-extension-path-migration/plan.md` 获取上下文。

---

## 3. 集成进 pi 的四条腿

talk-pi 与 pi-mimo-voice 一样用四条腿,但**录音方式截然不同**。

### 3.1 腿一:`CustomEditor` 子类 + F9/F10 快捷键(核心)

```ts
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { isKeyRelease, matchesKey } from "@mariozechner/pi-tui";

// session_start 里
ctx.ui.setEditorComponent?.((tui, theme, keybindings) => {
  class PushToTalkEditor extends CustomEditor {
    private recording = false;
    private recordingShortcut: "send" | "insert" | undefined;

    handleInput(data: string): void {
      if (isKeyRelease(data) || data.includes(":2")) return;        // 忽略 release 和鼠标
      if (matchesKey(data, "escape") && playbackQueue.isPlaying()) { // Esc 停播放
        void playbackQueue.stop()...; return;
      }
      const isInsert = matchesKey(data, shortcutConfig.insertTranscriptKey) // F10
                    && insertTranscriptDebounce.allow();
      const isSend = matchesKey(data, shortcutConfig.sendTranscriptKey)     // F9
                  && sendTranscriptDebounce.allow();
      if (isInsert) { void runVoiceShortcut("insert", ...); return; }
      if (isSend)   { void runVoiceShortcut("send",   ...); return; }
      super.handleInput(data);                                       // 其它透传
    }
    // toggleVoiceCapture(shortcut):第一次按开始录,第二次按停 + 转写 + 落点
  }
  return new PushToTalkEditor();
});
```

**关键设计**(对比 pi-vox/pi-mimo-voice):

1. **双快捷键 + 防抖**:F9 直接发送(`sendUserMessage`)、F10 插入编辑器(`setEditorText` append)。每个快捷键独立 `createShortcutDebounce(2000ms)`,防止连按。
2. **toggle 而非 hold**:按一次开始录、再按一次停(非 pi-vox 的 hold-to-talk)。`recordingShortcut` 字段记住是哪个键触发的,决定停后文本落点。
3. **录音前先停播放**:`runVoiceShortcut` 先 `isPlaybackPlaying()` → `stopPlayback()`,避免「边播边录」。
4. **Esc 双语义**:Esc 停 TTS 播放(若在播放),否则透传(见集成测试 `esc-stop-playback` / `esc-idle-noop`)。

> ⚠️ **注意 import**:`@mariozechner/pi-coding-agent` 和 `@mariozechner/pi-tui`——这是 pi 的**旧包名**(作者 Mario Zechner)。现在 pi 已迁移到 `@earendil-works/pi-coding-agent`。本仓库移植时必须换成新包名,API 可能也有差异(`matchesKey`/`isKeyRelease` 来自 pi-tui)。

### 3.2 腿二:`message_end` → TTS 播放队列

```ts
pi.on("message_end", async (event) => {
  const text = extractAssistantReplyText(event?.message);
  if (text) void playbackQueue.enqueue(text);
});
```

`extractAssistantReplyText` 处理 content 是 string 或 content blocks 数组两种情况。然后丢进 `playbackQueue`。

**`playbackQueue` 是这个项目最精巧的部分**(详见 §4),实现:**串行播放、mute 时停止并 unshift 回队列、recording 时阻塞、stop 时清空**。

### 3.3 腿三:`/talk-pi` 命令 → 统一菜单

```ts
pi.registerCommand("talk-pi", {
  handler: async (_args, ctx) => {
    await openUnifiedTalkMenu(ctx, {
      isMuted: () => muteState.isMuted(),
      setMuted: (m) => setMuteState(m, ctx),
      getStatusText: () => getMenuStatusText(),
      chooseVoiceLanguage: async () => { /* 选 English/Portuguese */ },
    });
  },
});
```

`openUnifiedTalkMenu` 是 **while 循环菜单**——执行完一个动作后重新弹出,直到选 Close。选项:`Status` / `Voice Language` / `Mute/Unmute` / `Close`。`chooseVoiceLanguage` 会扫描 `piper/models/*.onnx`,让用户在 English(Ryan/Lessac)和 Portuguese(Faber)模型间切换,持久化到 `piper-preferences.json`。

### 3.4 腿四:`ctx.ui.setStatus` → footer 状态栏

```ts
ctx.ui.setStatus("talk-pi", getFooterStatusText());
```

`footer-status.ts` 把 voice 状态 + speech 状态 + mute 综合成一个 emoji 标签:`✔ Ready` / `🎤 Listen` / `⏳ Transcribing` / `🤔 Thinking` / `🗣️ Talking` / `🔇 Muted` / `⚠️ Error` / `👂 No speech`。这是三个项目里**唯一的状态栏可视化**。

---

## 4. 核心子系统详解

### 4.1 录音:`decibri` + WAV 手工封装(最大差异点)

talk-pi **不用 spawn ffmpeg/sox**,而是用 npm 包 [`decibri`](https://www.npmjs.com/package/decibri)(v3.4.2)——一个跨平台 Node 原生录音库,返回 `Readable` stream:

```ts
// decibri-capture.ts
const mic = new createDecibri({ sampleRate: 16000, channels: 1, format: "int16", vad: false });
return { stream: () => mic, stop: async () => { await mic.stop(); } };

// offline-recorder.ts
const source = recording.stream();
const pcmChunks: Buffer[] = [];
source.on("data", (chunk) => pcmChunks.push(Buffer.from(chunk)));
source.resume();
return {
  filePath,
  async stop() {
    source.destroy();
    await recording.stop();
    await writeWavFile(filePath, pcmChunks);  // 手工拼 44 字节 WAV header + PCM
  },
};
```

`wavHeader()` 手工构造 RIFF/WAVE/fmt /data 块(16kHz mono s16le)。`cleanupCapture` 有 **5 次重试 + 退避**(50ms × attempt),处理 Windows 上文件被占用的删除问题。

**优势**:跨平台无需装系统工具、Node 进程内控制(可 destroy stream 立即停)、无 spawn 开销。
**代价**:多一个 native 依赖(decibri),安装时可能要编译;`speech-job`/`temp-wav` 一整套临时文件管理增加复杂度。

### 4.2 STT:`whisper-cpp-node` + 模型自动下载

```ts
// offline-whisper.ts
let cachedContext;  // 进程级缓存 whisper context(避免反复加载模型)

async function transcribeAudioFile(filePath, options) {
  const modelPath = await ensureWhisperModel(options);  // 不存在则下载
  if (!cachedContext || cachedModelPath !== modelPath) {
    cachedContext?.free?.();
    cachedContext = await createContextWithRetry(modelPath, options);  // 失败会删模型重下
  }
  const result = await transcribeAsync(cachedContext, {
    fname_inp: filePath,
    language: options.language?.toLowerCase() || "pt",  // 默认葡萄牙语!
    no_timestamps: false,
  });
  return { text, language, segments };
}
```

亮点:

- **context 缓存**:`cachedContext` 进程级复用,避免每次转写都重新 `createWhisperContext`(加载模型很慢)。换模型时 `free()` 旧的。
- **createContextWithRetry**:context 创建失败 → 删模型 → 重新 `ensureWhisperModel` 下载 → 再试一次(retry=false 防无限循环)。
- **ensureWhisperModel**:模型文件不存在或 size=0 时从 HuggingFace 下载,支持 3xx 重定向。
- **超时分层**:`voice-capture.ts` 里首次转写给 600s(`FIRST_TRANSCRIBE_TIMEOUT_MS`,因为首次还要下模型),后续 60s。用 `Promise.race` + `withTimeout` 实现。

### 4.3 TTS:Piper + 播放队列(最复杂)

**Piper 客户端**(`piper-client.ts`):spawn Piper 二进制,通过 stdin 喂文本,输出 WAV 到临时文件:

```ts
const child = spawn(binaryPath, ["--model", modelPath, "--output_file", tempFile.path], {...});
child.stdin.end(`${replyText}\n`);  // 文本通过 stdin
```

`resolvePiperBinaryPath` 多级查找:explicit path → extension folder(`piper/piper` 或 `piper/bin/piper`)→ 绝对路径 → `which`/`where` PATH 查找。容错性强。

**播放队列**(`playback-queue.ts`)是整个项目设计最精细的地方,状态变量多达 6 个(`busy`/`recordingBlocked`/`muted`/`muteStopping`/`stopping`/`activePlayback`),核心语义:

- **串行**:同一时间只播一条,`busy` 锁。`process()` 是 while 循环消费 queue。
- **mute 优雅停止**:`setMuted(true)` 时若正在播,设 `muteStopping=true` → `player.stop()` → 当前 job 标记 `interrupted`,**未播的留在队列里**(unmute 后继续)。
- **recording 阻塞**:`setRecordingBlocked(true)`(录音时)暂停消费,正在合成的标记 `interrupted` 并 `queue.unshift(item)`(放回队头)。
- **stop 清空**:`stop()` 设 `stopping=true` + `queue.length=0`,彻底清空(区别于 mute 的保留)。
- **每个 job 有完整状态机**:`queued → synthesizing → ready → playing → complete/failed/interrupted`,见 `speech-job.ts`。
- **临时文件确定性清理**:无论成功失败,`finally` 里 `fs.unlink(audioPath)`,配合 `temp-wav.ts` 的 `cleanup()`。

> 对比 pi-mimo-voice:talk-pi 的播放队列是**真正的队列**(串行、可中断、可恢复、可阻塞),pi-mimo-voice 只是「播一条算一条」,无队列概念。这是 talk-pi spec-kit 驱动下 `006-mute-extension`、`005-esc-stop-playback`、`008-temp-wav-cleanup` 等 spec 逐步打磨出来的。

**`spoken-text.ts`** 把 Markdown 清洗成纯文本再喂 Piper:去 code fence、去 inline code、图片/链接留 alt、去标题/列表/引用前缀、去 emphasis 标记、换行变空格。避免 Piper 念出 ` ``` ` 或 `**bold**`。

### 4.4 工具自动下载(`tools-bootstrap.ts`)— 开箱即用关键

首次 `session_start` 触发 `ensurePiperTool`:

- 检查 `piper/piper(.exe)` + `piper/models/pt_BR-faber-medium.onnx(.json)` 是否存在
- **Windows 专属**:缺失时自动下载 Piper zip → PowerShell `Expand-Archive` 解压 → 扁平化单层子目录 → `cp` 到目标
- 模型缺失:从 HuggingFace 下载 `pt_BR-faber-medium`(葡萄牙语默认)、`en_US-ryan-medium`、`en_US-lessac-medium`(两个英语模型)
- 每步 `notify("Talk-pi: Downloading 📥 xxx", "info")` 反馈进度
- **非 Windows**:不自动下载 Piper 二进制(只下模型),报错让用户手动放

`ensureWhisperToolModel` 同理下载 `ggml-base.bin`。

### 4.5 配置持久化(`piper-preferences.ts`)

`~/.pi/tts/piper-preferences.json`:

```json
{
  "selectedModelId": "piper/models/en_US-ryan-medium",
  "selectedOutputKind": "english",
  "muted": false,
  "updatedAt": "2026-06-15T..."
}
```

- `discoverPiperModels` 递归扫 `piper/**/*.onnx`,`detectLanguage` 按文件名前缀(`en_*`)判英语/其他
- `friendlyModelLabel` 把 `en_US-lessac-medium` 映射成 `Lessac`
- `resolvePiperVoiceSelection` 综合「发现的模型 + 用户偏好 + config 默认」得出实际 active model + whisper language(pt/en 联动)
- startup 时 `loadVoiceSettingsStartupState` 恢复 mute 和 voice 选择——**补了 pi-mimo-voice「配置不持久化」的坑**

### 4.6 工具路径策略(`tools.ts`)— spec 015 的产物

```ts
export function resolveToolsRoot(options): string {
  if (fs.existsSync(piRoot)) {                    // ~/.pi 存在 → 用户级
    return resolveUserToolsRoot(env);              // ~/.pi/agent/extensions/talk-pi
  }
  const explicit = env.TALK_PI_TOOLS_DIR;          // 显式覆盖
  if (explicit) return explicit;
  return resolveLocalToolsRoot(cwd);               // 兜底 ./tools(本地)
}
```

优先 `~/.pi/agent/extensions/talk-pi`(用户级,多项目共享),没有则 `./tools`(项目本地)。这是 spec `015-extension-path-migration` 演进的结果,AGENTS.md 明确指向它。

---

## 5. 三项目横向对比(核心章节)

| 维度 | pi-vox | pi-mimo-voice | **talk-pi** |
| --- | --- | --- | --- |
| **哲学** | 听写(dictation) | 对话助手(voice assistant) | **本地全离线** |
| **STT** | ElevenLabs(云) | whisper.cpp 本地优先 + MiMo 云 fallback | **whisper.cpp 本地(仅)** |
| **TTS** | 无 | MiMo V2.5(云) | **Piper(本地)** |
| **录音** | spawn rec/sox/ffmpeg | spawn parecord/ffmpeg | **decibri npm 包(Node stream)** |
| **播放** | 无 | afplay/paplay/ffplay/mpv | **play-sound + Windows PowerShell** |
| **云依赖** | ElevenLabs key | MiMo key(或本地 whisper) | **零**(仅首次下模型) |
| **隐私** | 录音上云 | 可本地 STT,TTS 上云 | **完全离线** |
| **触发** | /voice-toggle 或 hold-space | /listen /live + LLM tool | **F9 发送 / F10 插入** |
| **文本落点** | setEditorText | sendUserMessage | **双模式(F9 发 / F10 插)** |
| **agent tool** | 无 | mimo_tts / mimo_stt | 无 |
| **播放队列** | 无 | 无(单条) | **有(串行/mute/stop/block)** |
| **配置持久化** | config.json | 无(内存) | **piper-preferences.json** |
| **状态可视化** | setStatus + setWidget | notify | **footer emoji 状态机** |
| **mute** | 无 | auto-speak toggle | **mute-state + 队列保留** |
| **跨平台** | macOS 为主 | Linux 为主,声明跨平台 | **Windows 为主(spec 迹象),声明全平台** |
| **语言倾向** | 英文 | 中英 | **葡英**(默认 pt_BR!) |
| **工具分发** | 要用户装 sox/ffmpeg | 要用户装 ffmpeg | **首次自动下载** |
| **包依赖** | 0 | 0(typebox/pi-tui 由 pi 提供) | **3 个(decibri/play-sound/whisper-cpp-node)** |
| **pi 包名** | 新(@earendil-works) | 新(@earendil-works) | **旧(@mariozechner)** |
| **测试** | 9 单测 | 0 | **50+ 单测 + 集成** |
| **文档方法** | README | README 中英 | **spec-kit 16 份 spec + 契约** |
| **代码组织** | 8 文件分离 | 单文件 600 行 | **30 模块分层 + 4 子目录** |
| **类型** | JS 无 | TS | **TS** |

### 5.1 talk-pi 的独特优势

1. **全离线**:唯一不依赖任何云 API 的方案,隐私和离线场景首选。
2. **工程最严谨**:spec-kit 驱动 + 契约文档 + 50+ 测试,代码分层清晰(input/recording/voice/tts/ui/state),每个模块单一职责。
3. **播放队列设计精巧**:串行 + mute 保留 + recording 阻塞 + stop 清空,是三个项目里唯一处理「TTS 与录音/用户操作并发」的。
4. **开箱即用**:首次自动下载 Piper + 模型,用户无需手动配置二进制路径(Windows)。
5. **双快捷键模式**:F9 发送 / F10 插入,同时满足「对话」和「听写」两种场景——融合了 pi-vox 和 pi-mimo-voice 的落点设计。
6. **状态可视化最完整**:footer emoji 状态机覆盖 8 种状态,用户始终知道当前在干嘛。
7. **Markdown 清洗给 TTS**:`spoken-text.ts` 去掉代码块/标记,避免 Piper 念出符号。

### 5.2 talk-pi 的短板

1. **依赖旧 pi 包名**:`@mariozechner/pi-coding-agent` / `@mariozechner/pi-tui`,新 pi 版本可能已不兼容。移植首要工作。
2. **3 个运行时依赖**:`decibri`(native,可能编译失败)、`play-sound`、`whisper-cpp-node`(native binding)。本仓库 AGENTS.md 倾向「用现有 npm 包」,但 native 包在 NixOS 上需特殊处理。
3. **默认葡语**:Whisper 默认 `language: "pt"`、Piper 默认 `pt_BR-faber`,反映作者背景(巴西),非国际化默认。中文/其他语言需手动切。
4. **Windows 自动下载不对称**:Windows 会自动下 Piper zip,非 Windows 不会(只下模型),Linux/macOS 用户要手动放二进制。
5. **无 agent tool**:不像 pi-mimo-voice 把语音暴露给 LLM,纯用户触发。
6. **spec-kit 膨胀**:16 份 spec 占大量篇幅,对只想读代码的人是噪音(但对设计回顾极有价值)。
7. **recording/ 与 voice/ 双抽象**:`recording_controller.ts`(VoiceBridge 桥接 `/voice` 命令)和 `voice/voice-capture.ts`(实际 decibri 实现)并存,前者似乎是早期设计残留(`microphone_capture.ts` 的 `VoiceCommandBridge` 发送 `/voice` 字符串,与实际 push-to-talk 流程不搭),有死代码嫌疑。

---

## 6. 关键模式速查(可借鉴)

| 模式 | 文件 | 价值 |
| --- | --- | --- |
| **spec-kit 契约驱动** | `specs/*/contracts/*.md` | 复杂功能先定契约再实现,本仓库复杂包(subagents/ask-user-question)可借鉴 |
| **WAV header 手工封装** | `offline-recorder.ts wavHeader()` | 不依赖 ffmpeg 也能产出 WAV,纯 Node 录音方案 |
| **whisper context 进程级缓存** | `offline-whisper.ts cachedContext` | 避免反复加载模型,首次慢后续快 |
| **模型创建失败重下** | `createContextWithRetry` | native 模型损坏的自愈策略 |
| **首次转写超时分层** | `voice-capture.ts` 600s/60s | 区分「首次下模型」和「正常转写」的超时 |
| **播放队列 4 状态语义** | `playback-queue.ts` | busy/mute/recording/stop 的正交控制,任何异步播放场景通用 |
| **mute unshift 回队** | `playback-queue.ts setMuted` | mute 不丢消息,unmute 继续 |
| **Markdown → 纯文本** | `spoken-text.ts` | 任何「把 LLM 输出喂给 TTS/语音」的场景 |
| **双快捷键 + 独立防抖** | `f5-shortcut.ts` | 防连按,每个快捷键独立窗口 |
| **footer emoji 状态机** | `footer-status.ts resolveFooterStatus` | 多信号综合成单一可视状态 |
| **while 循环菜单** | `unified-talk-menu.ts` | 执行动作后不退出,持续操作到 Close |
| **工具路径三级回退** | `tools.ts resolveToolsRoot` | user-scoped → env override → local |
| **临时文件 5 次重试删除** | `offline-recorder.ts cleanupCapture` | Windows 文件占用问题 |
| **模型发现 + 友好名** | `piper-preferences.ts discoverPiperModels` | 扫描目录 + 文件名→label 映射 |
| **配置 JSON 带 updatedAt** | `piper-preferences.ts` | 持久化带时间戳,便于调试 |

---

## 7. 对本仓库(`hawtian-pi-extensions`)的可借鉴点

### 7.1 直接可复用的模式

| 模式 | 用途 |
| --- | --- |
| **播放队列状态机** | 本仓库若有任何异步播放/通知场景(btw 消息、todo 提醒),这套 busy/mute/stop/block 语义直接可用 |
| **footer 状态综合** | `statusline` 包可借鉴:把多个子系统状态综合成单一 emoji 行 |
| **spec-kit 契约文档** | 复杂包(ask-user-question 正在移植)的 `docs/` 已有 DESIGN/STEPS,talk-pi 的 `contracts/` + `data-model.md` 是更细的粒度 |
| **whisper context 缓存 + 重下** | 若本仓库做本地 STT,这套自愈策略必须照搬 |
| **WAV 手工封装** | NixOS 上 ffmpeg 可用但 decibri 这种 native 包需 nix 适配;若要避免 native 依赖,可退回 spawn + 手工 WAV header |
| **工具路径三级回退** | 本仓库各包散落的工具路径逻辑可统一到 `common` |

### 7.2 移植 talk-pi 到本仓库的障碍清单

若想把 talk-pi 能力引入 `packages/voice-input`(与 [pi-vox/ANALYSIS.md §7](./ANALYSIS.md) 融合方案合并):

| 障碍 | 严重度 | 应对 |
| --- | --- | --- |
| **旧包名 `@mariozechner/*`** | 高 | 全部换成 `@earendil-works/*`,验证 `CustomEditor`/`matchesKey`/`isKeyRelease` API 是否在新包存在且签名一致 |
| **decibri native 依赖** | 高(NixOS) | Nix 要 `nativeBuildInputs` 加编译工具链;或用 `inference-self-host` 的云端 STT 替代本地 whisper |
| **whisper-cpp-node native** | 高(NixOS) | 同上;或用 spawn 独立 whisper-cpp 二进制(talk-pi 早期版本的方式) |
| **默认葡语** | 中 | 默认改成 `en` 或 auto,talk-pi 的 piper-preferences 已支持多模型发现 |
| **Windows-only 自动下载** | 中 | 补 Linux/macOS 的 Piper 下载(tar.gz 解压),或文档化手动步骤 |
| **spec-kit 文档迁移** | 低 | 精简成几份 DESIGN.md,不必带全部 16 spec |
| **格式化 + 无注释** | 低 | 去掉 talk-pi 的 inline 注释,符合本仓库约定 |
| **recording/ 死代码** | 低 | 移植时只取 voice/ 实现,丢弃 VoiceCommandBridge |

### 7.3 三项目融合的最终建议

综合三篇分析,`packages/voice-input` 的理想架构应是**三者取长补短**:

```
packages/voice-input/
├── config.ts            ← pi-vox 的 redactSecrets + talk-pi 的三级路径 + 持久化(piper-preferences 风格)
├── state-machine.ts     ← pi-vox 的纯函数状态机(talk-pi 的 RecordingController 偏简单)
├── audio/
│   ├── capture.ts       ← 抽象接口:decibri(talk-pi)/ spawn ffmpeg(pi-mimo-voice 跨平台矩阵)/ sox(pi-vox)三实现
│   └── playback.ts      ← talk-pi 的 WavPlayer + pi-mimo-voice 的平台播放矩阵
├── providers/
│   ├── stt/             ← whisper-cpp-node 本地(talk-pi,带 context 缓存)+ 云端(ElevenLabs/OpenAI/MiMo,可接 inference-self-host)
│   └── tts/             ← Piper 本地(talk-pi)+ 云端(MiMo/pi-mimo-voice)
├── playback-queue.ts    ← 照搬 talk-pi 的队列状态机(三者最强)
├── flow.ts              ← 落点可配:dictation(setEditorText)/ conversation(sendUserMessage),talk-pi 双键思路
├── tools.ts             ← pi-mimo-voice 的 registerTool(给 agent 语音能力,talk-pi 缺这个)
├── footer.ts            ← talk-pi 的 emoji 状态机
├── menu.ts              ← talk-pi 的 while 循环菜单 + pi-mimo-voice 的 /voice-config 交互
└── index.ts
```

**关键决策矩阵**:

| 决策点 | 推荐 | 来源 | 理由 |
| --- | --- | --- | --- |
| 录音抽象 | 三实现可切 | talk-pi decibri + pi-mimo-voice ffmpeg 矩阵 | 跨平台 + NixOS native 适配 |
| STT 引擎 | 本地优先 + 云 fallback | pi-mimo-voice + talk-pi | 隐私 + 离线 + 失败兜底 |
| TTS 引擎 | 本地 Piper + 云 MiMo 并存 | talk-pi + pi-mimo-voice | 离线默认,高质量可选 |
| 播放队列 | 完整状态机 | talk-pi | 唯一处理并发的 |
| 文本落点 | 双模式可配 | talk-pi F9/F10 | 同时满足听写和对话 |
| agent tool | 有 | pi-mimo-voice | 开启「语音 agent」可能 |
| 状态可视化 | footer emoji | talk-pi | UX 最佳 |
| 配置持久化 | JSON + 启动恢复 | talk-pi piper-preferences | 补 pi-mimo-voice 的坑 |
| 密钥脱敏 | 全覆盖 | pi-vox redactSecrets | 安全底线 |
| 工程方法 | spec-kit 契约 | talk-pi | 复杂度配得上 |

---

## 8. 结论

| 结论 | 说明 |
| --- | --- |
| **三种正交哲学** | pi-vox=听写(云 STT),pi-mimo-voice=对话(云 STT+TTS),talk-pi=**本地全离线**(本地 STT+TTS)。三者互补 |
| **talk-pi 工程最扎实** | spec-kit 驱动 + 30 模块分层 + 50+ 测试 + 契约文档,代码质量三者最高 |
| **talk-pi 隐私最强** | 零云依赖,适合敏感场景;代价是 native 依赖和首次下模型 |
| **talk-pi 播放队列最成熟** | 唯一处理 TTS 与录音/用户操作并发的,可独立复用 |
| **主要移植障碍是旧包名 + native 依赖** | `@mariozechner/*` → `@earendil-works/*`,decibri/whisper-cpp-node 在 NixOS 需适配 |
| **融合方案** | 取 talk-pi 的工程骨架 + 播放队列 + footer 状态,pi-mimo-voice 的 agent tool + 跨平台矩阵,pi-vox 的状态机 + 密钥脱敏 |
| **优先级**:中 | talk-pi 最完整但移植成本最高(native + 旧包名);若本仓库只做一个语音包,推荐以 talk-pi 架构为骨架融合另两者 |

---

## 附:源码规模速查

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `talk-pi.ts` | ~250 | 扩展入口:CustomEditor + 事件 + /talk-pi 命令 |
| `src/voice/voice-capture.ts` | ~130 | 录音会话编排(开始/停/转写/超时) |
| `src/voice/offline-recorder.ts` | ~110 | decibri → PCM → WAV 手工封装 |
| `src/voice/offline-whisper.ts` | ~130 | whisper-cpp-node + context 缓存 + 模型下载 |
| `src/tts/playback-queue.ts` | ~180 | **串行播放队列 + mute/stop/block 状态机** |
| `src/tts/piper-client.ts` | ~130 | spawn Piper 合成 WAV |
| `src/tts/piper-preferences.ts` | ~200 | 模型发现 + 偏好持久化 |
| `src/tts/wav-player.ts` | ~120 | play-sound + Windows PowerShell |
| `src/tts/spoken-text.ts` | ~20 | Markdown → 纯文本 |
| `src/tools-bootstrap.ts` | ~180 | 首次下载 Piper/Whisper |
| `src/tools.ts` | ~80 | 工具路径三级回退 |
| `src/ui/footer-status.ts` | ~100 | footer emoji 状态机 |
| `src/ui/unified-talk-menu.ts` | ~60 | while 循环菜单 |
| `tests/` | 50+ 文件 | 单元 + 集成测试 |
| `specs/` | 16 目录 | spec-kit 设计文档 |
