import { hashText } from "./signatures.ts";

export interface ThinkingLoopOptions {
  minChunkChars: number;
  acrossRepeatLimit: number;
  maxMessages: number;
}

export type ThinkingLoopDetection =
  | { kind: "within-message"; repeatedChunks: number }
  | { kind: "across-turns"; repeatedChunks: number };

export function extractChunks(thinking: string, minChars: number): string[] {
  return thinking
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length >= minChars);
}

export class ThinkingLoopDetector {
  private history: Set<string>[] = [];

  reset(): void {
    this.history = [];
  }

  checkMessage(thinkingTexts: string[], options: ThinkingLoopOptions): ThinkingLoopDetection | null {
    const counts = new Map<string, number>();
    for (const text of thinkingTexts) {
      for (const chunk of extractChunks(text, options.minChunkChars)) {
        const hash = hashText(chunk);
        counts.set(hash, (counts.get(hash) ?? 0) + 1);
      }
    }
    let within = 0;
    for (const count of counts.values()) {
      if (count >= 2) within++;
    }
    let across = 0;
    for (const hash of counts.keys()) {
      if (this.history.some((seen) => seen.has(hash))) across++;
    }
    this.history.push(new Set(counts.keys()));
    while (this.history.length > options.maxMessages) {
      this.history.shift();
    }
    if (within > 0) return { kind: "within-message", repeatedChunks: within };
    if (across >= options.acrossRepeatLimit) return { kind: "across-turns", repeatedChunks: across };
    return null;
  }
}
