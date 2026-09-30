import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  type AgentPersonaCatalog,
  type ConfigItem,
  loadSubagentModelConfig,
  personaDefaultsForType,
  readPersonaDefaultsByType,
  registerConfigItems,
  SUBAGENT_MODEL_TIERS,
} from "@htwang-contrib/common";

export function registerSubagentModelConfig(catalog: AgentPersonaCatalog, modelRegistry: ModelRegistry): void {
  const items: ConfigItem[] = SUBAGENT_MODEL_TIERS.map((tier, index) => ({
    key: `modelTiers.${tier}`,
    type: "select",
    label: `${tier} Model`,
    value: () => loadSubagentModelConfig().modelTiers[tier] ?? "",
    options: () => [
      { label: "Current session", value: "" },
      ...modelRegistry.getAvailable().map((model) => ({
        label: `${model.provider}/${model.id}`,
        value: `${model.provider}/${model.id}`,
      })),
    ],
    description: `Model used by the ${tier} tier. Select Current session to use the parent session model.`,
    extensionLabel: "Subagents",
    order: index + 1,
  }));
  for (const [id, entry] of [...catalog.agents].sort(([a], [b]) => a.localeCompare(b))) {
    const value = () =>
      loadSubagentModelConfig().agentModels[id] ??
      entry.fileOptions.model ??
      personaDefaultsForType(readPersonaDefaultsByType(), id).model ??
      "";
    items.push({
      key: `agentModels.${id}`,
      type: "select",
      label: `${id} Model`,
      value,
      options: () => {
        const current = value();
        const options = [
          { label: "Current session", value: "" },
          ...SUBAGENT_MODEL_TIERS.map((tier) => ({ label: tier, value: tier })),
        ];
        if (current && !options.some((option) => option.value === current)) {
          options.push({ label: current, value: current });
        }
        return options;
      },
      description: "Default model tier for this persona. An explicit model in the tool call takes precedence.",
      extensionLabel: "Subagents",
      order: items.length + 1,
    });
  }
  registerConfigItems("subagents", items);
}
