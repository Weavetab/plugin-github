import type { GithubError, GithubRunContext } from "./types.js";
import { getRepoContext, isGithubError } from "./repoContext.js";
import { loadRepoCache } from "./cache.js";
import { githubAnalyze } from "./analyze.js";

interface ReadArgs {
  repo?: string;
  paths: string[];
  line_range?: number[];
}

/**
 * `read` action — fetch raw file contents from the default branch.
 *
 * Ensures an analysis (and thus `default_branch` + `file_tree`) exists first,
 * then fetches each requested path in parallel over raw.githubusercontent.com.
 */
export async function githubRead(ctx: GithubRunContext, args: ReadArgs): Promise<any> {
  const context = await getRepoContext(ctx.session, args.repo);
  if (isGithubError(context)) return context;

  const { owner, repo } = context;

  let cached = await loadRepoCache(owner, repo, ctx.store, ctx.cacheTtlMs);
  if (!cached) {
    const analyzed = await githubAnalyze(ctx, args.repo);
    if (isGithubError(analyzed)) return analyzed;
    cached = analyzed;
  }

  const default_branch = cached.default_branch;
  const file_tree = cached.file_tree;

  const results: any[] = [];
  const warnings: string[] = [];

  const fetchPromises = args.paths.map(async (rawPath) => {
    const path = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (path.includes("..") || path.includes("\0")) {
      return { path: rawPath, error: "INVALID_PATH", message: "Path traversal or null bytes detected." };
    }

    if (!file_tree.some((entry) => entry.path === path)) {
      warnings.push(
        `Path '${path}' was not found in the cached file tree. Branch contents may differ.`
      );
    }

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${default_branch}/${path}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(rawUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        return { path, error: "FETCH_FAILED", status: res.status, message: res.statusText };
      }

      const lines = (await res.text()).split("\n");
      const total_lines = lines.length;

      let returnedContent = lines.join("\n");
      let truncated = false;

      if (Array.isArray(args.line_range) && args.line_range.length === 2) {
        const start = Math.max(0, args.line_range[0]! - 1); // 1-indexed -> 0-indexed
        const end = Math.min(total_lines, args.line_range[1]!);
        returnedContent = lines.slice(start, end).join("\n");
        truncated = start > 0 || end < total_lines;
      } else if (total_lines > ctx.maxReadLines) {
        returnedContent = lines.slice(0, ctx.maxReadLines).join("\n");
        truncated = true;
      }

      return { path, total_lines, truncated, content: returnedContent };
    } catch (err: any) {
      return { path, error: "FETCH_ERROR", message: err?.message };
    }
  });

  const pathResults = await Promise.all(fetchPromises);
  results.push(...pathResults);

  return {
    warnings: warnings.length > 0 ? warnings : undefined,
    files: results,
  };
}
