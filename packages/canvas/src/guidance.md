# Canvas publishing

The canvas server serves agent-built HTML pages to the user's browser. Published pages auto-reload in any browser viewing them when republished.

## Decide whether to publish

The trigger is **user intent**: would the user benefit from viewing this output as its own standalone artifact, separate from the chat?

**Publish when producing new standalone analytical output:**
- Quantitative analyses and metrics breakdowns (e.g. "send 500 requests and tell me how many fail")
- Security audits or architecture reviews with categorized findings
- Structured data from MCP tools or API queries where the data IS the deliverable
- Financial analyses, usage trend reports, timelines
- Tables with more than a handful of rows that the user asked to see
- Research/experiment progress the user may want to check periodically (republish to update)

**Do NOT publish when:**
- The user asked for work in a specific tool ("create a Datadog dashboard" means Datadog, not a canvas)
- The user has a specific deliverable — drafted message, code fix, PR
- The user is editing an existing artifact or doing targeted debugging
- Short factual answers, one-off edits, quick clarifications
- Data was only an intermediate step toward a different deliverable

If you catch yourself about to write a large markdown table, stop and consider a canvas instead.

## Authoring rules

- **Self-contained HTML.** Embed all data inline — no `fetch()`, no network calls from the page. Inline CSS/JS. CDN links (Chart.js, ECharts, D3, Tailwind) are allowed but require internet on the viewing device; for simple charts prefer hand-built inline SVG.
- **One page per artifact.** One `canvas_publish` call carries the full document. Republish the same `name` to update it in place (browsers auto-reload). Never split one artifact across multiple pages.
- **Never render empty states.** A canvas exists to show real content. If a section has no data, omit it — no placeholders, "No data" messages, zeroed rows, or empty chart frames. If the whole page would be empty, don't publish; ask the user for the missing data.
- **Label every plot.** Charts and tables must be self-describing: a title naming the specific metric, axis labels with units, a legend when more than one series is shown, and a small caption with source and time range (e.g. "Source: Datadog · last 7 days"). If a value is transformed (mean, p95, smoothed), say so in the label.

## Design language

The server injects a base stylesheet into every page exposing these CSS variables:

| Variable | Purpose |
| --- | --- |
| `--canvas-bg` | Page background |
| `--canvas-surface` | Card/panel background |
| `--canvas-fg` | Primary text |
| `--canvas-muted` | Secondary text, captions |
| `--canvas-accent` | Links, highlights, primary series color |
| `--canvas-border` | Structural borders |

Use `var(--canvas-*)` for all colors — no hardcoded hex. The base stylesheet also styles `body`, headings, `table`, `code`, `pre`, `hr`; your page's own `<style>` comes after it and can override. Flat, minimal, purposeful.

### Visual hierarchy

Primary content gets more space, larger headings, accent color; supporting content stays compact. Squint test: blur your eyes — can you tell what matters? Use accent color deliberately, not on everything.

### Slop patterns — forbidden

If 2+ are present, redesign:
- **Gradients** — no `linear-gradient`, `radial-gradient`, `background-clip: text`
- **Emojis** — not as icons, status indicators, bullets, or section markers
- **Box shadows** — flat surfaces only
- **Wall of identical cards** — mix open sections with cards
- **Rainbow coloring** — most elements neutral; color sparingly, with purpose
- **Giant text** — nothing above H1 size; no bold text stuffed in headers
- **Decorative borders** — borders are structural, not decoration

### Pre-delivery self-check

Before calling `canvas_publish`, verify:
1. Does the layout have visual hierarchy? One thing should stand out.
2. Is there variety in composition? Not a single column of uniform blocks.
3. Slop check: scan for the forbidden patterns above.

## Telling the user

Always include the full page URL as a markdown link (from the `canvas_publish` tool result) — e.g. `[eval-dashboard](http://100.x.y.z:7700/p/eval-dashboard)`. Prefer the LAN/Tailscale URL over localhost when the user may view from another device; never mention a page by name alone without the link.

- **First canvas in the session** — add one sentence explaining that pages live on the local canvas server and auto-reload on republish.
- **Unsolicited canvas** — add one sentence explaining why you chose a canvas over plain text.

One or two sentences total; skip the intro for subsequent pages.
