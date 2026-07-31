import * as path from "node:path";

export const VAULT_DIR_NAME = ".llm-wiki";

export interface VaultLayout {
  root: string;
  config: string;
  schema: string;
  purpose: string;
  templates: string;
  inbox: string;
  sourcesRoot: string;
  wiki: string;
  wikiOverview: string;
  wikiSources: string;
  wikiConcepts: string;
  wikiEntities: string;
  wikiSyntheses: string;
  wikiAnalyses: string;
  meta: string;
  registry: string;
  backlinks: string;
  metaIndex: string;
  events: string;
  log: string;
  lintReport: string;
  review: string;
}

export function vaultLayout(root: string): VaultLayout {
  const wiki = path.join(root, "wiki");
  const meta = path.join(root, "meta");
  return {
    root,
    config: path.join(root, "config.json"),
    schema: path.join(root, "WIKI_SCHEMA.md"),
    purpose: path.join(root, "purpose.md"),
    templates: path.join(root, "templates"),
    inbox: path.join(root, "inbox"),
    sourcesRoot: path.join(root, "raw", "sources"),
    wiki,
    wikiOverview: path.join(wiki, "overview.md"),
    wikiSources: path.join(wiki, "sources"),
    wikiConcepts: path.join(wiki, "concepts"),
    wikiEntities: path.join(wiki, "entities"),
    wikiSyntheses: path.join(wiki, "syntheses"),
    wikiAnalyses: path.join(wiki, "analyses"),
    meta,
    registry: path.join(meta, "registry.json"),
    backlinks: path.join(meta, "backlinks.json"),
    metaIndex: path.join(meta, "index.md"),
    events: path.join(meta, "events.jsonl"),
    log: path.join(meta, "log.md"),
    lintReport: path.join(meta, "lint-report.md"),
    review: path.join(meta, "review.jsonl"),
  };
}
