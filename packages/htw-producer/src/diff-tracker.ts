export interface DiffCounts {
  add: number;
  delete: number;
}

export function countLines(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) return 0;
  return value.split(/\r?\n/).length;
}

interface EditItem {
  oldText?: unknown;
  newText?: unknown;
}

function asEditArray(raw: unknown): EditItem[] {
  if (Array.isArray(raw)) return raw as EditItem[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.oldText !== undefined || obj.newText !== undefined) return [obj as EditItem];
  }
  return [];
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string") return v;
  }
  return undefined;
}

export class DiffTracker {
  private add = 0;
  private delete = 0;

  recordToolStart(toolName: string, args: unknown): void {
    if (!args || typeof args !== "object") return;
    const obj = args as Record<string, unknown>;

    if (toolName === "edit") {
      for (const edit of asEditArray(obj.edits ?? obj)) {
        this.delete += countLines(edit.oldText);
        this.add += countLines(edit.newText);
      }
      return;
    }

    if (toolName === "write") {
      this.add += countLines(firstString(obj.content, obj.text));
    }
  }

  snapshot(): DiffCounts {
    return { add: this.add, delete: this.delete };
  }

  reset(): void {
    this.add = 0;
    this.delete = 0;
  }
}
