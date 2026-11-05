import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatTokens, formatTokenUsageArrows } from "@htwang-contrib/common";
import type { StatusLineComponent } from "./base.ts";

type BranchEntry = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>[number];

interface UsageSums {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const ZERO_SUMS: UsageSums = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function entryUsage(entry: BranchEntry): UsageSums | undefined {
  if (entry.type !== "message" || entry.message.role !== "assistant") return undefined;
  const usage = (entry.message as AssistantMessage).usage;
  return { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite };
}

function addTo(target: UsageSums, add: UsageSums): void {
  target.input += add.input;
  target.output += add.output;
  target.cacheRead += add.cacheRead;
  target.cacheWrite += add.cacheWrite;
}

// The footer renders per frame (every streamed token redraw), so summing the
// whole branch per render degrades with session length. Sums over finalized
// entries (everything before the last) are cached as a prefix and folded
// forward as new entries arrive; the still-mutable last entry is read fresh.
// An anchor mismatch (tree switch/fork/compaction) rebuilds the prefix once.
export class TokensComponent implements StatusLineComponent {
  private prefix:
    | { upTo: number; first: BranchEntry | undefined; anchor: BranchEntry | undefined; sums: UsageSums }
    | undefined;
  private ctx: ExtensionContext;

  constructor(ctx: ExtensionContext) {
    this.ctx = ctx;
  }

  private prefixSums(branch: BranchEntry[]): UsageSums {
    let prefix = this.prefix;
    if (
      prefix === undefined ||
      prefix.upTo > branch.length ||
      (prefix.upTo !== 0 && (branch[0] !== prefix.first || branch[prefix.upTo - 1] !== prefix.anchor))
    ) {
      prefix = { upTo: 0, first: branch[0], anchor: undefined, sums: { ...ZERO_SUMS } };
    }
    while (prefix.upTo < branch.length - 1) {
      const entry = branch[prefix.upTo];
      const usage = entry ? entryUsage(entry) : undefined;
      if (usage) addTo(prefix.sums, usage);
      prefix.upTo++;
      prefix.anchor = entry;
    }
    this.prefix = prefix;
    return prefix.sums;
  }

  render(width: number, theme: Theme): string[] {
    const branch = this.ctx.sessionManager.getBranch();
    const sums = { ...this.prefixSums(branch) };
    const lastUsage = branch.length > 0 ? entryUsage(branch[branch.length - 1] as BranchEntry) : undefined;
    if (lastUsage) addTo(sums, lastUsage);

    const parts = [
      formatTokenUsageArrows(sums.input, sums.output),
      `R${formatTokens(sums.cacheRead)}`,
      `W${formatTokens(sums.cacheWrite)}`,
    ];

    return [truncateToWidth(theme.fg("dim", parts.join(" ")), width, "")];
  }
}
