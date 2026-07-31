const FENCED_CODE_BLOCK = /```[^\n]*\n[\s\S]*?```/g;
const WIKILINK = /\[\[([^\]\n]+)\]\]/g;

export function extractWikilinkTargets(body: string): string[] {
  const withoutCode = body.replace(FENCED_CODE_BLOCK, "");
  const targets: string[] = [];
  for (const match of withoutCode.matchAll(WIKILINK)) {
    const inner = match[1];
    if (inner === undefined) continue;
    const target = inner.split("|")[0]?.split("#")[0]?.trim();
    if (target && target.length > 0) targets.push(target);
  }
  return targets;
}
