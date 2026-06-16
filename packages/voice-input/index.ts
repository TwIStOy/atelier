import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  loadConfig,
  registerVoiceInputConfigItems,
  resolveApiKey,
} from "./config.ts";
import { LocalAudioCapture } from "./audio/capture.ts";
import { selectRecorder, selectStreamRecorder } from "./audio/recorder.ts";
import { StreamCapture } from "./audio/stream-capture.ts";
import { VadPipeline } from "./audio/vad-pipeline.ts";
import { SileroVad } from "./audio/vad/silero.ts";
import { createSttProvider } from "./providers/index.ts";
import { VoiceInputFlow, type FlowContext } from "./flow.ts";
import { safeError } from "./secrets.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const EXTENSION_ID = "voice-input";
const MODEL_SHA256 =
  "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";

function resolveModelPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "models", "silero_vad.onnx");
}

export interface VoiceInputFlowLike {
  startRecording(): Promise<void>;
  finalizeRecording(): Promise<unknown>;
  cancel(): Promise<void>;
}

export type FlowFactory = (ctx: FlowContext) => Promise<VoiceInputFlowLike>;

export class VoiceInputController {
  private flow: VoiceInputFlowLike | null = null;

  constructor(private readonly newFlow: FlowFactory) {}

  isRecording(): boolean {
    return this.flow !== null;
  }

  reset(): void {
    this.flow = null;
  }

  async toggle(ctx: FlowContext): Promise<void> {
    try {
      if (!this.isRecording()) {
        const flow = await this.newFlow(ctx);
        this.flow = flow;
        await flow.startRecording();
        return;
      }
      const flow = this.flow;
      if (!flow) return;
      this.flow = null;
      await flow.finalizeRecording();
    } catch (error) {
      await this.flow?.cancel().catch(() => {
        // best-effort cleanup of a partially started recorder
      });
      clearUi(ctx);
      this.flow = null;
      ctx.ui.notify(`Voice toggle failed: ${safeError(error)}`, "warning");
    }
  }

  async cancel(ctx: FlowContext): Promise<void> {
    const flow = this.flow;
    this.flow = null;
    await flow?.cancel().catch(() => {
      // best-effort
    });
    clearUi(ctx);
    ctx.ui.notify("Voice recording cancelled", "info");
  }
}

function clearUi(ctx: FlowContext): void {
  ctx.ui.setWidget(EXTENSION_ID, undefined);
}

async function createFlow(ctx: FlowContext): Promise<VoiceInputFlow> {
  const config = loadConfig();
  const provider = await createSttProvider(config.provider);

  if (config.vad.enabled) {
    const pipeline = await tryCreateVadPipeline(ctx, config, provider);
    if (pipeline) {
      const recorder = selectRecorder(config);
      return new VoiceInputFlow({
        ctx,
        provider,
        config,
        recorder: new LocalAudioCapture({ recorder, device: config.micDevice }),
        pipeline,
      });
    }
    ctx.ui.notify(
      "VAD enabled but unavailable — falling back to whole-file recording.",
      "warning",
    );
  }

  const recorder = selectRecorder(config);
  return new VoiceInputFlow({
    ctx,
    provider,
    config,
    recorder: new LocalAudioCapture({ recorder, device: config.micDevice }),
  });
}

async function tryCreateVadPipeline(
  ctx: FlowContext,
  config: ReturnType<typeof loadConfig>,
  provider: Awaited<ReturnType<typeof createSttProvider>>,
): Promise<VadPipeline | null> {
  try {
    const streamRecorder = selectStreamRecorder(config);
    const vad = await SileroVad.create({
      modelPath: resolveModelPath(),
      expectedSha256: MODEL_SHA256,
    });
    return new VadPipeline({
      capture: new StreamCapture({
        recorder: streamRecorder,
        device: config.micDevice,
      }),
      vad,
      config: config.vad,
      transcribe: (file, signal) => provider.transcribe(file, signal),
      transcribeTimeoutMs: config.transcribeTimeoutMs,
    });
  } catch (err) {
    ctx.ui.notify(`VAD init failed: ${safeError(err)}`, "warning");
    return null;
  }
}

export default function (pi: ExtensionAPI): void {
  const controller = new VoiceInputController(createFlow);

  pi.on("session_start", () => {
    controller.reset();
    registerVoiceInputConfigItems();
  });

  pi.registerCommand("voice-toggle", {
    description: "Toggle voice recording on/off",
    handler: async (_args, ctx) => {
      await controller.toggle(ctx);
    },
  });

  pi.registerCommand("voice-cancel", {
    description: "Cancel active voice recording",
    handler: async (_args, ctx) => {
      await controller.cancel(ctx);
    },
  });

  pi.registerCommand("voice-status", {
    description: "Show voice input configuration status",
    handler: async (_args, ctx) => {
      const config = loadConfig();
      const apiKey = resolveApiKey(config.provider);
      ctx.ui.notify(
        `Voice input: provider=${config.provider}, key=${apiKey ? "configured" : "missing"}, recorder=${config.recorder}, recording=${controller.isRecording() ? "yes" : "no"}`,
        apiKey ? "info" : "warning",
      );
    },
  });
}
