import { describe, expect, test, vi } from "vitest";
import type { CodingPlanUsage } from "@htwang-contrib/common";
import type { MoshiCredentials } from "./moshi-secrets.ts";
import {
  MOSHI_USAGE_AGENT,
  ZAI_ACCOUNT_ID,
  buildZaiSnapshot,
  pushUsageSnapshot,
  windowLabelFor,
} from "./usage-publisher.ts";

const CREDS: MoshiCredentials = {
  hostId: "host_abc",
  hostSecret: "secret_xyz",
  hostName: "poi",
  baseUrl: "https://api.getmoshi.app/api/v1",
};

const NOW = new Date("2026-06-23T07:50:00Z");

const USAGE: CodingPlanUsage = {
  level: "max",
  limits: [
    { window: "5_hours", percentage: 30, nextResetTime: 1770000000000 },
    { window: "weekly", percentage: 42.5 },
    { window: "hour", percentage: -5 },
    { window: "monthly" as never, percentage: 150 },
  ],
};

describe("windowLabelFor", () => {
  test("maps known windows to short Moshi labels", () => {
    expect(windowLabelFor("hour")).toBe("1h");
    expect(windowLabelFor("5_hours")).toBe("5h");
    expect(windowLabelFor("weekly")).toBe("Weekly");
    expect(windowLabelFor("monthly")).toBe("Monthly");
  });
});

describe("buildZaiSnapshot", () => {
  const snapshot = buildZaiSnapshot(USAGE, CREDS, NOW);

  test("uses the canonical account id and agent", () => {
    expect(snapshot.accountId).toBe(ZAI_ACCOUNT_ID);
    expect(snapshot.agent).toBe(MOSHI_USAGE_AGENT);
  });

  test("appends capitalized level to accountLabel", () => {
    expect(snapshot.accountLabel).toBe("Z.AI Coding Plan (Max)");
  });

  test("carries hostName and capturedAt", () => {
    expect(snapshot.hostName).toBe("poi");
    expect(snapshot.capturedAt).toBe("2026-06-23T07:50:00.000Z");
  });

  test("maps windows, clamps percentages, formats resetsAt", () => {
    expect(snapshot.windows).toEqual([
      { label: "5h", usedPercentage: 30, resetsAt: "2026-02-02T02:40:00.000Z" },
      { label: "Weekly", usedPercentage: 42.5 },
      { label: "1h", usedPercentage: 0 },
      { label: "Monthly", usedPercentage: 100 },
    ]);
  });

  test("omits level suffix when level is absent", () => {
    const snap = buildZaiSnapshot(
      { limits: [{ window: "weekly", percentage: 1 }] },
      CREDS,
      NOW,
    );
    expect(snap.accountLabel).toBe("Z.AI Coding Plan");
  });
});

describe("pushUsageSnapshot", () => {
  test("POSTs snapshot with bearer + UA and reports ok on 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('{"success":true,"count":1}', { status: 200 }),
      );
    const snapshot = buildZaiSnapshot(USAGE, CREDS, NOW);
    const result = await pushUsageSnapshot(snapshot, CREDS, {
      fetch: fetchMock,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.getmoshi.app/api/v1/hosts/host_abc/usage");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer secret_xyz");
    expect(headers["User-Agent"].length).toBeGreaterThan(0);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.snapshots[0].accountId).toBe(ZAI_ACCOUNT_ID);
  });

  test("reports failure on non-ok response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 422 }));
    const snapshot = buildZaiSnapshot(USAGE, CREDS, NOW);
    const result = await pushUsageSnapshot(snapshot, CREDS, {
      fetch: fetchMock,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
  });

  test("reports ok=false with status 0 on network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const snapshot = buildZaiSnapshot(USAGE, CREDS, NOW);
    const result = await pushUsageSnapshot(snapshot, CREDS, {
      fetch: fetchMock,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.body).toBe("ECONNREFUSED");
  });
});
