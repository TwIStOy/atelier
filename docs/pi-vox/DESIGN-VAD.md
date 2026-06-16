# voice-input VAD 分段设计

本文是 [DESIGN.md](./DESIGN.md) 的增量设计,在现有「一次性录音 → 单文件 → 单次 STT」模型之上,增加 **流式 VAD 分段**:边录边检测语音活动,按停顿自动切段,每段独立送 STT 并增量追加到输入框。

## 1. 决策记录(用户拍板 + 实测)

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| 触发阶段 | **流式分段(边录边转)** | 低延迟、自动断句、文字实时浮现 |
| VAD 引擎 | **Silero VAD via `onnxruntime-web`**(纯 WASM) | 准确率最高;纯 WASM 无 native 二进制,NixOS 友好 |
| 转写落点 | **增量追加** | 每段转完立即 append,实时感最好 |

### 1.1 引擎选择的关键事实(npm registry 实测 2026-06-16)

- `webrtcvad` 是 **native binding**(`node-gyp rebuild`),违背「无 native 依赖」,否决。
- npm 上**不存在**纯 JS/WASM 的 WebRTC VAD 包(webrtc-vad / webrtc-vad-wasm / webrtc-vad-purejs 等全部 404)。
- `@ricky0123/vad-web` / `vad-web` 名为 VAD,实际依赖 `onnxruntime-web`,本质是 **Silero ONNX 跑 WASM**,且封装是浏览器(AudioWorklet)取向,Node 里不能开箱即用 → 直接用底层 `onnxruntime-web` 推理。
- `onnxruntime-web` 1.26.0 提供 `dist/ort.node.min.js`(Node entry)+ 内嵌 wasm bundle,纯 WASM,NixOS 友好 ✓。

## 2. 架构:从「文件模型」到「PCM 帧流模型」

```
/voice-toggle (start)
  └─ StreamCapture.start()
       └─ spawn ffmpeg -f <backend> -i <device> -ar 16000 -ac 1 -f s16le -   ← PCM 到 stdout
            child.stdout ──(Buffer chunks)──► Framer
                                              │  累积缓冲,切 1024 字节帧 = 512 samples = 32ms
                                              ▼
                                         VAD(Silero)
                                              │  processFrame(samples) → prob ∈ [0,1]
                                              ▼
                                         Segmenter(状态机)
                                              ├─ 语音开始 → 收帧
                                              ├─ 静音 ≥ minSilenceMs → 闭段
                                              │     └─► PCM→WAV(内存) → 写临时文件
                                              │            └─► provider.transcribe(file)
                                              │                   └─► append 到输入框(增量)
                                              └─ (循环)
/voice-toggle (stop)
  └─ flush 尾段 → 关闭 pipeline → cleanup
```

**关键转变**:录音不再落一个 `recording.wav`,而是 spawn 一个把原始 PCM 输到 stdout 的进程,Node 侧按帧消费。这是整个改动的核心。

## 3. 包结构(增量)

```
packages/voice-input/
├── audio/
│   ├── recorder.ts           ← 改:新增 buildStreamRecorderArgs(PCM→stdout)
│   ├── capture.ts            ← 保留(非 VAD fallback 模式仍用文件模型)
│   ├── stream-capture.ts     ← 新:spawn + stdout pipe + 事件流
│   ├── framer.ts             ← 新:纯函数,PCM Buffer → 固定大小帧
│   ├── pcm-wav.ts            ← 新:纯函数,s16le PCM 样本 → WAV Uint8Array
│   └── vad/
│       ├── silero.ts         ← 新:onnxruntime-web 加载 silero_vad.onnx + 帧推理 + LSTM 状态
│       └── segmenter.ts      ← 新:纯状态机,(frame,prob,ts) → segment 事件
├── flow.ts                   ← 改:VoiceInputFlow 增加 VAD pipeline 路径
├── config.ts                 ← 改:新增 vad.* 配置项
├── types.ts                  ← 改:新增 VadConfig
├── models/
│   └── silero_vad.onnx       ← 新:随包分发模型(~2.2MB,来自 snakers4/silero-vad)
└── __tests__/                ← 新增 framer/segmenter/pcm-wav/silero/stream-capture 测试
```

## 4. 各模块

### 4.1 `audio/recorder.ts` — 流式参数

新增 `buildStreamRecorderArgs(recorder, device)`,产出**原始 s16le PCM 到 stdout**:

```
ffmpeg :  -f <backend> -i <device> -ar 16000 -ac 1 -f s16le -     (stdout)
sox     : -d -t raw -r 16000 -c 1 -b 16 -e signed-integer -       (stdout)
parecord: ✗ 不支持 stdout(只能写文件)→ VAD 模式 Linux 也走 ffmpeg -f pulse
```

**约束**:`parecord` 无法流式输出,VAD 模式下 Linux 统一用 `ffmpeg -f pulse -i default`。文件 fallback 模式仍可用 parecord。

### 4.2 `audio/stream-capture.ts` — 流式采集

```ts
class StreamCapture {
  start(): void                              // spawn recorder, stdio: ['ignore','pipe','ignore']
  on('frame', (samples: Float32Array) => {}) // 不直接发,留给 Framer 订阅
  get stdout(): Readable                     // 暴露给 Framer 管道
  async stop(): Promise<void>                // SIGINT + 等 exit + 校验 exit code
  async cancel(): Promise<void>             // SIGINT + 不等
  cleanup(): void
}
```

依赖注入 `spawn` 与现有 `capture.ts` 一致(测试用 fake child)。

### 4.3 `audio/framer.ts` — 纯函数分帧

```ts
const FRAME_SAMPLES = 512;       // Silero v4 标准帧
const FRAME_BYTES = 1024;        // s16le, 512 samples × 2 bytes
const SAMPLE_RATE = 16000;
const FRAME_MS = 32;             // 512 / 16000 * 1000

// 累积缓冲,每凑齐 FRAME_BYTES 发一帧;返回剩余未满字节
function pushChunk(buf: Uint8Array, state: FramerState): Float32Array[];
function s16leToFloat32(bytes: Uint8Array): Float32Array;   // Int16LE / 32768
```

纯函数,零依赖,完全可单测。

### 4.4 `audio/pcm-wav.ts` — PCM → WAV(内存)

```ts
// 把 Float32 样本或 Int16 样本包成 WAV Uint8Array(16-bit PCM mono 16kHz header + data)
function encodeWav(samples: Int16Array, sampleRate = 16000): Uint8Array;
```

44 字节 RIFF/fmt/data 头 + PCM 数据。**目的**:让每段语音变成一个临时 `.wav` 文件,复用现有 `SttProvider.transcribe(file)` 接口(零改动 provider 层)。

### 4.5 `audio/vad/silero.ts` — Silero 推理

```ts
class SileroVad {
  static async create(modelPath: string): Promise<SileroVad>;  // ort.InferenceSession.create
  processFrame(samples: Float32Array): number;                  // → prob ∈ [0,1], 维护 LSTM state
  reset(): void;                                                // 清状态(每段开始前)
}
```

- 模型:`models/silero_vad.onnx`(snakers4/silero-vad v4)。
- 输入:`input`(512 samples)、LSTM 隐藏状态 `h`/`c`(或 v5 的合并 `state`)、`sr`。
- 输出:`output`(概率),更新 `hn`/`cn`。
- 用 `onnxruntime-web` 的 `InferenceSession`(WASM backend)。
- **测试**:注入 fake session(返回固定 prob),只验状态机衔接,不跑真模型。

### 4.6 `audio/vad/segmenter.ts` — 切段状态机(纯)

```ts
interface SegmenterOpts {
  threshold: number;        // 语音概率门限,默认 0.5
  negThreshold: number;     // 迟滞下门限,默认 threshold - 0.15
  minSpeechMs: number;      // 最短语音段,默认 250
  minSilenceMs: number;     // 闭段所需静音,默认 500
  maxSpeechMs: number;      // 单段上限,默认 30000(防超长)
}

class VadSegmenter {
  push(frameTsMs: number, prob: number, onSegmentStart: () => void): void;
  feedSamples(samples: Float32Array): void;   // 当前段的样本累积
  close(): Int16Array | null;                 // flush 尾段
}
// 状态:SILENCE → (连续 ≥ minSpeech 命中) → SPEECH → (连续 ≥ minSilence 低于 negThreshold) → 闭段
```

逻辑对齐 Silero 官方 `silero-vad` Python utils 的 `default_options`。纯状态机,零依赖,完全可单测。

### 4.7 `flow.ts` — VAD pipeline

`VoiceInputFlow` 增加 VAD 模式分支(由 `config.vad.enabled` 决定):

```ts
async startRecording(): Promise<void> {
  if (this.config.vad.enabled) await this.startVadPipeline();
  else await this.startFileRecording();   // 现有逻辑
}

private async startVadPipeline(): Promise<void> {
  const capture = new StreamCapture({...});
  const vad = await SileroVad.create(resolveModelPath());
  const segmenter = new VadSegmenter(this.config.vad);
  const framer = new Framer();
  // 接线:capture.stdout → framer → vad → segmenter → 段 → WAV 临时文件 → transcribe → append
  // 每段转写是 fire-and-forget 的异步任务,完成后 mergeTranscript + setEditorText(增量)
  // widget: ['🎙 listening — /voice-toggle 停止'] → 段落结束时闪烁提示
}
```

**增量追加的并发**:`mergeTranscript` 已存在且幂等。多段并发转写完成顺序可能乱,用一个内部队列按段顺序 append(每段带序号),保证文字顺序。widget 在转写中显示段数。

### 4.8 配置(`types.ts` / `config.ts`)

```ts
interface VadConfig {
  enabled: boolean;          // 默认 false(平滑过渡;模型/ort 加载失败也回退)
  threshold: number;         // 0.5
  minSpeechMs: number;       // 250
  minSilenceMs: number;      // 500
  maxSpeechMs: number;       // 30000
}
interface VoiceInputConfig {
  ...existing...
  vad: VadConfig;
}
```

`/config` 注册 5 项 + 一个「检测模型 / 重新加载」说明。

## 5. 依赖与资产变更

| 项 | 变更 |
| --- | --- |
| `package.json` dependencies | 新增 `onnxruntime-web: ^1.26.0`(纯 WASM) |
| `package.json` files | 新增 `models/silero_vad.onnx`、`audio/stream-capture.ts`、`audio/framer.ts`、`audio/pcm-wav.ts`、`audio/vad/` |
| 模型来源 | snakers4/silero-vad GitHub release `silero_vad.onnx`(~2.2MB),checksum 记录 |

## 6. 回退与容错

- `vad.enabled = false` → 走现有文件模型,零行为变化。
- 模型文件缺失 / ort 加载失败 → `startVadPipeline` catch → notify + **自动回退文件模式**(保证可用性)。
- 单段转写失败 → notify 该段错误(脱敏),不影响其它段。

## 7. 实现顺序(纯函数优先,可独立单测)

| Step | 模块 | 依赖 | 可单测 |
| --- | --- | --- | --- |
| 1 | `audio/framer.ts` | 无 | ✅ |
| 2 | `audio/pcm-wav.ts` | 无 | ✅ |
| 3 | `audio/vad/segmenter.ts` | 无 | ✅ |
| 4 | `audio/vad/silero.ts` | onnxruntime-web | ✅(fake session) |
| 5 | `audio/stream-capture.ts` | framer | ✅(fake spawn) |
| 6 | `audio/recorder.ts` 流式 args | 无 | ✅ |
| 7 | `config.ts` / `types.ts` | common | ✅ |
| 8 | `flow.ts` pipeline 接线 | 1-7 | ✅(fake) |
| 9 | 模型资产 + package.json | — | 集成验证 |
| 10 | `tsc --build` / `format` / `test` | — | 验收 |
