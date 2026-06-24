import { readConfig } from "@htwang-contrib/common";

export interface GuidanceFields {
  promptSnippet?: string;
  promptGuidelines?: string[];
}

export interface TodoConfig {
  guidance?: GuidanceFields;
}

export function loadConfig(): TodoConfig {
  return readConfig<TodoConfig>("todo", { defaults: {} });
}
