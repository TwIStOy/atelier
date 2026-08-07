import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Component, Markdown } from "@earendil-works/pi-tui";

export interface CompactThinkingConfig {
  previewLines: number;
  animationIntervalMs: number;
}

export interface DurationEntryData {
  messageTimestamp: number;
  contentIndex: number;
  durationMs: number;
}

export interface ActiveThinking {
  messageTimestamp: number;
  contentIndex: number;
  startedAt: number;
}

export interface AssistantInternals {
  contentContainer: {
    children: Component[];
    clear(): void;
    addChild(component: Component): void;
  };
  hideThinkingBlock: boolean;
  markdownTheme: ConstructorParameters<typeof Markdown>[3];
  hiddenThinkingLabel: string;
  outputPad: number;
  lastMessage?: AssistantMessage;
  hasToolCalls: boolean;
  updateContent(message: AssistantMessage): void;
}

export type PatchedPrototype = typeof AssistantMessageComponent.prototype & {
  updateContent: (message: AssistantMessage) => void;
};
