import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { readConfig, registerConfigItems } from "@htwang-contrib/common/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRexTitleConfig, registerRexTitleConfigItems, resolveRexTitleModel } from "../src/config.ts";

vi.mock("@htwang-contrib/common/config", () => ({
  readConfig: vi.fn(),
  registerConfigItems: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readConfig).mockReturnValue({ model: "" });
});

describe("Rex Title configuration", () => {
  it("defaults to the session model", () => {
    expect(loadRexTitleConfig()).toEqual({ model: "" });
    expect(readConfig).toHaveBeenCalledWith("rex-title", { defaults: { model: "" } });
  });

  it("offers a dedicated title model select in /config", () => {
    const registry = {
      getAvailable: () => [
        { provider: "magpie", id: "fast", name: "Fast" },
        { provider: "magpie", id: "smart", name: "Smart" },
      ],
    } as unknown as ModelRegistry;
    registerRexTitleConfigItems(registry);

    const item = vi.mocked(registerConfigItems).mock.calls[0]?.[1][0];
    expect(item).toMatchObject({ key: "model", type: "select", extensionLabel: "Rex Title" });
    if (item?.type !== "select") throw new Error("expected a select config item");
    const options = typeof item.options === "function" ? item.options() : item.options;
    expect(options).toEqual([
      { label: "(session default)", value: "" },
      { label: "magpie · Fast", value: "magpie/fast" },
      { label: "magpie · Smart", value: "magpie/smart" },
    ]);
  });

  it("includes Magpie models that become available after session_start", () => {
    let available: Array<{ provider: string; id: string; name: string }> = [];
    const registry = { getAvailable: () => available } as unknown as ModelRegistry;
    registerRexTitleConfigItems(registry);

    available = [{ provider: "magpie", id: "fast", name: "Fast" }];
    const item = vi.mocked(registerConfigItems).mock.calls[0]?.[1][0];
    if (item?.type !== "select") throw new Error("expected a select config item");
    const options = typeof item.options === "function" ? item.options() : item.options;

    expect(options).toContainEqual({ label: "magpie · Fast", value: "magpie/fast" });
  });

  it("resolves an exact configured provider/model reference", () => {
    const fast = { provider: "magpie", id: "fast", name: "Fast" };
    const smart = { provider: "magpie", id: "smart", name: "Smart" };
    const registry = { getAvailable: () => [fast, smart] } as unknown as ModelRegistry;

    expect(resolveRexTitleModel(registry, { model: "magpie/fast" })).toBe(fast);
    expect(resolveRexTitleModel(registry, { model: "missing" })).toBeUndefined();
    expect(resolveRexTitleModel(registry, { model: "" })).toBeUndefined();
  });
});
