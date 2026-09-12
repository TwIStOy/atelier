import { type RequestOptions, request } from "node:http";
import type { EventEnvelope } from "./event.ts";
import type { Report } from "./report.ts";

export interface PostResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

export type RequestFn = (
  options: RequestOptions,
  callback: (res: { statusCode?: number }) => void,
) => {
  on(event: "error", handler: (err: Error) => void): unknown;
  on(event: "timeout", handler: () => void): unknown;
  write(chunk: string): unknown;
  end(): unknown;
  setTimeout(ms: number): unknown;
  destroy(err?: Error): unknown;
};

const DEFAULT_REQUEST: RequestFn = (options, callback) => request(options, callback as never);

export interface PostOptions {
  timeoutMs?: number;
  requestFn?: RequestFn;
}

function postJson(
  host: string,
  port: number,
  path: string,
  body: unknown,
  options: PostOptions = {},
): Promise<PostResult> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const requestFn = options.requestFn ?? DEFAULT_REQUEST;
  const payload = JSON.stringify(body);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PostResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let req: ReturnType<RequestFn>;
    try {
      req = requestFn(
        {
          host,
          port,
          path,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload).toString(),
            connection: "close",
          },
          timeout: timeoutMs,
        },
        (res) => {
          finish({ ok: res.statusCode === 204, statusCode: res.statusCode });
        },
      );
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    req.on("error", (err: Error) => {
      finish({ ok: false, error: err.message });
    });
    req.on("timeout", () => {
      try {
        req.destroy(new Error(`timeout after ${timeoutMs}ms`));
      } catch {
        finish({ ok: false, error: "timeout" });
      }
    });

    try {
      req.write(payload);
      req.end();
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

export function postReport(host: string, port: number, report: Report, options: PostOptions = {}): Promise<PostResult> {
  return postJson(host, port, "/v1/reports", report, options);
}

export function postEvent(
  host: string,
  port: number,
  envelope: EventEnvelope,
  options: PostOptions = {},
): Promise<PostResult> {
  return postJson(host, port, "/v1/events", envelope, options);
}
