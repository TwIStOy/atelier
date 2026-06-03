import { truncateDisplay } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, INDENT } from "./shared.ts";

interface AuqQuestionArg {
  header?: string;
  question?: string;
  multiSelect?: boolean;
  options?: unknown[];
}

interface AskUserQuestionArgs {
  questions?: AuqQuestionArg[];
}

function summarize(args: AskUserQuestionArgs): {
  count: number;
  optionTotal: number;
  chips: string;
} {
  const qs = Array.isArray(args.questions) ? args.questions : [];
  let optionTotal = 0;
  for (const q of qs) {
    if (q && Array.isArray(q.options)) optionTotal += q.options.length;
  }
  const chips = qs
    .map((q) => (typeof q?.header === "string" ? q.header.trim() : ""))
    .filter((h) => h.length > 0)
    .slice(0, 5)
    .map((h) => truncateDisplay(h, 14))
    .join(" · ");
  return { count: qs.length, optionTotal, chips };
}

export const askUserQuestionAdapter: ToolDisplayAdapter<AskUserQuestionArgs> = {
  formatCallHeader(args, theme, _details, _isPartial, expanded) {
    const { count, optionTotal, chips } = summarize(args);
    const title = theme.fg("toolTitle", theme.bold("AskUserQuestion"));
    if (expanded) {
      if (count === 0) {
        return (
          title + theme.fg("muted", " · ") + theme.fg("warning", "no questions")
        );
      }
      let line = title + theme.fg("muted", " · ");
      line +=
        theme.fg("accent", `${count} question${count !== 1 ? "s" : ""}`) +
        theme.fg("muted", ", ") +
        theme.fg(
          "toolOutput",
          `${optionTotal} option${optionTotal !== 1 ? "s" : ""}`,
        );
      if (chips) {
        line +=
          theme.fg("muted", " · ") +
          theme.fg("dim", truncateDisplay(chips, 72));
      }
      return line;
    }
    if (count === 0) {
      return (
        title + theme.fg("muted", " · ") + theme.fg("warning", "no questions")
      );
    }
    return title;
  },

  formatCollapsedContent(
    args,
    _output,
    theme,
    _width,
    _details,
    _isPartial,
    _spinAt,
  ) {
    const { count } = summarize(args);
    const lines: string[] = [];
    if (count > 0) {
      lines.push(
        INDENT +
          theme.fg("muted", `└ ${count} question${count !== 1 ? "s" : ""}`),
      );
    }
    return lines;
  },

  formatExpandedContent(_args, output, theme, width, _details) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
