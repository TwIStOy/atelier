# HTML Report Format

The architectural review is rendered as a single self-contained HTML file in the OS temp directory. Tailwind and Mermaid both come from CDNs. Mermaid handles graph-shaped diagrams reliably; hand-built divs and inline SVG handle the more editorial visuals (mass diagrams, cross-sections). Mix the two — don't lean on Mermaid for everything, it'll start to look generic.

## Language: Chinese

The report is written in Chinese. Everything the user reads — headings, prose, badge labels, the top recommendation — is Chinese. Technical tokens stay verbatim: file paths, code identifiers, module/class names, commands, HTML ids, and the dependency-category tags (`in-process`, `local-substitutable`, `ports & adapters`, `mock`). Set `<html lang="zh-CN">` and a CJK-safe font stack. Mermaid node labels may be Chinese; identifiers inside diagrams stay verbatim.

The deep-module glossary has fixed Chinese renderings. Use these, and only these — same anti-drift discipline as the English skill:

| English | Chinese |
| --- | --- |
| module | 模块 |
| interface | 接口 |
| implementation | 实现 |
| depth / deep / shallow | 深度 / 深 / 浅 |
| seam | 接缝 |
| adapter | 适配器 |
| leverage | 杠杆 |
| locality | 局部性 |

Gloss each term with the English in parentheses once, at its first occurrence in the report; after that, Chinese only. Never write 组件、服务、单元、API、边界、包装层 for these concepts. Domain nouns come from `CONTEXT.md` in whatever form it defines them — if it says "Order", the report says "Order", not a translation.

## Scaffold

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>架构评审 — {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      body { font-family: system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
      /* small custom layer for things Tailwind doesn't cover cleanly:
         dashed seam lines, hand-drawn-feeling arrow heads, etc. */
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

Repo name, date, and a compact legend in Chinese: 实线框 = 模块，虚线 = 接缝，红色箭头 = 外泄，深色粗框 = 深模块. No introduction paragraph — straight into the candidates.

## Candidate card

The diagrams carry the weight. Prose is sparse, plain, and uses the architecture vocabulary without ceremony.

Each candidate is one `<article>`:

- **Title** — short, names the deepening (e.g. 「收拢 Order intake 流水线」).
- **Badge row** — recommendation strength (「强烈推荐」 = emerald, 「值得探索」 = amber, 「试探性」 = slate), plus a tag for the dependency category (`in-process`, `local-substitutable`, `ports & adapters`, `mock` — kept in English; they are DEEPENING.md identifiers, not prose).
- **Files** — monospaced list, `font-mono text-sm`.
- **Before / After diagram** — the centrepiece. Two columns, side by side. See patterns below.
- **Problem** — one sentence. What hurts.
- **Solution** — one sentence. What changes.
- **Wins** — bullets, ≤12 characters each. e.g. 「测试只打一个接口」「定价逻辑不再外泄」「删掉 4 个浅模块」.
- **ADR callout** (if applicable) — one line in an amber-tinted box.

No paragraphs of explanation. If the diagram needs a paragraph to be understood, redraw the diagram.

## Diagram patterns

Pick the pattern that fits the candidate. Mix them. Don't make every diagram look the same — variety is part of the point.

### Mermaid graph (the workhorse for dependencies / call flow)

Use a Mermaid `flowchart` or `graph` when the point is "X calls Y calls Z, and look at the mess." Wrap it in a Tailwind-styled card so it doesn't feel parachuted in. Style with classDef to colour leakage edges red and the deep module dark. Sequence diagrams work well for "before: 6 round-trips; after: 1."

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### Hand-built boxes-and-arrows (when Mermaid's layout fights you)

Modules as `<div>`s with borders and labels. Arrows as inline SVG `<line>` or `<path>` elements positioned absolutely over a relative container. Reach for this when you want the "after" diagram to feel like one thick-bordered deep module with greyed-out internals — Mermaid won't render that with the right weight.

### Cross-section (good for layered shallowness)

Stack horizontal bands (`h-12 border-l-4`) to show layers a call passes through. Before: 6 thin layers each doing nothing. After: 1 thick band labelled with the consolidated responsibility.

### Mass diagram (good for "interface as wide as implementation")

Two rectangles per module — one for interface surface area, one for implementation. Before: interface rectangle is nearly as tall as the implementation rectangle (shallow). After: interface rectangle is short, implementation rectangle is tall (deep).

### Call-graph collapse

Before: a tree of function calls rendered as nested boxes. After: the same tree collapsed into one box, with the now-internal calls shown faded inside it.

## Style guidance

- Lean editorial, not corporate-dashboard. Generous whitespace. Serif optional for headings (`font-serif` works well with stone/slate).
- Colour sparingly: one accent (emerald or indigo) plus red for leakage and amber for warnings.
- Keep diagrams ~320px tall so before/after sits comfortably side by side without scrolling.
- Use `text-xs uppercase tracking-wider` for module labels inside diagrams — they should read as schematic, not as UI.
- The only scripts are the Tailwind CDN and the Mermaid ESM import. The report is otherwise static — no app code, no interactivity beyond Mermaid's own rendering.

## Top recommendation section

Heading reads 「首选建议」. One larger card. Candidate name, one sentence on why, anchor link to its card. That's it.

## Tone

Plain, concise Chinese — but the architectural nouns and verbs come straight from the deep-module vocabulary (see the table in the Language section). Concision is not an excuse to drift.

**Use exactly:** 模块、接口、实现、深度、深、浅、接缝、适配器、杠杆、局部性。

**Never substitute:** 组件、服务、单元 (for 模块) · API (for 接口) · 边界 (for 接缝) · 层、包装层 (for 模块 when you mean 模块).

**Phrasings that fit the style:**

- 「Order intake 模块很浅——接口几乎和实现一样宽。」
- 「定价逻辑越过接缝外泄。」
- 「加深：一个接口，一处测试。」
- 「两个适配器才撑得起这条接缝：生产用 HTTP，测试用内存实现。」

**Wins bullets** name the gain in glossary terms: 「局部性：bug 集中到一个模块」「杠杆：一个接口，N 个调用点」「接口收窄；实现吞掉包装层」. Don't write 「更易维护」 or 「代码更整洁」 — those terms aren't in the glossary and don't earn their place.

No hedging, no throat-clearing, no 「值得注意的是…」. If a sentence could be a bullet, make it a bullet. If a bullet could be cut, cut it. If a term isn't in the deep-module vocabulary, reach for one that is before inventing a new one.
