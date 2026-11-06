import { type ContextEvent, convertToLlm } from "@earendil-works/pi-coding-agent";
import { createComplexityAssessment } from "@htwang-contrib/common/model-complexity";
import { systemOne } from "@htwang-contrib/common/systemone";

export interface MessageComplexity {
  flash: number;
  middle: number;
  flagship: number;
}

export interface MessageComplexityContext {
  systemPrompt: string;
  messages: ContextEvent["messages"];
}

export async function classifyMessageComplexity(
  message: string,
  context: MessageComplexityContext,
  signal: AbortSignal,
): Promise<MessageComplexity> {
  const result = await systemOne(
    createComplexityAssessment(message, {
      systemPrompt: context.systemPrompt,
      messages: convertToLlm(context.messages),
    }),
    { signal },
  );
  const probabilities = result.answers.model.probabilities;
  for (const tier of ["flash", "middle", "flagship"] as const) {
    const value = probabilities[tier];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`System One returned an invalid ${tier} probability`);
    }
  }
  return probabilities;
}

export function formatMessageComplexity(value: MessageComplexity): string {
  return `flash ${(value.flash * 100).toFixed(1)}% · middle ${(value.middle * 100).toFixed(1)}% · flagship ${(value.flagship * 100).toFixed(1)}%`;
}
