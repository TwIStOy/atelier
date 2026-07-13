import { describe, expect, it } from "vitest";
import { formatDuration } from "../src/format.ts";

describe("formatDuration", () => {
  it("shows milliseconds below 3s", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(42)).toBe("42 ms");
    expect(formatDuration(1500)).toBe("1500 ms");
    expect(formatDuration(2999)).toBe("2999 ms");
  });

  it("shows seconds with two decimals between 3s and 90s", () => {
    expect(formatDuration(3000)).toBe("3.00s");
    expect(formatDuration(3456)).toBe("3.46s");
    expect(formatDuration(12500)).toBe("12.50s");
    expect(formatDuration(89999)).toBe("90.00s");
  });

  it("shows m:ss at and above 90s", () => {
    expect(formatDuration(90000)).toBe("1:30");
    expect(formatDuration(150000)).toBe("2:30");
    expect(formatDuration(60000 * 10 + 5000)).toBe("10:05");
  });

  it("rounds the m:ss form", () => {
    expect(formatDuration(60000 + 30500)).toBe("1:31");
  });

  it("clamps negative input to zero", () => {
    expect(formatDuration(-100)).toBe("0 ms");
  });
});
