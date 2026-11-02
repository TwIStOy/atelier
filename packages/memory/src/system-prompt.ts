import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function generateSystemPrompt(): Promise<string> {
  const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "prompts");
  const memoryPath = join(promptsDir, "memory-prompt.md");
  const referencePath = join(promptsDir, "memory-reference.md");
  const journalPath = join(promptsDir, "journal-prompt.md");

  const parts: string[] = [];

  if (existsSync(memoryPath)) {
    const policy = readFileSync(memoryPath, "utf8").trim().replaceAll("{{MEMORY_REFERENCE_PATH}}", referencePath);
    parts.push(`<memory_instructions>\n${policy}\n</memory_instructions>`);
  } else {
    parts.push(`<memory_instructions>\nError: Memory instructions not found at ${memoryPath}\n</memory_instructions>`);
  }

  if (existsSync(journalPath)) {
    parts.push(`<journal_instructions>\n${readFileSync(journalPath, "utf8").trim()}\n</journal_instructions>`);
  } else {
    parts.push(
      `<journal_instructions>\nError: Journal instructions not found at ${journalPath}\n</journal_instructions>`,
    );
  }

  return parts.join("\n\n");
}
