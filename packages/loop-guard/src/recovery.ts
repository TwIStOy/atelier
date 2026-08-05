import type { ThinkingLoopDetection } from "./thinking-loop.ts";

function escalatedRecovery(consecutive: number): string {
  return [
    `[loop-guard] LOOP PERSISTS (${consecutive}x in a row): your reasoning keeps repeating itself despite previous warnings.`,
    "STOP — do not continue down the same path.",
    "Give the user a direct, concise summary of what you were trying to accomplish, why it is not converging, and ask how to proceed.",
  ].join(" ");
}

export function buildStreamRecovery(stream: "thinking" | "output", consecutive: number): string {
  if (consecutive >= 2) return escalatedRecovery(consecutive);
  if (stream === "thinking") {
    return [
      "[loop-guard] THINKING LOOP DETECTED: your reasoning stream was repeating the same content verbatim, so it was aborted and the repeated section was truncated.",
      "Do not re-derive that reasoning.",
      "Re-examine your approach and continue with the task: take a concretely different action, or report to the user why you are stuck and ask for guidance.",
    ].join(" ");
  }
  return [
    "[loop-guard] OUTPUT LOOP DETECTED: your response text was repeating the same content verbatim, so it was aborted and the repeated section was truncated.",
    "Do NOT re-emit the repeated content — continue from where the response was cut, or wrap up with a concise conclusion.",
  ].join(" ");
}

export function buildThinkingRecovery(detection: ThinkingLoopDetection, consecutive: number): string {
  if (consecutive >= 2) return escalatedRecovery(consecutive);
  if (detection.kind === "within-message") {
    return [
      "[loop-guard] THINKING LOOP DETECTED: your last response repeated the same reasoning verbatim — circular thinking without progress.",
      "Do not re-emit that reasoning.",
      "Re-examine the problem, take a concretely different action, or report to the user why you are stuck and ask for guidance.",
    ].join(" ");
  }
  return [
    "[loop-guard] REASONING STAGNATION: your thinking is repeating reasoning from earlier turns verbatim — re-deriving the same conclusions without progress.",
    "Do not reconstruct that reasoning.",
    "Take a different concrete action, or report the blocker to the user and ask how to proceed.",
  ].join(" ");
}
