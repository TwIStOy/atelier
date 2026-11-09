import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import type { ClassifierCall } from "@htwang-contrib/common/classifier-models";
import { describe, expect, test } from "vitest";
import { assessBashCommand, bashAssessmentRequest } from "../src/bash-assessment.ts";

function boolResult(values: { destructive: number; exfiltration: number }): ClassifierResult {
  return {
    api: "typesafe-system-one",
    provider: "magpie",
    model: "jev-latest",
    answers: {
      destructive: { type: "bool", probability: values.destructive },
      exfiltration: { type: "bool", probability: values.exfiltration },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

describe("Bash assessment", () => {
  test("asks two independent bool questions over the actual command and working directory", async () => {
    const requests: ClassifierContext[] = [];
    const classify: ClassifierCall = async (request) => {
      requests.push(request);
      return boolResult({ destructive: 0.9, exfiltration: 0.8 });
    };
    const signal = new AbortController().signal;
    expect(await assessBashCommand("test command", "/project", signal, classify)).toEqual({
      destructive: 0.9,
      exfiltration: 0.8,
    });
    expect(requests).toEqual([bashAssessmentRequest("test command", "/project")]);
    const questions = requests[0]?.questions;
    for (const question of Object.values(questions ?? {})) {
      expect(question).toMatchObject({ type: "bool", instructions: expect.any(String) });
    }
    expect(questions?.destructive).toMatchObject({
      criteria: { true: expect.any(String), false: expect.any(String) },
    });
  });

  test.each([-0.1, 1.1, Number.NaN, undefined])("rejects invalid scores (%s)", async (value) => {
    const classify: ClassifierCall = async () =>
      boolResult({ destructive: value as number, exfiltration: 0.1 }) as ClassifierResult;
    await expect(assessBashCommand("test", "/project", new AbortController().signal, classify)).rejects.toThrow(
      "invalid",
    );
  });

  test("rejects a failed classifier result", async () => {
    const classify: ClassifierCall = async () =>
      ({
        ...boolResult({ destructive: 0, exfiltration: 0 }),
        stopReason: "error",
        errorMessage: "gateway down",
      }) as ClassifierResult;
    await expect(assessBashCommand("test", "/project", new AbortController().signal, classify)).rejects.toThrow(
      "gateway down",
    );
  });
});
