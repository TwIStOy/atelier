import type { Message, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { serializeConversation } from "@earendil-works/pi-coding-agent";
import { branchToMessages, createLogger, executeSideCall, type SideCallResult } from "@htwang-contrib/common";
import { loadRecapConfig, type RecapConfig, resolveRecapModel } from "./config.ts";
import { clearRecapWidget, setRecapLoadingWidget, setRecapTextWidget } from "./widget.ts";

const logger = createLogger("recap");

const SYSTEM_PROMPT = [
  "You write concise idle session recaps for a terminal coding agent.",
  "Use only transcript-supported facts; do not invent progress, intent, files, or next steps.",
  "Prefer the latest active task if the session changed direction.",
  "Summarize the user's goal, what was done, current state, and any clearly supported next step.",
  "Respond in the conversation's primary language. Address the user in the second person.",
  "Output 1-2 plain-text sentences under 40 words. No heading, markdown, bullets, or quotes.",
].join(" ");

const MAX_CONVERSATION_CHARS = 8_000;
const RECAP_MAX_CHARS = 400;

type AnyModel = Model<any>;
type SideCallFailure = Extract<SideCallResult, { ok: false }>;

interface PreparedRecap {
  model: AnyModel;
  messages: Message[];
}

export function buildRecapPrompt(messages: Message[]): string {
  const text = serializeConversation(messages);
  const conversation = text.length > MAX_CONVERSATION_CHARS ? text.slice(-MAX_CONVERSATION_CHARS) : text;

  return [
    "Create a short recap from this transcript, ordered oldest to newest.",
    "It may be truncated from the beginning; focus on the latest coherent task.",
    "",
    "<conversation>",
    conversation,
    "</conversation>",
  ].join("\n");
}

export function parseRecap(rawAnswer: string): string {
  const cleaned = rawAnswer
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > RECAP_MAX_CHARS ? cleaned.slice(0, RECAP_MAX_CHARS - 1).trimEnd() : cleaned;
}

export class RecapManager {
  private readonly pi: ExtensionAPI;
  private readonly config: RecapConfig;
  private inflight: AbortController | undefined;
  private active = false;

  constructor(pi: ExtensionAPI, config: RecapConfig) {
    this.pi = pi;
    this.config = config;
  }

  async run(ctx: ExtensionContext, options: { force?: boolean } = {}): Promise<void> {
    if (this.active && !options.force) return;

    this.cancelInflight();
    const controller = new AbortController();
    this.inflight = controller;

    try {
      await this.execute(ctx, controller);
    } catch (error) {
      this.handleRunError(error, controller, ctx);
    } finally {
      if (this.inflight === controller) this.inflight = undefined;
    }
  }

  private async execute(ctx: ExtensionContext, controller: AbortController): Promise<void> {
    const prepared = this.prepareRecap(ctx, controller);
    if (!prepared) return;
    const result = await this.callRecapModel(prepared.model, prepared.messages, ctx, controller);
    if (!result) return;
    this.applyRecapResult(result, prepared.model, ctx);
  }

  private prepareRecap(ctx: ExtensionContext, controller: AbortController): PreparedRecap | null {
    const model = this.resolveRecapModelFor(ctx, controller);
    if (!model) return null;

    const messages = branchToMessages(ctx.sessionManager.getBranch());
    if (this.isStale(controller)) return null;
    if (messages.length === 0) {
      clearRecapWidget(ctx);
      return null;
    }

    setRecapLoadingWidget(ctx);
    this.active = false;
    return { model, messages };
  }

  private resolveRecapModelFor(ctx: ExtensionContext, controller: AbortController): AnyModel | undefined {
    const model = resolveRecapModel(ctx.modelRegistry, this.config) ?? ctx.model;
    if (this.isStale(controller)) return undefined;
    if (!model) {
      ctx.ui.notify("No model available for recap", "warning");
    }
    return model;
  }

  private async callRecapModel(
    model: AnyModel,
    messages: Message[],
    ctx: ExtensionContext,
    controller: AbortController,
  ): Promise<SideCallResult | undefined> {
    const result = await executeSideCall({
      model,
      modelRegistry: ctx.modelRegistry,
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildRecapPrompt(messages),
          timestamp: Date.now(),
        },
      ],
      signal: controller.signal,
      commandName: "recap",
    });
    if (this.isStale(controller)) return undefined;
    return result;
  }

  private applyRecapResult(result: SideCallResult, model: AnyModel, ctx: ExtensionContext): void {
    if (!result.ok) {
      this.handleRecapFailure(result, ctx);
      return;
    }

    const content = parseRecap(result.answer);
    if (!content) {
      clearRecapWidget(ctx);
      return;
    }

    setRecapTextWidget(ctx, content);
    this.active = true;

    this.pi.appendEntry("recap", {
      provider: model.provider,
      model: model.id,
      usage: result.assistantMessage.usage,
      content,
    });
  }

  private handleRecapFailure(result: SideCallFailure, ctx: ExtensionContext): void {
    if ("aborted" in result) {
      clearRecapWidget(ctx);
    } else {
      logger.debug(`recap side-call failed: ${result.error}`);
      setRecapTextWidget(ctx, "Unable to generate recap.");
    }
    this.active = false;
  }

  private handleRunError(error: unknown, controller: AbortController, ctx: ExtensionContext): void {
    if (this.isStale(controller)) return;
    logger.debug(`recap run threw: ${String(error).slice(0, 300)}`);
    setRecapTextWidget(ctx, "Unable to generate recap.");
    this.active = false;
  }

  private isStale(controller: AbortController): boolean {
    return controller.signal.aborted || this.inflight !== controller;
  }

  clear(ctx: ExtensionContext): void {
    this.cancelInflight();
    clearRecapWidget(ctx);
    this.active = false;
  }

  private cancelInflight(): void {
    this.inflight?.abort();
    this.inflight = undefined;
  }
}

export function createRecapManager(pi: ExtensionAPI): RecapManager | undefined {
  const config = loadRecapConfig();
  if (!config.enabled) return undefined;
  return new RecapManager(pi, config);
}
