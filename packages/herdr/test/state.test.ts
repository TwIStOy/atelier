import type { AskUserPromptPayload } from "@htwang-contrib/common";
import { describe, expect, it } from "vitest";
import { type AgentState, buildTabTitle, stateIcon, summarizeAskUserQuestion } from "../src/state.ts";

describe("stateIcon", () => {
  it("maps each state to a distinct glyph", () => {
    expect(stateIcon("running")).toBe("⏺");
    expect(stateIcon("waiting")).toBe("❓");
    expect(stateIcon("idle")).toBe("✓");
  });

  it("covers every AgentState", () => {
    const states: AgentState[] = ["running", "waiting", "idle"];
    const icons = new Set(states.map(stateIcon));
    expect(icons.size).toBe(states.length);
  });
});

describe("buildTabTitle", () => {
  it("prefixes the body with the state icon", () => {
    expect(buildTabTitle("running", "Refactor auth")).toBe("⏺ Refactor auth");
    expect(buildTabTitle("waiting", "Pick model")).toBe("❓ Pick model");
    expect(buildTabTitle("idle", "Done")).toBe("✓ Done");
  });

  it("uses a state-specific fallback when the body is blank", () => {
    expect(buildTabTitle("running", "")).toBe("⏺ Working…");
    expect(buildTabTitle("running", "   ")).toBe("⏺ Working…");
    expect(buildTabTitle("waiting", "")).toBe("❓ Needs input");
    expect(buildTabTitle("idle", "")).toBe("✓ Pi");
  });

  it("caps the title at 80 characters (herdr's tab label limit)", () => {
    const long = "X".repeat(200);
    const title = buildTabTitle("idle", long);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.startsWith("✓ ")).toBe(true);
  });
});

describe("summarizeAskUserQuestion", () => {
  it("returns the first question text", () => {
    const payload: AskUserPromptPayload = {
      questions: [
        {
          question: "Which library should we use?",
          header: "Library",
          multiSelect: false,
          options: [
            { label: "A", description: "", hasPreview: false },
            { label: "B", description: "", hasPreview: false },
          ],
        },
      ],
    };
    expect(summarizeAskUserQuestion(payload)).toBe("Which library should we use?");
  });

  it("falls back to the header when the question is empty", () => {
    const payload: AskUserPromptPayload = {
      questions: [
        {
          question: "  ",
          header: "Auth method",
          multiSelect: false,
          options: [],
        },
      ],
    };
    expect(summarizeAskUserQuestion(payload)).toBe("Auth method");
  });

  it("returns a generic fallback for a missing payload", () => {
    expect(summarizeAskUserQuestion(null)).toBe("Needs input");
    expect(summarizeAskUserQuestion(undefined)).toBe("Needs input");
    expect(summarizeAskUserQuestion({ questions: [] })).toBe("Needs input");
  });
});
