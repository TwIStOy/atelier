import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { getGlobalState } from "../global-state.ts";

export const CHILD_EXTENSION_FACTORIES_STATE_KEY = "htwang-contrib-child-extension-factories";

function registry(): Map<string, ExtensionFactory> {
  return getGlobalState(CHILD_EXTENSION_FACTORIES_STATE_KEY, () => new Map<string, ExtensionFactory>());
}

export function registerChildExtensionFactory(id: string, factory: ExtensionFactory): () => void {
  const map = registry();
  map.set(id, factory);
  return () => {
    if (map.get(id) === factory) map.delete(id);
  };
}

export function getChildExtensionFactories(): ExtensionFactory[] {
  return [...registry().values()];
}
