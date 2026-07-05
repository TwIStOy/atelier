export interface StrategyConfig {
  enabled: boolean;
  notifyOnStrategy: boolean;
}

export const CONFIG_ID = "tool-call-fixer";

export const DEFAULT_CONFIG: StrategyConfig = {
  enabled: true,
  notifyOnStrategy: false,
};

export interface StrategyResult {
  applied: boolean;
  note?: string;
}

export interface Strategy {
  id: string;
  description: string;
  apply(toolName: string, input: Record<string, unknown>): StrategyResult;
}

export interface StrategyOutcome {
  applied: boolean;
  notes: string[];
}

export function applyStrategies(
  toolName: string,
  input: Record<string, unknown>,
  config: StrategyConfig,
  strategies: readonly Strategy[],
): StrategyOutcome {
  if (!config.enabled) {
    return { applied: false, notes: [] };
  }
  const notes: string[] = [];
  for (const strategy of strategies) {
    const result = strategy.apply(toolName, input);
    if (result.applied) {
      notes.push(`${strategy.id}: ${result.note ?? strategy.description}`);
    }
  }
  return { applied: notes.length > 0, notes };
}
