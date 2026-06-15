import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  loadConfig,
  registerVoiceInputConfigItems,
  resolveApiKey,
} from "./config.ts";
import { LocalAudioCapture } from "./audio/capture.ts";
import { selectRecorder } from "./audio/recorder.ts";
import { createSttProvider } from "./providers/index.ts";
import { VoiceInputFlow, type FlowContext } from "./flow.ts";
import { safeError } from "./secrets.ts";

const EXTENSION_ID = "voice-input";

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
