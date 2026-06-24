import { describe, expect, it } from "vitest";
import { redactSecrets, safeError } from "../src/secrets.ts";

describe("redactSecrets — Authorization header", () => {
  it("redacts 'Authorization: Bearer <token>' form", () => {
    const out = redactSecrets("Authorization: Bearer sk-abc123");
    expect(out).toContain("<redacted>");
    expect(out).not.toContain("sk-abc123");
    expect(out).toContain("Authorization: Bearer <redacted>");
  });

  it("preserves the Authorization prefix for diagnostics", () => {
    expect(redactSecrets("Authorization: Bearer sk-secret")).toBe("Authorization: Bearer <redacted>");
  });

  it("handles mixed case 'authorization: bearer'", () => {
    expect(redactSecrets("authorization: bearer sk-x")).toBe("authorization: bearer <redacted>");
  });

  it("handles extra whitespace between words", () => {
    expect(redactSecrets("Authorization:    Bearer   sk-y")).toBe("Authorization:    Bearer   <redacted>");
  });
});

describe("redactSecrets — bare Bearer", () => {
  it("redacts bare 'Bearer <token>' outside an Authorization header", () => {
    expect(redactSecrets("failed: Bearer sk-zzz")).toBe("failed: Bearer <redacted>");
  });
});

describe("redactSecrets — API_KEY env assignment", () => {
  it("redacts 'INFERENCE_TWISTOY_API_KEY=value'", () => {
    const out = redactSecrets("INFERENCE_TWISTOY_API_KEY=sk-abc123");
    expect(out).toBe("INFERENCE_TWISTOY_API_KEY=<redacted>");
  });

  it("stops at common delimiters (quote, comma, semicolon)", () => {
    expect(redactSecrets('env OPENAI_API_KEY="sk-abc123"')).toBe('env OPENAI_API_KEY="<redacted>"');
    expect(redactSecrets("keys: OPENAI_API_KEY=sk-a, OTHER=x")).toBe("keys: OPENAI_API_KEY=<redacted>, OTHER=x");
  });

  it("does not match lowercase 'api_key=' assignment", () => {
    expect(redactSecrets("config api_key=sk-abc123")).toBe("config api_key=sk-abc123");
  });
});

describe("redactSecrets — additionalSecrets literals", () => {
  it("replaces an additional literal anywhere in the text", () => {
    expect(redactSecrets("echo sk-secret-key && curl", ["sk-secret-key"])).toBe("echo <redacted> && curl");
  });

  it("handles multiple occurrences of the same literal", () => {
    expect(redactSecrets("a sk-x b sk-x c", ["sk-x"])).toBe("a <redacted> b <redacted> c");
  });

  it("does not throw on additionalSecrets containing regex metacharacters", () => {
    expect(redactSecrets("path (.*) end", ["(.*)"])).toBe("path <redacted> end");
  });

  it("ignores empty / whitespace-only additionalSecrets entries", () => {
    expect(redactSecrets("sk-abc", ["", "   ", undefined])).toBe("sk-abc");
  });
});

describe("redactSecrets — boundaries", () => {
  it("returns '' for undefined", () => {
    expect(redactSecrets(undefined)).toBe("");
  });

  it("returns '' for null", () => {
    expect(redactSecrets(null)).toBe("");
  });

  it("returns '' for empty string", () => {
    expect(redactSecrets("")).toBe("");
  });

  it("stringifies non-string input", () => {
    expect(redactSecrets(42)).toBe("42");
  });

  it("leaves clean text untouched", () => {
    expect(redactSecrets("nothing secret here")).toBe("nothing secret here");
  });
});

describe("safeError", () => {
  it("extracts message from an Error and redacts additionalSecrets", () => {
    const err = new Error("failed with key sk-secret");
    expect(safeError(err, ["sk-secret"])).toBe("failed with key <redacted>");
  });

  it("handles a plain string error", () => {
    expect(safeError("Authorization: Bearer sk-abc")).toBe("Authorization: Bearer <redacted>");
  });

  it("handles an object with a message property", () => {
    expect(safeError({ message: "Bearer sk-abc123 leaked" })).toBe("Bearer <redacted> leaked");
  });

  it("returns '' for null/undefined", () => {
    expect(safeError(null)).toBe("");
    expect(safeError(undefined)).toBe("");
  });

  it("stringifies non-Error, non-string, non-message objects", () => {
    expect(safeError(42)).toBe("42");
  });

  it("redacts Authorization pattern in an Error message without additionalSecrets", () => {
    const err = new Error("send header Authorization: Bearer sk-leak");
    expect(safeError(err)).toBe("send header Authorization: Bearer <redacted>");
  });
});
