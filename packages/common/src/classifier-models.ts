import type { ClassifierApi, ClassifierContext, ClassifierModel, ClassifierResult } from "@earendil-works/pi-ai";
import type { ConfigItemSelectOption } from "./config/index.ts";

export const DEFAULT_CLASSIFIER_MODEL = "magpie/group/classifier";

/** The classifier-facing slice of Pi's ModelRegistry. */
export interface ClassifierRegistry {
  getModelsOfType(type: "classifier"): readonly ClassifierModel<ClassifierApi>[];
  getModelOfType(type: "classifier", provider: string, id: string): ClassifierModel<ClassifierApi> | undefined;
  classify(
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options?: { signal?: AbortSignal },
  ): Promise<ClassifierResult>;
}

/** A bound classifier call: picks the configured model and follows the caller's signal. */
export type ClassifierCall = (request: ClassifierContext, signal: AbortSignal) => Promise<ClassifierResult>;

export function parseClassifierRef(ref: string): { provider: string; id: string } | undefined {
  const trimmed = ref.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator >= trimmed.length - 1) return undefined;
  return { provider: trimmed.slice(0, separator), id: trimmed.slice(separator + 1) };
}

export function classifierModelOptions(source: ClassifierRegistry | undefined): ConfigItemSelectOption<string>[] {
  if (!source) return [];
  return [...source.getModelsOfType("classifier")].map((model) => ({
    label: `${model.provider} · ${model.name || model.id}`,
    value: `${model.provider}/${model.id}`,
  }));
}

export function resolveClassifierModel(
  source: ClassifierRegistry | undefined,
  ref: string,
): ClassifierModel<ClassifierApi> | undefined {
  const parsed = parseClassifierRef(ref);
  return parsed ? source?.getModelOfType("classifier", parsed.provider, parsed.id) : undefined;
}

export function createClassifierCall(source: ClassifierRegistry | undefined, ref: string): ClassifierCall | undefined {
  const model = resolveClassifierModel(source, ref);
  if (!model || !source) return undefined;
  return (request, signal) => source.classify(model, request, { signal });
}
