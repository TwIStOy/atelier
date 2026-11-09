import type { ClassifierModel } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import {
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
