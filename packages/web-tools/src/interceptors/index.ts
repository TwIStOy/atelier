import { loadConfig } from "../config.ts";
import { GitHubInterceptor } from "./github.ts";
import type { UrlInterceptor } from "./types.ts";

export {
  GitHubInterceptor,
  type GitHubInterceptorOptions,
  type GitHubUrlInfo,
} from "./github.ts";
export type { UrlInterceptor } from "./types.ts";

let activeInterceptors: UrlInterceptor[] = [];

export function buildInterceptors(): UrlInterceptor[] {
  const config = loadConfig();
  if (config.githubInterceptorEnabled) {
    activeInterceptors = [
      new GitHubInterceptor({
        enabled: true,
        maxRepoSizeMB: config.githubMaxRepoSizeMB,
        cloneTimeoutSeconds: config.githubCloneTimeoutSeconds,
        clonePath: config.githubClonePath,
      }),
    ];
  } else {
    activeInterceptors = [];
  }
  return activeInterceptors;
}

export function getInterceptors(): readonly UrlInterceptor[] {
  return activeInterceptors;
}
