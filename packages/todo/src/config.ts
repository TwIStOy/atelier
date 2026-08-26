import { readConfig, registerConfigItems } from "@htwang-contrib/common";

export const CONFIG_ID = "todo";

export interface GuidanceFields {
  promptSnippet?: string;
  promptGuidelines?: string[];
}

export interface TodoConfig {
  guidance?: GuidanceFields;
  reminderEnabled: boolean;
  reminderInterval: number;
}

export const DEFAULT_CONFIG = {
  reminderEnabled: true,
  reminderInterval: 4,
} satisfies Partial<TodoConfig>;

export function loadConfig(): TodoConfig {
  return readConfig<TodoConfig>(CONFIG_ID, { defaults: { ...DEFAULT_CONFIG } });
}

export function registerConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "reminderEnabled",
      type: "boolean",
      label: "Reminder Enabled",
      value: () => loadConfig().reminderEnabled,
      description:
        "Inject a transient system-reminder into the next LLM request when the todo tools have not been used for a while and the list is non-empty.",
      extensionLabel: "Todo",
      order: 0,
    },
    {
      key: "reminderInterval",
      type: "number",
      label: "Reminder Interval (turns)",
      value: () => loadConfig().reminderInterval,
      min: 1,
      max: 50,
      description: "How many turns without a todo_* tool call must pass before the reminder is injected.",
      extensionLabel: "Todo",
      order: 10,
    },
  ]);
}
