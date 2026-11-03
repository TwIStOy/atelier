import { type Change, diffLines } from "diff";

export type ParsedPatch =
  | { type: "add"; filePath: string; content: string }
  | { type: "delete"; filePath: string }
  | { type: "update"; filePath: string; movePath?: string; chunks: PatchChunk[] };

export type PatchChunk = {
  changeContexts: string[];
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
};

export class PatchParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchParseError";
  }
}

export class PatchApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchApplicationError";
  }
}

export const APPLY_PATCH_LARK_GRAMMAR = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;

export function normalizePatchText(patchText: string): string {
  return patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function stripHeredoc(input: string): string {
  const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/);
  if (heredocMatch) {
    return heredocMatch[2] ?? input;
  }
  return input;
}

export function extractPatchedPaths(patchText: string): string[] {
  const normalized = stripHeredoc(normalizePatchText(patchText));
  const matches = normalized.matchAll(/^\*\*\* (?:(?:Add|Delete|Update) File|Move to): (.+)$/gm);
  return Array.from(matches, (match) => match[1] ?? "");
}

function normalizeSeekLine(line: string): string {
  return line
    .trim()
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

type SeekMatch = { index: number; fuzz: 0 | 1 | 100 | 10000 };
type SeekPrepare = (line: string) => string;

function rangeMatches(lines: string[], pattern: string[], index: number): boolean {
  for (let patternIndex = 0; patternIndex < pattern.length; patternIndex++) {
    if (lines[index + patternIndex] !== pattern[patternIndex]) {
      return false;
    }
  }
  return true;
}

function seekRange(
  lines: string[],
  pattern: string[],
  searchStart: number,
  lastStart: number,
  fuzz: SeekMatch["fuzz"],
): SeekMatch | undefined {
  for (let index = searchStart; index <= lastStart; index++) {
    if (rangeMatches(lines, pattern, index)) {
      return { index, fuzz };
    }
  }
  return undefined;
}

function seekFuzzyRange(
  lines: string[],
  pattern: string[],
  searchStart: number,
  lastStart: number,
): SeekMatch | undefined {
  const phases: Array<{ prepare: SeekPrepare; fuzz: 1 | 100 | 10000 }> = [
    { prepare: (line) => line.trimEnd(), fuzz: 1 },
    { prepare: (line) => line.trim(), fuzz: 100 },
    { prepare: normalizeSeekLine, fuzz: 10000 },
  ];
  for (const phase of phases) {
    const match = seekRange(lines.map(phase.prepare), pattern.map(phase.prepare), searchStart, lastStart, phase.fuzz);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function seekSearchStart(lines: string[], pattern: string[], start: number, eof: boolean): number {
  if (eof && lines.length >= pattern.length) {
    return lines.length - pattern.length;
  }
  return start;
}

function seekSequence(
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
): { index: number; fuzz: 0 | 1 | 100 | 10000 } | undefined {
  if (pattern.length === 0) {
    return { index: start, fuzz: 0 };
  }
  if (pattern.length > lines.length) {
    return undefined;
  }

  const searchStart = seekSearchStart(lines, pattern, start, eof);
  const lastStart = lines.length - pattern.length;
  const exact = seekRange(lines, pattern, searchStart, lastStart, 0);
  if (exact) {
    return exact;
  }
  return seekFuzzyRange(lines, pattern, searchStart, lastStart);
}

const ADD_FILE_HEADER = "*** Add File: ";
const DELETE_FILE_HEADER = "*** Delete File: ";
const UPDATE_FILE_HEADER = "*** Update File: ";
const MOVE_TO_HEADER = "*** Move to: ";
const END_OF_FILE_MARKER = "*** End of File";

function lineAt(lines: string[], index: number): string {
  return lines[index] ?? "";
}

function isBoundaryLine(line: string | undefined, marker: string): boolean {
  return line?.trim() === marker;
}

function patchEnvelope(lines: string[]): { beginIndex: number; endIndex: number } {
  const beginIndex = isBoundaryLine(lines[0], "*** Begin Patch") ? 0 : -1;
  const endIndex = isBoundaryLine(lines[lines.length - 1], "*** End Patch") ? lines.length - 1 : -1;
  return { beginIndex, endIndex };
}

function assertValidEnvelope(envelope: { beginIndex: number; endIndex: number }): void {
  if (envelope.beginIndex === -1 || envelope.endIndex === -1 || envelope.endIndex < envelope.beginIndex) {
    throw new PatchParseError("Invalid patch format: expected *** Begin Patch ... *** End Patch envelope");
  }
}

export function parsePatch(patchText: string): ParsedPatch[] {
  const normalized = stripHeredoc(normalizePatchText(patchText).trim()).trim();
  const lines = normalized.split("\n");
  const envelope = patchEnvelope(lines);
  assertValidEnvelope(envelope);
  return parseHunks(lines, envelope.beginIndex + 1, envelope.endIndex);
}

function parseHunks(lines: string[], index: number, endIndex: number): ParsedPatch[] {
  const hunks: ParsedPatch[] = [];
  while (index < endIndex) {
    const line = lineAt(lines, index);
    if (!line.startsWith("*** ")) {
      index++;
      continue;
    }
    const parsed = parseHunkHeader(lines, index, endIndex);
    hunks.push(parsed.hunk);
    index = parsed.index;
  }
  return hunks;
}

function parseHunkHeader(lines: string[], index: number, endIndex: number): { hunk: ParsedPatch; index: number } {
  const line = lineAt(lines, index);
  if (line.startsWith(ADD_FILE_HEADER)) {
    return parseAddHunk(lines, index, endIndex);
  }
  if (line.startsWith(DELETE_FILE_HEADER)) {
    return { hunk: { type: "delete", filePath: line.slice(DELETE_FILE_HEADER.length) }, index: index + 1 };
  }
  if (line.startsWith(UPDATE_FILE_HEADER)) {
    return parseUpdateHunk(lines, index, endIndex);
  }
  throw new PatchParseError(
    `'${line}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
  );
}

function parseAddHunk(lines: string[], index: number, endIndex: number): { hunk: ParsedPatch; index: number } {
  const filePath = lineAt(lines, index).slice(ADD_FILE_HEADER.length);
  const collected = collectAddContentLines(lines, index + 1, endIndex);
  const content = collected.contentLines.length === 0 ? "" : `${collected.contentLines.join("\n")}\n`;
  return { hunk: { type: "add", filePath, content }, index: collected.index };
}

function collectAddContentLines(
  lines: string[],
  index: number,
  endIndex: number,
): { contentLines: string[]; index: number } {
  const contentLines: string[] = [];
  while (index < endIndex) {
    const nextLine = lineAt(lines, index);
    if (nextLine.startsWith("*** ")) {
      break;
    }
    if (!nextLine.startsWith("+")) {
      throw new PatchParseError(`Invalid patch format: Add File lines must start with '+'`);
    }
    contentLines.push(nextLine.slice(1));
    index++;
  }
  return { contentLines, index };
}

function parseUpdateHunk(lines: string[], index: number, endIndex: number): { hunk: ParsedPatch; index: number } {
  const filePath = lineAt(lines, index).slice(UPDATE_FILE_HEADER.length);
  const moved = takeMovePath(lines, index + 1);
  const collected = collectUpdateChunks(lines, moved.index, endIndex);
  return { hunk: buildUpdateHunk(filePath, moved.movePath, collected.chunks), index: collected.index };
}

function takeMovePath(lines: string[], index: number): { movePath: string | undefined; index: number } {
  const line = lineAt(lines, index);
  if (line.startsWith(MOVE_TO_HEADER)) {
    return { movePath: line.slice(MOVE_TO_HEADER.length), index: index + 1 };
  }
  return { movePath: undefined, index };
}

function collectUpdateChunks(
  lines: string[],
  index: number,
  endIndex: number,
): { chunks: PatchChunk[]; index: number } {
  const chunks: PatchChunk[] = [];
  while (index < endIndex) {
    const nextLine = lineAt(lines, index);
    if (nextLine.trim() === "") {
      index++;
      continue;
    }
    if (nextLine.startsWith("*** ")) {
      break;
    }
    const parsed = parseUpdateChunk(lines, index, endIndex, chunks.length === 0);
    chunks.push(parsed.chunk);
    index = parsed.index;
  }
  return { chunks, index };
}

function buildUpdateHunk(filePath: string, movePath: string | undefined, chunks: PatchChunk[]): ParsedPatch {
  if (chunks.length === 0 && !movePath) {
    throw new PatchParseError(`Update file hunk for path '${filePath}' is empty`);
  }
  return movePath !== undefined ? { type: "update", filePath, movePath, chunks } : { type: "update", filePath, chunks };
}

function parseUpdateChunk(
  lines: string[],
  index: number,
  endIndex: number,
  allowMissingContext: boolean,
): { chunk: PatchChunk; index: number } {
  const contexts = parseChangeContexts(lines, index, endIndex, allowMissingContext);
  const parsed = parseChunkLines(lines, contexts.index, endIndex);
  return {
    chunk: {
      changeContexts: contexts.changeContexts,
      oldLines: parsed.oldLines,
      newLines: parsed.newLines,
      isEndOfFile: parsed.isEndOfFile,
    },
    index: parsed.index,
  };
}

function parseChangeContexts(
  lines: string[],
  index: number,
  endIndex: number,
  allowMissingContext: boolean,
): { changeContexts: string[]; index: number } {
  const nextLine = lineAt(lines, index);
  if (nextLine.startsWith("@@")) {
    return collectChangeContexts(lines, index, endIndex);
  }
  if (allowMissingContext) {
    return { changeContexts: [], index };
  }
  throw new PatchParseError(`Expected update hunk to start with a @@ context marker, got: '${nextLine}'`);
}

function collectChangeContexts(
  lines: string[],
  index: number,
  endIndex: number,
): { changeContexts: string[]; index: number } {
  const changeContexts: string[] = [];
  while (index < endIndex) {
    const contextLine = lineAt(lines, index);
    if (contextLine === "@@") {
      index++;
      continue;
    }
    if (contextLine.startsWith("@@ ")) {
      changeContexts.push(contextLine.slice("@@ ".length));
      index++;
      continue;
    }
    break;
  }
  return { changeContexts, index };
}

function parseChunkLines(
  lines: string[],
  index: number,
  endIndex: number,
): { oldLines: string[]; newLines: string[]; isEndOfFile: boolean; index: number } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const parsed = readChunkLines(lines, index, endIndex, oldLines, newLines);
  assertHasChunkLines(parsed.parsedLines);
  return { oldLines, newLines, isEndOfFile: parsed.isEndOfFile, index: parsed.index };
}

function assertHasChunkLines(parsedLines: number): void {
  if (parsedLines === 0) {
    throw new PatchParseError("Update hunk does not contain any lines");
  }
}

function readChunkLines(
  lines: string[],
  index: number,
  endIndex: number,
  oldLines: string[],
  newLines: string[],
): { parsedLines: number; isEndOfFile: boolean; index: number } {
  let parsedLines = 0;
  let isEndOfFile = false;
  while (index < endIndex) {
    const step = stepChunkLine(lineAt(lines, index), parsedLines === 0, oldLines, newLines);
    if (step === "end-of-file") {
      assertHasChunkLines(parsedLines);
      isEndOfFile = true;
      index++;
      break;
    }
    if (step === "stop") {
      break;
    }
    parsedLines++;
    index++;
  }
  return { parsedLines, isEndOfFile, index };
}

type ChunkLineStep = "line" | "stop" | "end-of-file";

function stepChunkLine(hunkLine: string, isFirstLine: boolean, oldLines: string[], newLines: string[]): ChunkLineStep {
  if (hunkLine === END_OF_FILE_MARKER) {
    return "end-of-file";
  }
  if (stopsChunkLine(hunkLine)) {
    return "stop";
  }
  return appendHunkLine(hunkLine, isFirstLine, oldLines, newLines) ? "line" : "stop";
}

function stopsChunkLine(hunkLine: string): boolean {
  return hunkLine.startsWith("@@") || hunkLine.startsWith("*** ");
}

function appendHunkLine(hunkLine: string, isFirstLine: boolean, oldLines: string[], newLines: string[]): boolean {
  if (isLinePrefix(hunkLine[0])) {
    appendPrefixedLine(hunkLine, oldLines, newLines);
    return true;
  }
  if (isFirstLine) {
    throw new PatchParseError(
      `Unexpected line found in update hunk: '${hunkLine}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
    );
  }
  return false;
}

function isLinePrefix(prefix: string | undefined): boolean {
  return prefix === undefined || prefix === " " || prefix === "-" || prefix === "+";
}

function appendPrefixedLine(hunkLine: string, oldLines: string[], newLines: string[]): void {
  const prefix = hunkLine[0];
  const value = hunkLine.slice(1);
  if (prefix === " ") {
    oldLines.push(value);
    newLines.push(value);
  } else if (prefix === "-") {
    oldLines.push(value);
  } else if (prefix === "+") {
    newLines.push(value);
  } else {
    oldLines.push("");
    newLines.push("");
  }
}

export function parseNonEmptyPatch(patchText: string): ParsedPatch[] {
  const hunks = parsePatch(patchText);
  if (hunks.length > 0) {
    return hunks;
  }

  const normalized = normalizePatchText(patchText).trim();
  if (normalized === "*** Begin Patch\n*** End Patch") {
    throw new PatchParseError("patch rejected: empty patch");
  }
  throw new PatchParseError("apply_patch verification failed: no hunks found");
}

function splitFileLines(content: string): string[] {
  const lines = normalizePatchText(content).split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

type LineReplacement = { start: number; oldLength: number; newLines: string[] };
type ChunkMatch = { start: number; oldLength: number; newLines: string[]; fuzz: number; nextIndex: number };

export function replaceChunks(
  content: string,
  filePath: string,
  chunks: PatchChunk[],
): { content: string; fuzz: number } {
  const originalLines = splitFileLines(content);
  const applied = collectReplacements(originalLines, filePath, chunks);
  return { content: spliceReplacements(originalLines, applied.replacements), fuzz: applied.fuzz };
}

function collectReplacements(
  originalLines: string[],
  filePath: string,
  chunks: PatchChunk[],
): { replacements: LineReplacement[]; fuzz: number } {
  const replacements: LineReplacement[] = [];
  let lineIndex = 0;
  let fuzz = 0;
  for (const chunk of chunks) {
    const contexts = resolveChangeContexts(originalLines, filePath, chunk.changeContexts, lineIndex);
    lineIndex = contexts.lineIndex;
    fuzz += contexts.fuzz;
    const match = locateChunk(originalLines, filePath, chunk, lineIndex);
    lineIndex = match.nextIndex;
    fuzz += match.fuzz;
    replacements.push({ start: match.start, oldLength: match.oldLength, newLines: match.newLines });
  }
  return { replacements, fuzz };
}

function resolveChangeContexts(
  originalLines: string[],
  filePath: string,
  changeContexts: string[],
  startIndex: number,
): { lineIndex: number; fuzz: number } {
  let lineIndex = startIndex;
  let fuzz = 0;
  for (const changeContext of changeContexts) {
    const contextMatch = seekSequence(originalLines, [changeContext], lineIndex, false);
    if (contextMatch === undefined) {
      throw new PatchApplicationError(`Failed to find context '${changeContext}' in ${filePath}`);
    }
    fuzz += contextMatch.fuzz;
    lineIndex = contextMatch.index + 1;
  }
  return { lineIndex, fuzz };
}

function locateChunk(originalLines: string[], filePath: string, chunk: PatchChunk, lineIndex: number): ChunkMatch {
  if (chunk.oldLines.length === 0) {
    return insertionReplacement(originalLines, chunk.newLines, lineIndex);
  }
  return matchChunkLines(originalLines, filePath, chunk, lineIndex);
}

function insertionReplacement(originalLines: string[], newLines: string[], lineIndex: number): ChunkMatch {
  const insertionIndex =
    originalLines[originalLines.length - 1] === "" ? originalLines.length - 1 : originalLines.length;
  return { start: insertionIndex, oldLength: 0, newLines, fuzz: 0, nextIndex: lineIndex };
}

function matchChunkLines(originalLines: string[], filePath: string, chunk: PatchChunk, lineIndex: number): ChunkMatch {
  let pattern = chunk.oldLines;
  let newLines = chunk.newLines;
  let foundAt = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
  if (foundAt === undefined && pattern[pattern.length - 1] === "") {
    const trimmed = trimTrailingBlankLine(pattern, newLines);
    pattern = trimmed.pattern;
    newLines = trimmed.newLines;
    foundAt = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
  }

  if (foundAt === undefined) {
    throw new PatchApplicationError(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`);
  }

  return {
    start: foundAt.index,
    oldLength: pattern.length,
    newLines,
    fuzz: foundAt.fuzz,
    nextIndex: foundAt.index + pattern.length,
  };
}

function trimTrailingBlankLine(pattern: string[], newLines: string[]): { pattern: string[]; newLines: string[] } {
  let trimmedNewLines = newLines;
  if (newLines[newLines.length - 1] === "") {
    trimmedNewLines = newLines.slice(0, -1);
  }
  return { pattern: pattern.slice(0, -1), newLines: trimmedNewLines };
}

function spliceReplacements(originalLines: string[], replacements: LineReplacement[]): string {
  const nextLines = [...originalLines];
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    nextLines.splice(replacement.start, replacement.oldLength, ...replacement.newLines);
  }
  nextLines.push("");
  return nextLines.join("\n");
}

/**
 * Approximate +/- counts from patch structure alone, without reading files.
 * Context lines inside update chunks are excluded; delete hunks contribute 0
 * because the removed line count is unknown without reading the file.
 */
export function countPatchChanges(hunks: ParsedPatch[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    const counts = countHunkChanges(hunk);
    added += counts.added;
    removed += counts.removed;
  }
  return { added, removed };
}

function countHunkChanges(hunk: ParsedPatch): { added: number; removed: number } {
  if (hunk.type === "add") {
    return { added: countAddFileLines(hunk.content), removed: 0 };
  }
  if (hunk.type === "update") {
    return countUpdateHunkChanges(hunk.chunks);
  }
  return { added: 0, removed: 0 };
}

function countAddFileLines(content: string): number {
  return content.split("\n").filter((line) => line.length > 0).length;
}

function countUpdateHunkChanges(chunks: PatchChunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const chunk of chunks) {
    const counts = countChunkChanges(chunk);
    added += counts.added;
    removed += counts.removed;
  }
  return { added, removed };
}

function countChunkChanges(chunk: PatchChunk): { added: number; removed: number } {
  const changes = diffLines(`${chunk.oldLines.join("\n")}\n`, `${chunk.newLines.join("\n")}\n`);
  return {
    added: sumChangedLines(changes, (change) => change.added === true),
    removed: sumChangedLines(changes, (change) => change.removed === true),
  };
}

function sumChangedLines(changes: Change[], isCounted: (change: Change) => boolean): number {
  let total = 0;
  for (const change of changes) {
    if (isCounted(change)) {
      total += change.count ?? 0;
    }
  }
  return total;
}
