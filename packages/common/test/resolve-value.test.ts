import { resolveConfigValue as resolveFromCommon } from "@htwang-contrib/common";
import { getConfigEnvVar, resolveConfigValue } from "@htwang-contrib/common/config";
import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

describe("configuration value resolution", () => {
  test.each(["$EXAMPLE_VALUE", "{env:EXAMPLE_VALUE}", "  $EXAMPLE_VALUE  ", "\n{env:EXAMPLE_VALUE}\n"])(
    "resolves %s from the supplied environment",
    (value) => {
      expect(getConfigEnvVar(value)).toBe("EXAMPLE_VALUE");
      expect(resolveConfigValue(value, { EXAMPLE_VALUE: " https://example.com/api " })).toBe("https://example.com/api");
    },
  );

  test("resolves arbitrary string settings through the public entry point", () => {
    const env = { MODEL: "jev-latest", HOST: "https://example.com", TOKEN: "example-key" };
    expect(resolveFromCommon("$MODEL", env)).toBe("jev-latest");
    expect(resolveFromCommon("{env:HOST}", env)).toBe("https://example.com");
    expect(resolveFromCommon("$TOKEN", env)).toBe("example-key");
    expect(resolveFromCommon(" literal value ", env)).toBe("literal value");
  });

  test.each(["literal", "prefix-$VAR", "https://{env:HOST}/api", "$9INVALID", "$" + "{VAR}", "{env:}", "$VAR/path"])(
    "keeps %s literal when it is not a whole supported reference",
    (value) => {
      expect(getConfigEnvVar(value)).toBeUndefined();
      expect(resolveConfigValue(value, { VAR: "resolved", HOST: "example.com" })).toBe(value);
    },
  );

  test("accepts underscores, mixed case, and digits after the first character", () => {
    expect(getConfigEnvVar("$_Example2")).toBe("_Example2");
    expect(resolveConfigValue("{env:_Example2}", { _Example2: "value" })).toBe("value");
  });

  test.each([undefined, "", " \n\t "])("returns an empty string for an unset or blank variable (%s)", (value) => {
    expect(resolveConfigValue("$MISSING", { MISSING: value })).toBe("");
    expect(resolveConfigValue("{env:MISSING}", { MISSING: value })).toBe("");
    expect(getConfigEnvVar("$MISSING")).toBe("MISSING");
  });

  test("returns empty literal values without selecting a service-specific environment variable", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "default-key");
    expect(resolveConfigValue("")).toBe("");
    expect(resolveConfigValue(" \n\t ")).toBe("");
    expect(resolveConfigValue("literal")).toBe("literal");
  });

  test("reads the current process environment on each call", () => {
    vi.stubEnv("CONFIG_RESOLVE_TEST_VALUE", "first");
    expect(resolveConfigValue("$CONFIG_RESOLVE_TEST_VALUE")).toBe("first");
    vi.stubEnv("CONFIG_RESOLVE_TEST_VALUE", "second");
    expect(resolveConfigValue("{env:CONFIG_RESOLVE_TEST_VALUE}")).toBe("second");
    expect(resolveConfigValue("$CONFIG_RESOLVE_TEST_VALUE", {})).toBe("");
  });

  test("resolves once without expanding the resulting value", () => {
    const env = { FIRST: "$SECOND", SECOND: "expanded" };
    expect(resolveConfigValue("$FIRST", env)).toBe("$SECOND");
    expect(resolveConfigValue("{env:FIRST}", env)).toBe("$SECOND");
  });
});
