import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { updateConfig } from "@htwang-contrib/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CONFIG_ID, CONFIG_SCHEMA } from "../../src/hide-models/config.ts";
import {
  installPatch,
  isSuppressed,
  listAllModels,
  listAvailableModels,
  setSuppress,
} from "../../src/hide-models/model-patch.ts";

const ORIGINALS = Symbol.for("experience.modelRuntime.originals");

const MODELS: Model<Api>[] = [
  { provider: "toori", id: "glm-5.3", name: "glm-5.3" },
  { provider: "toori", id: "kimi-k3", name: "kimi-k3" },
  { provider: "openrouter", id: "some-model", name: "some-model" },
] as unknown as Model<Api>[];

let configDir: string;

function writeRules(enabled: boolean): void {
  updateConfig(CONFIG_ID, CONFIG_SCHEMA, { enabled, hiddenRules: ["toori/kimi-k3"] });
}

beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), "hide-models-test-"));
  process.env.XDG_CONFIG_HOME = configDir;
});

afterAll(() => {
  rmSync(configDir, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
});

describe("ModelRuntime surface", () => {
  it("still exposes the methods the patch wraps", () => {
    expect(typeof ModelRuntime.prototype.getAvailableSnapshot).toBe("function");
    expect(typeof ModelRuntime.prototype.getAvailable).toBe("function");
  });
});

describe("patched ModelRuntime", () => {
  beforeAll(() => {
    const proto = ModelRuntime.prototype as unknown as Record<string, unknown>;
    proto.getAvailable = async () => MODELS;
    installPatch();
    const stored = (ModelRuntime.prototype as unknown as Record<symbol, unknown>)[ORIGINALS];
    expect(stored).toBeDefined();
    installPatch();
    expect((ModelRuntime.prototype as unknown as Record<symbol, unknown>)[ORIGINALS]).toBe(stored);
    writeRules(true);
  });

  afterEach(() => {
    setSuppress(false);
  });

  function fakeRuntime(): ModelRuntime {
    const runtime = Object.create(ModelRuntime.prototype) as ModelRuntime & { snapshot: { available: Model<Api>[] } };
    runtime.snapshot = { available: [...MODELS] };
    return runtime;
  }

  function facade(runtime: ModelRuntime): ModelRegistry {
    return { getAll: () => MODELS, runtime } as unknown as ModelRegistry;
  }

  it("filters getAvailableSnapshot by the persisted rules", () => {
    const visible = fakeRuntime().getAvailableSnapshot();
    expect(visible.map((m) => `${m.provider}/${m.id}`)).toEqual(["toori/glm-5.3", "openrouter/some-model"]);
  });

  it("filters getAvailable results by the persisted rules", async () => {
    const visible = await fakeRuntime().getAvailable();
    expect(visible.map((m) => `${m.provider}/${m.id}`)).toEqual(["toori/glm-5.3", "openrouter/some-model"]);
  });

  it("passes models through when the master toggle is off", () => {
    writeRules(false);
    expect(fakeRuntime().getAvailableSnapshot()).toHaveLength(MODELS.length);
    writeRules(true);
  });

  it("passes models through while suppressed and re-filters after clearing suppress", () => {
    setSuppress(true);
    expect(isSuppressed()).toBe(true);
    expect(fakeRuntime().getAvailableSnapshot()).toHaveLength(MODELS.length);
    setSuppress(false);
    expect(fakeRuntime().getAvailableSnapshot()).toHaveLength(MODELS.length - 1);
  });

  it("list helpers stay unfiltered so hidden models can be re-selected", () => {
    const registry = facade(fakeRuntime());
    expect(listAvailableModels(registry)).toHaveLength(MODELS.length);
    expect(listAllModels(registry)).toHaveLength(MODELS.length);
  });
});
