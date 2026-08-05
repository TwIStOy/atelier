import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";
import type { ThinkingLoopOptions } from "./thinking-loop.ts";
import type { ToolLoopOptions } from "./tool-loop.ts";

export const CONFIG_ID = "loop-guard";

export interface LoopGuardConfig {
  enabled: boolean;
  maxRepeats: number;
  pingPongMinCycles: number;
  windowSize: number;
  thinkingEnabled: boolean;
  thinkingMinChunkChars: number;
  thinkingAcrossRepeatLimit: number;
  thinkingHistoryMessages: number;
  thinkingInjectRecovery: boolean;
  thinkingMaxInjections: number;
  streamDetectionEnabled: boolean;
  streamMinWindow: number;
  streamMaxWindow: number;
  streamStride: number;
  notifyOnDetect: boolean;
}

export const DEFAULT_CONFIG: LoopGuardConfig = {
  enabled: true,
  maxRepeats: 3,
  pingPongMinCycles: 3,
  windowSize: 30,
  thinkingEnabled: true,
  thinkingMinChunkChars: 200,
  thinkingAcrossRepeatLimit: 1,
  thinkingHistoryMessages: 20,
  thinkingInjectRecovery: true,
  thinkingMaxInjections: 3,
  streamDetectionEnabled: true,
  streamMinWindow: 80,
  streamMaxWindow: 2000,
  streamStride: 50,
  notifyOnDetect: true,
};

const CONFIG_SCHEMA: ExtensionConfigSchema<LoopGuardConfig> = {
  defaults: { ...DEFAULT_CONFIG },
};

export function loadConfig(): LoopGuardConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

export function toolLoopOptions(config: LoopGuardConfig): ToolLoopOptions {
  return {
    windowSize: config.windowSize,
    maxRepeats: config.maxRepeats,
    pingPongMinCycles: config.pingPongMinCycles,
  };
}

export function thinkingLoopOptions(config: LoopGuardConfig): ThinkingLoopOptions {
  return {
    minChunkChars: config.thinkingMinChunkChars,
    acrossRepeatLimit: config.thinkingAcrossRepeatLimit,
    maxMessages: config.thinkingHistoryMessages,
  };
}

export function registerConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "enabled",
      type: "boolean",
      label: "Enabled",
      value: () => loadConfig().enabled,
      description: "Detect repeated tool calls and block them with feedback to the model.",
      extensionLabel: "Loop Guard",
      order: 0,
    },
    {
      key: "maxRepeats",
      type: "number",
      label: "Max Identical Calls",
      value: () => loadConfig().maxRepeats,
      min: 2,
      max: 20,
      description:
        "Block a tool call when the same tool with identical arguments has already returned identical results this many times.",
      extensionLabel: "Loop Guard",
      order: 10,
    },
    {
      key: "pingPongMinCycles",
      type: "number",
      label: "Ping-Pong Cycles",
      value: () => loadConfig().pingPongMinCycles,
      min: 2,
      max: 10,
      description: "Block when two calls alternate in a fixed A,B cycle (with identical results) this many times.",
      extensionLabel: "Loop Guard",
      order: 20,
    },
    {
      key: "windowSize",
      type: "number",
      label: "History Window",
      value: () => loadConfig().windowSize,
      min: 5,
      max: 200,
      description: "How many recent tool results are kept for loop detection. Older calls are forgotten.",
      extensionLabel: "Loop Guard",
      order: 30,
    },
    {
      key: "thinkingEnabled",
      type: "boolean",
      label: "Thinking Loop Detection",
      value: () => loadConfig().thinkingEnabled,
      description: "Detect reasoning content that repeats within one response or across consecutive turns.",
      extensionLabel: "Loop Guard",
      order: 40,
    },
    {
      key: "thinkingInjectRecovery",
      type: "boolean",
      label: "Inject Recovery Message",
      value: () => loadConfig().thinkingInjectRecovery,
      description:
        "When a thinking loop is detected and the response has no pending tool calls, inject a recovery message that starts a new turn so the model can course-correct.",
      extensionLabel: "Loop Guard",
      order: 45,
    },
    {
      key: "thinkingMaxInjections",
      type: "number",
      label: "Max Recovery Injections",
      value: () => loadConfig().thinkingMaxInjections,
      min: 1,
      max: 10,
      description:
        "Stop injecting recovery messages after this many consecutive thinking-loop detections (notifications continue) until a clean response resets the counter.",
      extensionLabel: "Loop Guard",
      order: 46,
    },
    {
      key: "thinkingMinChunkChars",
      type: "number",
      label: "Thinking Min Chunk Chars",
      value: () => loadConfig().thinkingMinChunkChars,
      min: 40,
      max: 2000,
      description: "Minimum length of a reasoning paragraph to consider for repetition detection.",
      extensionLabel: "Loop Guard",
      order: 50,
    },
    {
      key: "thinkingAcrossRepeatLimit",
      type: "number",
      label: "Thinking Across-Turn Limit",
      value: () => loadConfig().thinkingAcrossRepeatLimit,
      min: 1,
      max: 10,
      description: "How many distinct reasoning paragraphs must repeat from earlier turns before flagging a loop.",
      extensionLabel: "Loop Guard",
      order: 60,
    },
    {
      key: "thinkingHistoryMessages",
      type: "number",
      label: "Thinking History Messages",
      value: () => loadConfig().thinkingHistoryMessages,
      min: 2,
      max: 100,
      description: "How many recent assistant messages are kept for across-turn thinking comparison.",
      extensionLabel: "Loop Guard",
      order: 70,
    },
    {
      key: "streamDetectionEnabled",
      type: "boolean",
      label: "Stream Loop Detection",
      value: () => loadConfig().streamDetectionEnabled,
      description:
        "Detect verbatim repetition while a response is still streaming and abort it mid-generation. This is the only intervention that works when the model loops forever and the message never finalizes.",
      extensionLabel: "Loop Guard",
      order: 90,
    },
    {
      key: "streamMinWindow",
      type: "number",
      label: "Stream Min Block Chars",
      value: () => loadConfig().streamMinWindow,
      min: 20,
      max: 1000,
      description: "Minimum size of a repeated block that aborts the stream.",
      extensionLabel: "Loop Guard",
      order: 91,
    },
    {
      key: "streamMaxWindow",
      type: "number",
      label: "Stream Max Block Chars",
      value: () => loadConfig().streamMaxWindow,
      min: 200,
      max: 10000,
      description: "Maximum size of a repeated block considered; only the last 2x this many characters are examined.",
      extensionLabel: "Loop Guard",
      order: 92,
    },
    {
      key: "streamStride",
      type: "number",
      label: "Stream Check Stride",
      value: () => loadConfig().streamStride,
      min: 10,
      max: 500,
      description: "Run the repetition check every N newly streamed characters.",
      extensionLabel: "Loop Guard",
      order: 93,
    },
    {
      key: "notifyOnDetect",
      type: "boolean",
      label: "Notify On Detect",
      value: () => loadConfig().notifyOnDetect,
      description: "Show a notification when a loop is detected.",
      extensionLabel: "Loop Guard",
      order: 80,
    },
  ]);
}
