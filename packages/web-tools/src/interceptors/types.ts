import type { FetchResponse } from "../providers/types.ts";

export interface UrlInterceptor {
  readonly name: string;
  intercept(url: string, opts: { raw: boolean; signal?: AbortSignal }): Promise<FetchResponse | null>;
}
