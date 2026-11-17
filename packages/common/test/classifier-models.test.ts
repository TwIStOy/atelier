import type { ClassifierModel, ClassifierResult } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import {
  boolProbability,
  boolQuestion,
  type ClassifierRegistry,
  classifierModelOptions,
  createClassifierCall,
  DEFAULT_CLASSIFIER_MODEL,
  parseClassifierRef,
  resolveClassifierModel,
} from "../src/classifier-models.ts";

const model: ClassifierModel<"typesafe-system-one"> = {
  type: "classifier",
  id: "group/classifier",
  name: "group/classifier",
  api: "typesafe-system-one",
  provider: "magpie",
  baseUrl: "http://gateway.invalid/v1",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_768,
};

function registry(overrides: Partial<ClassifierRegistry> = {}): ClassifierRegistry {
  return {
    getModelsOfType: () => [model],
    getModelOfType: (_type, provider, id) => (provider === model.provider && id === model.id ? model : undefined),
    classify: vi.fn(),
    ...overrides,
  };
}

describe("classifier model selection", () => {
  test("defaults to magpie's decision group", () => {
    expect(DEFAULT_CLASSIFIER_MODEL).toBe("magpie/group/classifier");
  });

  test.each([
    ["magpie/group/classifier", { provider: "magpie", id: "group/classifier" }],
    [" typesafe/jev-latest ", { provider: "typesafe", id: "jev-latest" }],
    ["magpie", undefined],
    ["/model", undefined],
    ["magpie/", undefined],
  ] as const)("parses %s", (ref, expected) => {
    expect(parseClassifierRef(ref)).toEqual(expected);
  });

  test("lists every registered classifier model and tolerates a missing registry", () => {
    expect(classifierModelOptions(undefined)).toEqual([]);
    expect(classifierModelOptions(registry())).toEqual([
      { label: "magpie · group/classifier", value: "magpie/group/classifier" },
    ]);
  });

  test("resolves a provider/id reference and returns no call when the model is gone", async () => {
    const source = registry();
    expect(resolveClassifierModel(source, "magpie/group/classifier")).toBe(model);
    expect(resolveClassifierModel(source, "magpie/missing")).toBeUndefined();
    expect(resolveClassifierModel(undefined, "magpie/group/classifier")).toBeUndefined();

    const signal = new AbortController().signal;
    const request = { state: { text: "hi" }, questions: {} };
    const call = createClassifierCall(source, "magpie/group/classifier");
    await call?.(request, signal);
    expect(source.classify).toHaveBeenCalledWith(model, request, { signal });
    expect(createClassifierCall(source, "magpie/missing")).toBeUndefined();
  });
});

describe("bool questions", () => {
  test("turns the first guidance line into the task and the rest into bullets", () => {
    expect(boolQuestion(["Task?", "First rule.", "Second rule."], { true: "yes", false: "no" })).toEqual({
      type: "bool",
      instructions: "Task?\n- First rule.\n- Second rule.",
      criteria: { true: "yes", false: "no" },
    });
  });

  test("reads one bool probability and reports missing or mistyped answers as NaN", () => {
    const result: ClassifierResult = {
      api: "typesafe-system-one",
      provider: "magpie",
      model: "jev-latest",
      answers: { ok: { type: "bool", probability: 0.25 } },
      stopReason: "stop",
      timestamp: 1,
    };
    expect(boolProbability(result, "ok")).toBe(0.25);
    expect(boolProbability(result, "missing")).toBeNaN();
  });
});
