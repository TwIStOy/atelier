import type { Message } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { type ComplexityTier, createComplexityAssessment, isComplexityTier } from "@htwang-contrib/common";
import { resolvePhysicalModel, splitModelReference } from "./config.ts";

export async function judgeComplexity(
  registry: ModelRegistry,
  reference: string,
  messages: readonly Message[],
  signal: AbortSignal,
): Promise<ComplexityTier> {
  signal.throwIfAborted();
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const prompt =
    typeof latestUser?.content === "string"
      ? latestUser.content
      : (latestUser?.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("") ?? "Continue the current task.");
  const assessment = createComplexityAssessment(prompt, { messages: [...messages] });
  const question = assessment.questions.model;
  const instructions = JSON.stringify(question.instructions);
  const classifier = registry.findOfType("classifier", ...splitModelReference(reference));
  if (classifier) {
    const result = await registry.classify(
      classifier,
      {
        state: assessment.state,
        questions: { model: { type: "choice", instructions, criteria: question.criteria } },
      },
      { signal, maxRetries: 0 },
    );
    signal.throwIfAborted();
    if (result.stopReason !== "stop") {
      throw new Error(`Virtual Model judge failed: ${result.errorMessage ?? result.stopReason}`);
    }
    const answer = result.answers.model;
    if (answer?.type !== "choice" || !isComplexityTier(answer.choice)) {
      throw new Error("Virtual Model judge returned an invalid tier; expected flash, middle, or flagship.");
    }
    return answer.choice;
  }

  const model = resolvePhysicalModel(registry, reference);
  const response = await registry
    .streamSimple(
      model,
      {
        systemPrompt: `${instructions}\nTier definitions: ${JSON.stringify(question.criteria)}\nReturn exactly one word: flash, middle, or flagship. Do not include reasoning or execute the task.`,
        messages: [{ role: "user", content: JSON.stringify(assessment.state), timestamp: Date.now() }],
      },
      { signal, maxTokens: 128, maxRetries: 0 },
    )
    .result();
  signal.throwIfAborted();
  if (response.stopReason !== "stop") {
    throw new Error(`Virtual Model judge failed: ${response.errorMessage ?? response.stopReason}`);
  }
  const answer = response.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
  if (!isComplexityTier(answer)) {
    throw new Error("Virtual Model judge returned an invalid tier; expected flash, middle, or flagship.");
  }
  return answer;
}
