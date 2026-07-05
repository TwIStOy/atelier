import type { Strategy } from "../strategy.ts";
import { paramNameRepair } from "./param-name-repair.ts";
import { shapeRepair } from "./shape-repair.ts";

export const STRATEGIES: readonly Strategy[] = [paramNameRepair, shapeRepair];
