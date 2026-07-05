import { describe, expect, test } from "vitest";
import { computeLayout } from "../src/popup.ts";
import { DEFAULT_MAX_HEIGHT_PCT } from "../src/types.ts";

describe("computeLayout", () => {
  test("bodyRows never exceeds the max-height percentage of the terminal", () => {
    for (let rows = 20; rows <= 120; rows += 1) {
      const layout = computeLayout(rows);
      const maxHeight = Math.floor((rows * DEFAULT_MAX_HEIGHT_PCT) / 100);
      expect(layout.bodyRows).toBeLessThanOrEqual(maxHeight);
    }
  });

  test("bodyRows is capped by the absolute ceiling on very tall terminals", () => {
    expect(computeLayout(200).bodyRows).toBe(40);
    expect(computeLayout(1000).bodyRows).toBe(40);
  });

  test("bodyRows respects the minimum floor on tiny terminals", () => {
    expect(computeLayout(4).bodyRows).toBe(8);
    expect(computeLayout(1).bodyRows).toBe(8);
  });

  test("typical terminal heights produce expected values", () => {
    expect(computeLayout(50)).toMatchObject({ bodyRows: 40, listRows: 33 });
    expect(computeLayout(44)).toMatchObject({ bodyRows: 37, listRows: 30 });
    expect(computeLayout(24)).toMatchObject({ bodyRows: 20, listRows: 13 });
  });

  test("innerRows mirrors bodyRows", () => {
    const layout = computeLayout(44);
    expect(layout.innerRows).toBe(layout.bodyRows);
  });

  test("leaves a bottom margin so the popup title stays above the app footer", () => {
    for (let rows = 24; rows <= 80; rows += 4) {
      const { bodyRows } = computeLayout(rows);
      expect(rows - bodyRows).toBeGreaterThanOrEqual(3);
    }
  });
});
