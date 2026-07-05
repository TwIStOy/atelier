import type { Strategy } from "../strategy.ts";
import { paramNameRepair } from "./param-name-repair.ts";

export const STRATEGIES: readonly Strategy[] = [paramNameRepair];
