# Configuration value resolution

Use `resolveConfigValue` from `@htwang-contrib/common/config` for string settings
that accept literal values or environment-variable references. It is also
exported from `@htwang-contrib/common`; the config subpath does not load the Pi
runtime.

```typescript
import { getConfigEnvVar, resolveConfigValue } from "@htwang-contrib/common/config";

const apiKey = resolveConfigValue("$MY_API_KEY");
const baseUrl = resolveConfigValue("{env:MY_API_URL}");
const model = resolveConfigValue("jev-latest");
const variableName = getConfigEnvVar("$MY_API_KEY");
```

`resolveConfigValue(value, env?)` returns a string. Its optional second argument
is a read-only map of environment-variable names to string values or `undefined`;
it defaults to the current `process.env` on each call. Tests and callers with
isolated configuration can provide their own map:

```typescript
const model = resolveConfigValue("{env:MODEL}", { MODEL: "jev-latest" });
```

The resolver trims surrounding whitespace from both literals and resolved
values. Only complete `$VAR` and `{env:VAR}` references are recognized. Names
must start with an ASCII letter or underscore, followed by letters, digits, or
underscores. Embedded references and unsupported forms remain literal strings.
Resolution happens once; an environment value containing another reference is
returned as text.

An unset or blank referenced variable resolves to `""`. `getConfigEnvVar(value)`
returns the referenced variable name even when it is unset, or `undefined` for
a literal. Callers can use this distinction when deciding precedence or
reporting a missing required setting. The resolver has no service-specific
defaults, fallback rules, or required-value validation.

Call it explicitly for supported string fields after reading configuration.
`readConfig` continues to return stored values without automatically expanding
every field. ConfigItem getters used for editing should return the stored
expression so saving a setting preserves references instead of persisting
resolved secrets.

[Magpie](../magpie/README.md) uses these helpers for its gateway key. The
classifier owns the `MAGPIE_API_KEY` precedence and the missing-credential
error.
