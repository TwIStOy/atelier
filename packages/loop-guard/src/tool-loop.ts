import { resultSignature, summarizeCall, toolSignature } from "./signatures.ts";

export interface ToolLoopOptions {
  windowSize: number;
  maxRepeats: number;
  pingPongMinCycles: number;
  allowedTools: ReadonlySet<string>;
}

export type ToolLoopDetection =
  | { kind: "repeat"; toolName: string; count: number; summary: string }
  | { kind: "ping-pong"; tools: [string, string]; cycles: number };

interface ToolRecord {
  signature: string;
  result: string;
  toolName: string;
}

export class ToolLoopDetector {
  private history: ToolRecord[] = [];

  reset(): void {
    this.history = [];
  }

  checkCall(toolName: string, input: unknown, options: ToolLoopOptions): ToolLoopDetection | null {
    if (options.allowedTools.has(toolName)) return null;
    const signature = toolSignature(toolName, input);
    const pingPong = this.checkPingPong(signature, toolName, options);
    if (pingPong) return pingPong;
    const countsByResult = new Map<string, number>();
    for (const record of this.history) {
      if (record.signature !== signature) continue;
      countsByResult.set(record.result, (countsByResult.get(record.result) ?? 0) + 1);
    }
    const maxIdentical = Math.max(0, ...countsByResult.values());
    if (maxIdentical + 1 >= options.maxRepeats) {
      return {
        kind: "repeat",
        toolName,
        count: maxIdentical + 1,
        summary: summarizeCall(toolName, input),
      };
    }
    return null;
  }

  recordResult(toolName: string, input: unknown, resultText: string, isError: boolean, options: ToolLoopOptions): void {
    if (options.allowedTools.has(toolName)) return;
    this.history.push({
      signature: toolSignature(toolName, input),
      result: resultSignature(resultText, isError),
      toolName,
    });
    while (this.history.length > options.windowSize) {
      this.history.shift();
    }
  }

  private checkPingPong(signature: string, toolName: string, options: ToolLoopOptions): ToolLoopDetection | null {
    const history = this.history;
    if (history.length < 2 * (options.pingPongMinCycles - 1)) return null;
    const tail = history[history.length - 1];
    if (tail.signature === signature) return null;
    const aRecords: ToolRecord[] = [];
    const bRecords: ToolRecord[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const expectB = (history.length - 1 - i) % 2 === 0;
      const record = history[i];
      if (expectB) {
        if (record.signature !== tail.signature) break;
        bRecords.push(record);
      } else {
        if (record.signature !== signature) break;
        aRecords.push(record);
      }
    }
    const cycles = aRecords.length + 1;
    if (cycles < options.pingPongMinCycles || bRecords.length < aRecords.length) return null;
    if (!allSameResult(aRecords) || !allSameResult(bRecords)) return null;
    return { kind: "ping-pong", tools: [toolName, tail.toolName], cycles };
  }
}

function allSameResult(records: ToolRecord[]): boolean {
  const first = records[0];
  return first !== undefined && records.every((r) => r.result === first.result);
}
