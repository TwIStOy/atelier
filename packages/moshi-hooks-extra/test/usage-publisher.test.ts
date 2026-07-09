import type { CodingPlanRawUsage, CodingPlanUsage } from "@htwang-contrib/common";
import { describe, expect, test, vi } from "vitest";
import type { MoshiCredentials } from "../src/moshi-secrets.ts";
import {
  buildZaiRawSnapshot,
  buildZaiSnapshot,
  MOSHI_USAGE_AGENT,
  pushUsageSnapshot,
  windowLabelFor,
  ZAI_ACCOUNT_ID,
} from "../src/usage-publisher.ts";

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

  test("maps token windows, clamps percentages, formats resetsAt", () => {
    expect(snapshot.windows).toEqual([
      { label: "5h", usedPercentage: 30, resetsAt: "2026-02-02T02:40:00.000Z" },
      { label: "Weekly", usedPercentage: 42.5 },
      { label: "1h", usedPercentage: 0 },
    ]);
  });

  test("omits level suffix when level is absent", () => {
    const snap = buildZaiSnapshot({ limits: [{ window: "weekly", percentage: 1 }] }, CREDS, NOW);
    expect(snap.accountLabel).toBe("Z.AI Coding Plan");
  });
});

describe("buildZaiRawSnapshot", () => {
  const RAW: CodingPlanRawUsage = {
    level: "max",
    windows: [
      {
        kind: "tool_calls",
        period: "weekly",
        usedPercentage: 6,
        nextResetTime: 1782804496992,
        usage: 4000,
        details: [{ modelCode: "search-prime", usage: 98 }],
      },
      {
        kind: "tokens",
        period: "5h",
        usedPercentage: 1,
        nextResetTime: 1782222112875,
      },
      { kind: "tokens", period: "weekly", usedPercentage: 150 },
    ],
    modelTotals: { totalTokensUsage: 44984926 },
  };

  const snapshot = buildZaiRawSnapshot(RAW, CREDS, NOW);

  test("keeps the canonical account id / agent / label", () => {
    expect(snapshot.accountId).toBe(ZAI_ACCOUNT_ID);
    expect(snapshot.agent).toBe(MOSHI_USAGE_AGENT);
    expect(snapshot.accountLabel).toBe("Z.AI Coding Plan (Max)");
  });

  test("publishes only token windows with kind-aware labels", () => {
    expect(snapshot.windows.map((w) => w.label)).toEqual(["5h tokens", "weekly tokens"]);
  });

  test("passes through real resetsAt and clamps percentages", () => {
    expect(snapshot.windows[0].resetsAt).toBe("2026-06-23T13:41:52.875Z");
    expect(snapshot.windows[0].usedPercentage).toBe(1);
    expect(snapshot.windows[1].usedPercentage).toBe(100);
    expect(snapshot.windows[1].resetsAt).toBeUndefined();
  });
});

describe("pushUsageSnapshot", () => {
  test("POSTs snapshot with bearer + UA and reports ok on 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"success":true,"count":1}', { status: 200 }));
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
    expect(headers.Authorization).toBe("Bearer secret_xyz");
    expect(headers["User-Agent"].length).toBeGreaterThan(0);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.snapshots[0].accountId).toBe(ZAI_ACCOUNT_ID);
  });

  test("reports failure on non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 422 }));
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

  test("stays silent when no logger is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('"ok"', { status: 200 }));
    const snapshot = buildZaiSnapshot(USAGE, CREDS, NOW);
    await pushUsageSnapshot(snapshot, CREDS, { fetch: fetchMock });
    // No assertion to make beyond "does not throw"; the default path must
    // tolerate an absent logger without touching any sink.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("pushUsageSnapshot logging", () => {
  const makeLogger = () => {
    const calls: { level: string; msg: string }[] = [];
    const logger = {
      debug: (msg: string) => calls.push({ level: "debug", msg }),
      info: (msg: string) => calls.push({ level: "info", msg }),
      warn: (msg: string) => calls.push({ level: "warn", msg }),
      error: (msg: string) => calls.push({ level: "error", msg }),
    };
    return { logger, calls };
  };

  test("logs the attempt then the response on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"success":true,"count":1}', { status: 200 }));
    const { logger, calls } = makeLogger();
    const snapshot = buildZaiSnapshot(USAGE, CREDS, NOW);
    await pushUsageSnapshot(snapshot, CREDS, { fetch: fetchMock, logger });

    expect(calls.map((c) => c.level)).toEqual(["info", "info"]);
    expect(calls[0].msg).toContain("sending usage snapshot");
    expect(calls[0].msg).toContain(`host=${CREDS.hostName}`);
    expect(calls[0].msg).toContain(`account=${ZAI_ACCOUNT_ID}`);
    expect(calls[0].msg).toContain("windows=3");
    expect(calls[1].msg).toContain("status=200");
    expect(calls[1].msg).toContain('body={"success":true,"count":1}');
  });

  test("warns with status + body on a rejected (non-ok) response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"bad agent"}', { status: 422 }));
    const { logger, calls } = makeLogger();
    const snapshot = buildZaiSnapshot(USAGE, CREDS, NOW);
    await pushUsageSnapshot(snapshot, CREDS, { fetch: fetchMock, logger });

    expect(calls.map((c) => c.level)).toEqual(["info", "warn"]);
    expect(calls[1].msg).toContain("status=422");
    expect(calls[1].msg).toContain('body={"error":"bad agent"}');
  });

  test("errors with the failure message on a network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const { logger, calls } = makeLogger();
    const snapshot = buildZaiSnapshot(USAGE, CREDS, NOW);
    await pushUsageSnapshot(snapshot, CREDS, { fetch: fetchMock, logger });

    expect(calls.map((c) => c.level)).toEqual(["info", "error"]);
    expect(calls[1].msg).toBe("usage push failed: ECONNREFUSED");
  });
});
