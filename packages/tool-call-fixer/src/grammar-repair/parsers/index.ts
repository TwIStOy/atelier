import type { GrammarParser } from "../types.ts";
import { parseGlm } from "./glm.ts";
import { parseKimi } from "./kimi.ts";
import { parseQwen } from "./qwen.ts";

export const GRAMMAR_PARSERS: readonly GrammarParser[] = [parseGlm, parseKimi, parseQwen];
