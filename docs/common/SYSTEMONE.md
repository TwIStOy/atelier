# System One

`@htwang-contrib/common` exposes TypeSafe System One through the official
`@typesafe-ai/sdk`. Components submit state and named questions to `systemOne` and
receive typed answers, the resolved model name, and token usage.

Import from `@htwang-contrib/common/systemone` when the component does not need Pi
runtime modules. The same exports are available from `@htwang-contrib/common`.

## Usage

```typescript
import {
  registerSystemOneConfigItems,
  systemOne,
  systemOneChoice,
  systemOneNoul,
  systemOneScore,
} from "@htwang-contrib/common/systemone";

registerSystemOneConfigItems();

const result = await systemOne({
  state: {
    ticket: "I was charged twice and need a refund today.",
  },
  questions: {
    billing: systemOneNoul("Does `ticket` describe a billing problem?"),
    route: systemOneChoice("Which team should handle `ticket`?", {
      billing: "Charges, invoices, and refunds",
      support: "Product usage and technical problems",
      other: "None of the listed teams applies",
    }),
    urgency: systemOneScore("How urgently does `ticket` need a response?", [
      "No time pressure is stated",
      "A prompt response is requested without a deadline",
      "A response is needed today",
    ]),
  },
});

const billingProbability = result.answers.billing.noul;
const team = result.answers.route.choice;
const urgency = result.answers.urgency.score;
const inputTokens = result.usage.input_tokens;
```

`team` is inferred as `"billing" | "support" | "other"`; answer keys and score
rubric indices are also preserved. Plain question objects with `type`,
`instructions`, and `criteria` are accepted without builders. State, instructions,
and criterion descriptions support strings, JSON objects, arrays, and `null`.

All questions in one request see the same state and run independently. They cannot
reference another answer from that request. A Noul is the probability of yes, a
Choice selects one label, and a Score is a probability-weighted position on the
zero-based rubric. Choice and Score include probabilities and confidence; Noul
does not have a separate confidence field. Callers own thresholds and decisions.

## Configuration

Call `registerSystemOneConfigItems()` during the consuming extension's
initialization to expose the **System One** section in `/config`. Registration is
idempotent across consumers and reloads. Importing the module does not register
settings or make a request.

Settings use the existing `extensions.json` configuration store:

```json
{
  "systemone": {
    "apiKey": "",
    "baseUrl": "https://api.typesafe.ai",
    "model": "jev-latest",
    "timeoutMs": 10000,
    "maxRetries": 2
  }
}
```

| Setting | Environment override | Meaning |
| --- | --- | --- |
| `apiKey` | `TYPESAFE_API_KEY` | Bearer credential; displayed as a secret in `/config` |
| `baseUrl` | `TYPESAFE_BASE_URL` | API root before `/v1/systemone` |
| `model` | `TYPESAFE_DEFAULT_MODEL` | Default model, overridable by `request.model` |
| `timeoutMs` | — | Per-attempt timeout in milliseconds, including body delivery |
| `maxRetries` | — | Retries after the initial attempt; `0` disables retries |

Precedence is explicit call options, nonblank environment values, persisted
settings, then defaults. `loadSystemOneConfig()` returns the effective shared
configuration. Every `systemOne()` call reloads configuration so edits affect the
next request without recreating a client.

For a gateway exposing `/api/v1/systemone`, set `baseUrl` to
`https://gateway.example.com/api`. The SDK appends `/v1/systemone` and removes
trailing slashes from the configured root. Do not include `/v1/systemone` in
`baseUrl`.

## Per-call options and errors

```typescript
import {
  systemOne,
  SystemOneAbortError,
  SystemOneAPIError,
  systemOneNoul,
  SystemOneTimeoutError,
} from "@htwang-contrib/common/systemone";

async function assess(text: string, signal: AbortSignal): Promise<number> {
  try {
    const result = await systemOne(
      {
        state: text,
        questions: { actionable: systemOneNoul("Does this text request a concrete action?") },
      },
      { signal, timeout: 5000, retry: { maxRetries: 0 } },
    );
    return result.answers.actionable.noul;
  } catch (error) {
    if (error instanceof SystemOneAbortError) throw error;
    if (error instanceof SystemOneTimeoutError) throw error;
    if (error instanceof SystemOneAPIError) {
      throw new Error(`System One HTTP ${error.status} (request ${error.requestId ?? "unknown"})`, { cause: error });
    }
    throw error;
  }
}
```

`SystemOneOptions` accepts `signal`, `timeout`, `retry`, and `headers` from the SDK,
plus optional `apiKey`, `baseUrl`, and `fetch` overrides. `fetch` allows transport
injection for tests without contacting the API. Authentication and JSON headers
are managed by the SDK.

The default retry policy retries connection failures, timeouts, HTTP 408/429, and
5xx responses, with backoff and support for `Retry-After`. Timeout applies to each
attempt; it is not an overall time budget. Use `retry: { maxRetries: 0 }` to disable
retries, or pass a deadline signal to bound the whole operation. Cancellation also
interrupts retry backoff. An already-aborted signal causes no HTTP request.

Errors propagate to the caller. `SystemOneAPIError` retains `status`, `body`,
`headers`, and `requestId`; `SystemOneConnectionError` covers transport failures;
`SystemOneTimeoutError` adds `timeoutMs`; `SystemOneAbortError` identifies caller
cancellation. All are subclasses of `SystemOneError`, which also covers missing
credentials and SDK question validation. No failure is replaced by a judgment.

SDK console logging is disabled to avoid writing into the Pi terminal UI, even
when `TYPESAFE_LOG_LEVEL` is set. The SDK types responses according to the API
contract; it does not validate successful response bodies at runtime.

## Sources

- [TypeSafe skill](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md)
- [HTTP API](https://docs.typesafe.ai/api.md)
- [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript.md)
- [Structured descriptions](https://docs.typesafe.ai/primitives/advanced.md)
