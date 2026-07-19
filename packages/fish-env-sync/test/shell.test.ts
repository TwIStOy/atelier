import { describe, expect, it } from "vitest";
import { detectFishShell, isFishBinary, resolveFishVarsPath } from "../src/shell.ts";

describe("isFishBinary", () => {
  it("matches a bare fish basename", () => {
    expect(isFishBinary("fish")).toBe(true);
  });

  it("matches a full path ending in fish (version stays in the dir, not the basename)", () => {
    expect(isFishBinary("/usr/bin/fish")).toBe(true);
    expect(isFishBinary("/nix/store/abc-fish-4.2.1/bin/fish")).toBe(true);
  });

  it("does NOT match a basename that only has fish as a prefix", () => {
    expect(isFishBinary("/usr/local/bin/fish-4.2.1")).toBe(false);
    expect(isFishBinary("/usr/local/bin/fishshell")).toBe(false);
  });

  it("rejects non-fish shells", () => {
    expect(isFishBinary("/bin/bash")).toBe(false);
    expect(isFishBinary("/bin/zsh")).toBe(false);
    expect(isFishBinary("sh")).toBe(false);
  });

  it("rejects empty/whitespace", () => {
    expect(isFishBinary("")).toBe(false);
    expect(isFishBinary("   ")).toBe(false);
  });

  it("does not match a path that merely contains fish in a directory", () => {
    expect(isFishBinary("/opt/fishery/bin/bash")).toBe(false);
  });
});

describe("detectFishShell", () => {
  it("returns true when $SHELL is fish", () => {
    expect(detectFishShell({ envShell: "/usr/bin/fish" })).toBe(true);
  });

  it("returns true when passwd shell is fish but $SHELL is not", () => {
    expect(detectFishShell({ envShell: "/bin/bash", passwdShell: "/usr/bin/fish" })).toBe(true);
  });

  it("returns false when neither is fish", () => {
    expect(detectFishShell({ envShell: "/bin/bash", passwdShell: "/bin/zsh" })).toBe(false);
  });

  it("returns false when both are undefined", () => {
    expect(detectFishShell({})).toBe(false);
  });

  it("returns false when both are empty", () => {
    expect(detectFishShell({ envShell: "", passwdShell: "" })).toBe(false);
  });
});

describe("resolveFishVarsPath", () => {
  it("uses $XDG_CONFIG_HOME when set", () => {
    const p = resolveFishVarsPath({ XDG_CONFIG_HOME: "/custom/xdg" });
    expect(p).toBe("/custom/xdg/fish/fish_variables");
  });

  it("trims and ignores empty XDG_CONFIG_HOME, falls back to HOME", () => {
    const p = resolveFishVarsPath({ XDG_CONFIG_HOME: "   ", HOME: "/home/user" });
    expect(p).toBe("/home/user/.config/fish/fish_variables");
  });

  it("falls back to $HOME/.config when XDG_CONFIG_HOME unset", () => {
    const p = resolveFishVarsPath({ HOME: "/home/user" });
    expect(p).toBe("/home/user/.config/fish/fish_variables");
  });

  it("falls back to os.homedir() when neither XDG nor HOME set", () => {
    const p = resolveFishVarsPath({}, "/root");
    expect(p).toBe("/root/.config/fish/fish_variables");
  });

  it("ignores empty HOME, uses homedir fallback", () => {
    const p = resolveFishVarsPath({ HOME: "" }, "/root");
    expect(p).toBe("/root/.config/fish/fish_variables");
  });
});
