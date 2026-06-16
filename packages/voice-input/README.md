# @htwang-contrib/voice-input

语音听写扩展 —— 为 pi coding agent 提供「录音 → 云端转写 → 追加到输入框」的命令式听写。spawn 跨平台录音命令(ffmpeg/parecord/sox)+ OpenAI 兼容的多模态 chat STT,无 native npm 依赖。可选 **VAD 分段**(Silero,纯 WASM)边说边按停顿断句、实时增量出字。

## 功能

- **`/voice-toggle`** —— 切换录音:idle 时开始录音,recording 时停止并转写,文本智能追加到输入框末尾(用户手动回车发送)
- **`/voice-cancel`** —— 取消当前录音,清浮层,不插入任何文本
- **`/voice-status`** —— 显示 provider / API key / recorder / 当前录音状态
- **`ctx.ui.setWidget` 浮层** —— 输入框上方实时状态(🎙 recording / … transcribing),完成自动消失
- **密钥脱敏** —— 所有对外可见字符串(notify / 错误消息)过 `redactSecrets`,失败信息不含明文 key
- **VAD 分段(可选)** —— 启用后边录边按语音停顿自动切段,每段独立转写并增量追加到输入框,接近实时听写

## 快速开始

1. 确保录音后端可用:NixOS/Linux 装 `ffmpeg` 或 `pulseaudioFull`(parecord),macOS/Windows 装 `ffmpeg`
2. 配置 API key(二选一):
   - 设置环境变量 `INFERENCE_TWISTOY_API_KEY`
   - 或在 pi 中运行 `/config` → Voice Input section 填入
3. 运行 `/voice-toggle` 开始说话 → 再次 `/voice-toggle` 停止 → 转写文本追加到输入框
4. (可选)开启 VAD 分段:`/config` → Voice Input → 「VAD Segmentation」开启,即可边说边出字

## 命令

| 命令            | 说明                                                   |
| --------------- | ------------------------------------------------------ |
| `/voice-toggle` | idle → 开始录音;recording → 停止 + 转写 + 追加到输入框 |
| `/voice-cancel` | 取消录音 + 清浮层                                      |
| `/voice-status` | 显示配置与状态                                         |

## Provider

本期仅内置一个预设:

| Provider              | baseUrl                           | 默认 model  | envVar                      |
| --------------------- | --------------------------------- | ----------- | --------------------------- |
| `inference-self-host` | `https://inference.twistoy.cn/v1` | `mimo-v2.5` | `INFERENCE_TWISTOY_API_KEY` |

走 inference 网关的 OpenAI 兼容 `/chat/completions`,音频作为 `input_audio` content block(OpenAI 标准格式:`{ format:"wav", data:<纯base64> }`)。不预置 openai/groq/elevenlabs —— 它们是 multipart `/audio/transcriptions` whisper 协议,与本期 chat 多模态格式不同。

## 录音后端

| 平台    | 首选                 | ffmpeg 后端                      | 默认设备           |
| ------- | -------------------- | -------------------------------- | ------------------ |
| Linux   | parecord(PulseAudio) | `-f pulse -i default`            | `default`          |
| macOS   | ffmpeg               | `-f avfoundation -i :0`          | `:0`               |
| Windows | ffmpeg               | `-f dshow -i "audio=Microphone"` | `audio=Microphone` |

统一输出 16kHz mono s16le WAV。`recorder: "auto"` 时按平台优先级探测(Linux 优先 parecord → ffmpeg → sox)。

> **VAD 模式约束**:VAD 分段需要把原始 PCM 流式输到 stdout,`parecord` 不支持,**VAD 模式下 Linux 统一走 `ffmpeg -f pulse -i default`**(以及 macOS/Windows 的 ffmpeg)。VAD 关闭时仍可用 parecord。

## VAD 分段(可选)

启用后录音从「一次性整段」变为**流式**:边录边用 Silero VAD(神经网络,`onnxruntime-web` 纯 WASM 后端,无 native 依赖)逐帧检测语音活动,按停顿自动切段,每段独立送 STT 并**增量追加**到输入框。适合连续听写,文字实时浮现。

```
mic ─► PCM 帧(16k/mono/s16le)
         │  每 ~32ms 一帧
         ▼
      Silero VAD(frame) → prob
         ├─ 语音开始 → 开新段
         ├─ 静音 ≥ minSilenceMs → 闭段 → STT → 增量 append
         └─ /voice-toggle 停止 → flush 尾段
```

- **引擎**:Silero VAD v5 模型(`models/silero_vad.onnx`,随包分发 ~2.2MB),经 `onnxruntime-web` WASM 推理,NixOS 友好
- **多段保序**:多段并发转写完成顺序可能乱,内部按段序号顺序追加(`OrderedAppender`)
- **平滑回退**:模型/ort 加载失败时自动回退到整段录音模式并 notify 提示

## 配置

在 pi 中运行 `/config`(由 `extension-config-ui` 提供)编辑 Voice Input section:

```json
{
  "voice-input": {
    "provider": "inference-self-host",
    "providers": {
      "inference-self-host": {
        "baseUrl": "https://inference.twistoy.cn/v1",
        "apiKey": "",
        "model": "mimo-v2.5"
      }
    },
    "recorder": "auto",
    "micDevice": "",
    "transcribeTimeoutMs": 60000,
    "vad": {
      "enabled": false,
      "threshold": 0.5,
      "minSpeechMs": 250,
      "minSilenceMs": 500,
      "maxSpeechMs": 30000
    }
  }
}
```

- **provider** —— 当前 STT provider(本期仅 inference-self-host)
- **providers[name].apiKey** —— key 解析优先级:**config > envVar**。`/config` 填写的 key 覆盖环境变量
- **recorder** —— `auto` / `ffmpeg` / `parecord` / `sox`
- **micDevice** —— 覆盖默认设备(空 = 平台默认)
- **transcribeTimeoutMs** —— 转写超时,默认 60000
- **vad.enabled** —— 开启流式 VAD 分段(默认 false)
- **vad.threshold** —— 语音概率门限 0–1,越高越严(默认 0.5)
- **vad.minSpeechMs** —— 开段所需最短语音时长,过滤瞬态噪声(默认 250)
- **vad.minSilenceMs** —— 闭段所需静音时长,触发该段转写(默认 500)
- **vad.maxSpeechMs** —— 单段硬上限,超时强制切(默认 30000)

## 临时文件

普通模式:录音文件落在 `$TMPDIR/voice-input-XXX/recording.wav`。VAD 模式:每段落在 `$TMPDIR/voice-vad-XXX/seg-N.wav`。两者均**用完即删**(`finalizeRecording` / `cancel` / `release` 的 finally 都 cleanup)。不保留录音历史。

## 设计文档

- [docs/pi-vox/DESIGN.md](../../docs/pi-vox/DESIGN.md) —— 完整设计(融合 pi-vox / pi-mimo-voice / talk-pi 三份审计)
- [docs/pi-vox/DESIGN-VAD.md](../../docs/pi-vox/DESIGN-VAD.md) —— VAD 流式分段设计(Silero + 增量追加)
- [docs/pi-vox/DESIGN-STEPS.md](../../docs/pi-vox/DESIGN-STEPS.md) —— 分 Phase 实施清单
- [docs/pi-vox/ANALYSIS-pi-mimo-voice.md](../../docs/pi-vox/ANALYSIS-pi-mimo-voice.md) —— pi-mimo-voice 源码分析与跨平台录音矩阵
