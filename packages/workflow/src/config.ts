import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";

export interface WorkflowConfig {
  maxConcurrency: number;
  maxAgents: number;
}

const CONFIG_ID = "workflow";

const CONFIG_SCHEMA: ExtensionConfigSchema<WorkflowConfig> = {
  defaults: {
    maxConcurrency: 4,
    maxAgents: 32,
  },
};

export function loadWorkflowConfig(): WorkflowConfig {
  const raw = readConfig(CONFIG_ID, CONFIG_SCHEMA);
  return {
    maxConcurrency: Math.max(1, Math.min(16, Number(raw.maxConcurrency))),
    maxAgents: Math.max(1, Math.min(128, Number(raw.maxAgents))),
  };
}

export function registerWorkflowConfigItems(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "maxConcurrency",
      type: "number",
      label: "Workflow Max Concurrency",
      value: CONFIG_SCHEMA.defaults.maxConcurrency,
      min: 1,
      max: 16,
      description: "Maximum number of child agents running at the same time inside one workflow.",
    },
    {
      key: "maxAgents",
      type: "number",
      label: "Workflow Max Agents",
      value: CONFIG_SCHEMA.defaults.maxAgents,
      min: 1,
      max: 128,
      description: "Hard cap on total agent() calls a single workflow script may make.",
    },
  ]);
}
