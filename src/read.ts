import type { GithubError, GithubRunContext, GithubReadArgs } from "./types.js";
import { getDetailedRepoContext, isGithubError } from "./repoContext.js";
import { loadRepoCache } from "./cache.js";

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff",
  "pdf", "zip", "tar", "gz", "tgz", "7z", "rar",
  "wasm", "exe", "dll", "so", "dylib",
  "mp3", "mp4", "wav", "avi", "mov", "webm",
  "woff", "woff2", "ttf", "eot", "otf",
]);

function isBinaryPath(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext ? BINARY_EXTENSIONS.has(ext) : false;
}

/**
 * `read` action — fetch raw file contents from raw.githubusercontent.com.
 *
 * If a branch is explicitly provided, cached, or inferred from the active tab,
 * reads directly over HTTP without consuming any GitHub API rate-limited quota.
 */
export async function githubRead(ctx: GithubRunContext, args: GithubReadArgs): Promise<any> {
  const context = await getDetailedRepoContext(ctx.session, args.repo);
  if (isGithubError(context)) return context;

  const { owner, repo } = context;

  // Resolve target paths (explicit paths win, fallback to active tab file)
  let rawPaths = Array.isArray(args.paths) ? args.paths.filter((p) => typeof p === "string" && p.trim()) : [];
  if (rawPaths.length === 0 && context.filePath) {
    rawPaths = [context.filePath];
  }

  if (rawPaths.length === 0) {
    return {
      error: "MISSING_PATHS",
      message: "github_read requires a 'paths' array (or open a source file blob in the active browser tab).",
    };
  }

  let branch = args.branch || context.branch;
  let file_tree: { path: string }[] | null = null;

  if (!branch) {
    const cached = await loadRepoCache(owner, repo, ctx.store, ctx.cacheTtlMs);
    if (cached) {
      branch = cached.default_branch;
      file_tree = cached.file_tree;
    } else {
      branch = "main";
    }
  }

  const results: any[] = [];
  const warnings: string[] = [];

  const fetchPromises = rawPaths.map(async (rawPath) => {
    const path = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (path.includes("..") || path.includes("\0")) {
      return { path: rawPath, error: "INVALID_PATH", message: "Path traversal or null bytes detected." };
    }

    if (file_tree && !file_tree.some((entry) => entry.path === path)) {
      warnings.push(
        `Path '${path}' was not found in the cached file tree. Branch contents may differ.`
      );
    }

    if (isBinaryPath(path)) {
      return {
        path,
        branch: branch!,
        binary: true,
        message: "Binary file omitted from text read.",
      };
    }

    let targetBranch = branch!;
    let rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${targetBranch}/${path}`;

    try {
      let res = await fetchWithTimeout(rawUrl, 10_000);

      // If branch wasn't pinned and "main" failed, try "master"
      if (!res.ok && res.status === 404 && !args.branch && !context.branch && branch === "main") {
        const altUrl = `https://raw.githubusercontent.com/${owner}/${repo}/master/${path}`;
        const altRes = await fetchWithTimeout(altUrl, 10_000);
        if (altRes.ok) {
          res = altRes;
          targetBranch = "master";
        }
      }

      if (!res.ok) {
        return { path, error: "FETCH_FAILED", status: res.status, message: res.statusText };
      }

      const text = await res.text();
      const lines = text.split("\n");
      const total_lines = lines.length;

      let returnedContent = text;
      let truncated = false;

      if (Array.isArray(args.line_range) && args.line_range.length === 2) {
        let start = Math.floor(args.line_range[0]!);
        let end = Math.floor(args.line_range[1]!);
        if (start > end) [start, end] = [end, start];
        start = Math.max(1, start);
        end = Math.min(total_lines, end);

        returnedContent = lines.slice(start - 1, end).join("\n");
        truncated = start > 1 || end < total_lines;
      } else if (total_lines > ctx.maxReadLines) {
        returnedContent = lines.slice(0, ctx.maxReadLines).join("\n");
        truncated = true;
      }

      return { path, branch: targetBranch, total_lines, truncated, content: returnedContent };
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

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
