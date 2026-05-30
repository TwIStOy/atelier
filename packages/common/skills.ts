import { getAgentDir, loadSkills } from "@earendil-works/pi-coding-agent";

export interface GetAvailableSkillNamesOptions {
  cwd?: string;
  agentDir?: string;
  skillPaths?: string[];
}

export function getAvailableSkillNames(
  options: GetAvailableSkillNamesOptions = {},
): string[] {
  const { skills } = loadSkills({
    cwd: options.cwd ?? process.cwd(),
    agentDir: options.agentDir ?? getAgentDir(),
    skillPaths: options.skillPaths ?? [],
    includeDefaults: true,
  });
  return skills.map((s) => s.name);
}
