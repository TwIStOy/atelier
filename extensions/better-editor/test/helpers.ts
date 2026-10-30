import type { KeybindingsManager as AppKeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type KeybindingsConfig, KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";

export function createKeybindings(bindings: KeybindingsConfig = {}): AppKeybindingsManager {
  return new KeybindingsManager(
    {
      ...TUI_KEYBINDINGS,
      "app.interrupt": { defaultKeys: "escape" },
      "app.session.rename": { defaultKeys: "ctrl+r" },
    },
    bindings,
  ) as AppKeybindingsManager;
}
