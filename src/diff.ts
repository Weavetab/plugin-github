import type { DiffStats, GithubDiffArgs, GithubError, GithubRunContext } from "./types.js";
import { getDetailedRepoContext, isGithubError } from "./repoContext.js";

/**
 * Extracts structured diff statistics from unified diff output.
 */
export function parseDiffStats(diffText: string): DiffStats {
  const files: string[] = [];
  let additions = 0;
  let deletions = 0;
  const lines = diffText.split("\n");

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/diff --git a\/(.+?)\s+b\/(.+)/);
      if (match && match[2]) {
        files.push(match[2]);
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  return {
    files_changed: Array.from(new Set(files)),
    additions,
    deletions,
  };
}

/**
 * `github_diff` — fetch raw git diffs or patches directly from github.com without
 * consuming any GitHub REST API rate-limited quota.
 */
export async function githubDiff(
  ctx: GithubRunContext,
  args: GithubDiffArgs = {}
): Promise<any | GithubError> {
  const context = await getDetailedRepoContext(ctx.session, args.repo);
  if (isGithubError(context)) return context;

  const { owner, repo } = context;
  const ext = args.format === "patch" ? "patch" : "diff";

  // Target resolution with tab auto-inference fallback
  const pullNumber = typeof args.pull_number === "number" ? args.pull_number : context.pullNumber;
  const commitSha =
    typeof args.commit_sha === "string" && args.commit_sha.trim()
      ? args.commit_sha.trim()
      : typeof pullNumber !== "number"
        ? context.commitSha
        : undefined;

  let targetUrl: string;

  if (typeof pullNumber === "number") {
    targetUrl = `https://github.com/${owner}/${repo}/pull/${pullNumber}.${ext}`;
  } else if (commitSha) {
    targetUrl = `https://github.com/${owner}/${repo}/commit/${commitSha}.${ext}`;
  } else if (args.base && args.head) {
    const base = args.base.trim();
    const head = args.head.trim();
    targetUrl = `https://github.com/${owner}/${repo}/compare/${base}...${head}.${ext}`;
  } else {
    return {
      error: "MISSING_TARGET",
      message:
        "github_diff requires 'pull_number', 'commit_sha', or 'base'+'head' (or navigate to a PR or commit in the active browser tab).",
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Weavetab-GitHub-Plugin",
      },
    });
    clearTimeout(timeout);

    if (res.status === 404) {
      return {
        error: "NOT_FOUND",
        message: `Resource not found at ${targetUrl}. Ensure the PR, commit, or compare range exists in ${owner}/${repo}.`,
      };
    }

    if (!res.ok) {
      return {
        error: "FETCH_FAILED",
        status: res.status,
        message: `HTTP ${res.status} while fetching diff from ${targetUrl}`,
      };
    }

    const text = await res.text();
    const lines = text.split("\n");
    const total_lines = lines.length;

    let content = text;
    let truncated = false;

    // Safeguard for very large diffs
    const maxLines = ctx.maxReadLines * 4;
    if (total_lines > maxLines) {
      content = lines.slice(0, maxLines).join("\n");
      truncated = true;
    }

    const stats = parseDiffStats(text);

    return {
      owner,
      repo,
      target_url: targetUrl,
      format: ext,
      total_lines,
      truncated,
      stats,
      diff: content,
    };
  } catch (err: any) {
    return {
      error: "FETCH_ERROR",
      message: err?.message || "Failed to fetch raw diff",
    };
  }
}
