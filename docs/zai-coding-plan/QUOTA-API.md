# Z.AI Coding Plan Quota API

How to interpret the Z.AI monitor usage endpoints, in particular the `quota/limit`
response and its `(type, unit, number)` window encoding.

This is the authoritative reference for `packages/zai-coding-plan/src/quota.ts`.
Upstream reference: [CodexBar zai provider doc](https://github.com/steipete/CodexBar/blob/main/docs/zai.md).

## Endpoints

All under `https://api.z.ai/api/monitor/usage`:

| Endpoint        | Path             | Returns                                            |
| --------------- | ---------------- | -------------------------------------------------- |
| Quota Limit     | `/quota/limit`   | Limit windows: used %, reset times, MCP breakdown  |
| Model Usage     | `/model-usage`   | Token + call totals (windowed by query time range) |
| Tool Usage      | `/tool-usage`    | MCP tool counts (web search / read / ZRead)        |

`model-usage` / `tool-usage` take `startTime` / `endTime` query params
(`YYYY-MM-DD HH:MM:SS`, URL-encoded).

Headers:

- `Authorization: <ZAI_API_KEY>` — raw key, no `Bearer` prefix (verified to return 200).
  CodexBar sends `Authorization: Bearer <key>`; both are accepted.
- `Content-Type: application/json`

## `quota/limit` response shape

```json
{
  "code": 200,
  "data": {
    "level": "max",
    "limits": [
      { "type": "...", "unit": N, "number": N, "percentage": N, "nextResetTime": <epoch ms>, ... }
    ]
  }
}
```

- `data.level` — plan tier (`"max"`, `"pro"`, ...).
- `data.limits[]` — one entry per active quota window.

## Limit entry encoding

Two limit **types** decide what is being limited:

| `type`          | kind          | meaning                                        |
| --------------- | ------------- | ---------------------------------------------- |
| `TOKENS_LIMIT`  | `tokens`      | token window (primary)                         |
| `TIME_LIMIT`    | `tool_calls`  | tool-call / MCP window (secondary); carries `usageDetails[]` |

`unit` + `number` pin the rolling **period**. The `(type, unit, number) -> period`
mapping is **fixed by the API** — look it up in a table, do **not** infer the
period from `nextResetTime`. Reset deltas are calendar-aligned and misleading:
a weekly window queried near its reset can show `~24h`, and a monthly window
early in the cycle can show `~24d`. Those deltas are fine for a one-time
calibration but must not drive runtime classification.

### Fixed mapping table (Max plan, personal)

| key (`type_unit_number`) | kind         | period     | description                          |
| ------------------------ | ------------ | ---------- | ------------------------------------ |
| `TIME_LIMIT_5_1`         | `tool_calls` | `monthly`  | tool-call quota, resets ~month end   |
| `TOKENS_LIMIT_3_5`       | `tokens`     | `5h`       | 5-hour rolling token window          |
| `TOKENS_LIMIT_6_1`       | `tokens`     | `weekly`   | weekly token window                  |

### Fallback for unknown `(type, unit, number)`

- any `TIME_LIMIT` not in the table -> `tool_calls / monthly`
- any `TOKENS_LIMIT` not in the table -> unknown, skip

### Per-entry fields

- `percentage` — used % (0–100).
- `nextResetTime` — epoch ms.
- `usage`, `currentValue`, `remaining` — raw used / cap / left. Present on the
  `TIME_LIMIT` (tool-call) window.
- `usageDetails[]` — `{ modelCode, usage }` per MCP model
  (`search-prime`, `web-reader`, `zread`). Present only on `TIME_LIMIT`.

## Why "monthly" can look barely used

`TIME_LIMIT_5_1` is the **monthly** tool-call window. Early in the month it
legitimately shows a low percentage with a reset ~3–4 weeks out. A previous
version of `quota.ts` mislabeled it `weekly` in the raw-usage path, so the
raw path (`describeRawLimit`) disagreed with the display path (`classifyWindow`),
which made the figure look wrong. Both paths now read from one fixed table,
`RAW_LIMIT_TABLE`, so they cannot diverge.

## Implementation pointers

- `packages/zai-coding-plan/src/quota.ts`
  - `RAW_LIMIT_TABLE` — single source of truth for the mapping above.
  - `describeRawLimit` — table lookup + fallback; returns `{ kind, period }`.
  - `classifyWindow` — delegates to `describeRawLimit`, maps `period` to the
    legacy `CodingPlanUsageWindow` (`5h -> 5_hours`, etc.).
- `packages/common/src/usage.ts` — `CodingPlanRawUsage`, `CodingPlanLimitKind`
  (`tool_calls | tokens`), `CodingPlanLimitPeriod` (`5h | weekly | monthly`).

## References

- [CodexBar zai provider doc](https://github.com/steipete/CodexBar/blob/main/docs/zai.md)
- [Z.AI personal usage dashboard](https://z.ai/manage-apikey/coding-plan/personal/my-plan)
- [BigModel CN team usage](https://bigmodel.cn/coding-plan/team/usage-stats)
