import { keyText as importedKeyText, type KeybindingHints } from "@earendil-works/pi-coding-agent";

type KeyText = KeybindingHints["keyText"];

// Host keyText captured from the pi-owned tool render context. A module import
// can resolve to the extension's own pi-coding-agent copy, whose keybinding
// store never sees the user's configuration and formats `app.*` ids as "".
let hostKeyText: KeyText | undefined;

export function useHostKeyText(fn: KeyText | undefined): void {
  hostKeyText = fn;
}

export function keyText(keybinding: Parameters<KeyText>[0]): string {
  return (hostKeyText ?? importedKeyText)(keybinding);
}
