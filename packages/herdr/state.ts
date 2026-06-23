/**
 * Agent state model + display icons for the herdr tab title.
 *
 * Three observable states, derived from pi events:
 *   running  — the agent turn is in progress (`before_agent_start` … `agent_end`)
 *   waiting  — the agent is blocked on a user question (`ask_user_question` modal open)
 *   idle     — the agent finished its turn and is awaiting the next prompt (`agent_end`)
 */
import type { AskUserPromptPayload } from "@htwang-contrib/common";

export type AgentState = "running" | "waiting" | "idle";

/** A short glyph prefixed onto the tab title to surface the agent's state. */
export function stateIcon(state: AgentState): string {
  switch (state) {
    case "running":
      return "⏺";
    case "waiting":
      return "❓";
    case "idle":
      return "✓";
  }
}

/**
 * Build the full tab title from an icon, a body, and a state.
 *
 * `body` is the (possibly empty) session summary; when missing we fall back to
 * a short, state-specific placeholder so the title is never blank.
 */
export function buildTabTitle(state: AgentState, body: string): string {
  const icon = stateIcon(state);
  const trimmed = body.trim();
  const fallback =
    state === "running"
      ? "Working…"
      : state === "waiting"
        ? "Needs input"
        : "Pi";
  const text = trimmed.length > 0 ? trimmed : fallback;
  return `${icon} ${text}`.slice(0, 80);
}

/** Format the first question of an `ask_user_question` payload for display. */
export function summarizeAskUserQuestion(
  payload: AskUserPromptPayload | null | undefined,
): string {
  const first = payload?.questions?.[0];
  if (!first) return "Needs input";
  const message =
    first.question?.trim() || first.header?.trim() || "Needs input";
  return message;
}
