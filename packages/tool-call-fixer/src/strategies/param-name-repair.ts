import type { Strategy } from "../strategy.ts";

export type ParamNameAliasTable = Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;

const FILE_PATH_ALIASES: readonly string[] = [
  "file_path",
  "filePath",
  "filepath",
  "absolutePath",
  "absolute_path",
  "fileAbsolutePath",
  "target_file",
  "targetFile",
  "pathname",
  "file",
];

const DIRECTORY_PATH_ALIASES: readonly string[] = ["directory", "dir", "folder", "directoryPath", "absolutePath"];

export const PARAM_NAME_ALIASES: ParamNameAliasTable = {
  read: { path: FILE_PATH_ALIASES },
  edit: { path: FILE_PATH_ALIASES },
  write: {
    path: FILE_PATH_ALIASES,
    content: ["contents", "text", "body", "data", "fileContent"],
  },
  bash: { command: ["cmd", "shell", "script", "command_line", "commandLine"] },
  grep: {
    pattern: ["query", "regex", "search", "q", "expression", "text"],
    include: ["glob"],
    path: FILE_PATH_ALIASES,
  },
  glob: {
    pattern: ["query", "search", "expression"],
    path: DIRECTORY_PATH_ALIASES,
  },
  ls: { path: DIRECTORY_PATH_ALIASES },
};

export const paramNameRepair: Strategy = {
  id: "param-name-repair",
  description: "Renames mistyped or aliased parameter names to the schema-correct name.",
  apply: (toolName, input) => {
    const aliases = PARAM_NAME_ALIASES[toolName];
    if (!aliases) {
      return { applied: false };
    }
    const renamed: string[] = [];
    for (const [correct, wrongs] of Object.entries(aliases)) {
      if (correct in input) {
        continue;
      }
      for (const wrong of wrongs) {
        if (!(wrong in input)) {
          continue;
        }
        input[correct] = input[wrong];
        delete input[wrong];
        renamed.push(`${wrong}->${correct}`);
        break;
      }
    }
    if (renamed.length === 0) {
      return { applied: false };
    }
    return { applied: true, note: `renamed ${renamed.join(", ")}` };
  },
};
