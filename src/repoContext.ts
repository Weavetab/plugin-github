import type { CdpSession, DetailedRepoContext, GithubError, RepoContext } from "./types.js";

/**
 * Parses deep context from a GitHub URL string.
 */
export function parseDetailedUrl(urlStr: string): DetailedRepoContext | null {
  try {
    const u = new URL(urlStr);
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;

    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    const owner = parts[0]!;
    const repo = parts[1]!;
    const section = parts[2];

    const ctx: DetailedRepoContext = { owner, repo, section };

    if (!section) return ctx;

    if (section === "pull" && parts[3]) {
      const num = parseInt(parts[3], 10);
      if (!Number.isNaN(num)) ctx.pullNumber = num;
    } else if (section === "issues" && parts[3]) {
      const num = parseInt(parts[3], 10);
      if (!Number.isNaN(num)) ctx.issueNumber = num;
    } else if (section === "commit" && parts[3]) {
      ctx.commitSha = parts[3];
    } else if ((section === "blob" || section === "tree") && parts[3]) {
      ctx.branch = parts[3];
      if (parts.length > 4) {
        ctx.filePath = parts.slice(4).join("/");
      }
    }

    return ctx;
  } catch {
    return null;
  }
}

/**
 * Parse a repo slug or full URL into a basic RepoContext.
 */
export function parseRepoSlug(slug: unknown): RepoContext | null {
  if (typeof slug !== "string") return null;

  const trimmed = slug.trim();
  if (!trimmed) return null;

  // Try parsing full URL first
  const detailed = parseDetailedUrl(trimmed);
  if (detailed) return { owner: detailed.owner, repo: detailed.repo };

  // "owner/repo" shorthand
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length >= 2) return { owner: parts[0]!, repo: parts[1]! };
  return null;
}

/**
 * Resolve detailed GitHub repository and route context.
 */
export async function getDetailedRepoContext(
  session: CdpSession | undefined,
  repoSlug?: unknown
): Promise<DetailedRepoContext | GithubError> {
  const slugStr =
    typeof repoSlug === "string" && repoSlug.trim() !== "" ? repoSlug.trim() : undefined;

  if (slugStr) {
    const detailed = parseDetailedUrl(slugStr);
    if (detailed) return detailed;

    const parsed = parseRepoSlug(slugStr);
    if (!parsed) {
      return {
        error: "INVALID_REPO_SLUG",
        message: `Cannot parse a GitHub owner/repo from "${slugStr}". Use "owner/repo" or a full github.com URL.`,
      };
    }
    return parsed;
  }

  if (!session) {
    return {
      error: "NO_CONTEXT",
      message:
        "No active browser session. Pass a 'repo' argument (e.g. \"owner/repo\") or open a github.com page in the browser.",
    };
  }

  let urlStr: unknown;
  try {
    const { result } = await session.Runtime.evaluate({
      expression: "window.location.href",
      returnByValue: true,
    });
    urlStr = result.value;
  } catch {
    return {
      error: "CONTEXT_ERROR",
      message: "Failed to evaluate window.location.href on the active tab.",
    };
  }

  if (typeof urlStr !== "string" || !urlStr) {
    return { error: "CONTEXT_ERROR", message: "Active tab URL is empty." };
  }

  const detailed = parseDetailedUrl(urlStr);
  if (!detailed) {
    return {
      error: "NOT_ON_GITHUB_REPO",
      message: "Active tab is not on a GitHub repository page. Pass a 'repo' argument (e.g. \"owner/repo\").",
    };
  }

  return detailed;
}

/**
 * Resolve the current GitHub repository target.
 */
export async function getRepoContext(
  session: CdpSession | undefined,
  repoSlug?: unknown
): Promise<RepoContext | GithubError> {
  return getDetailedRepoContext(session, repoSlug);
}

export function isGithubError(result: unknown): result is GithubError {
  return (
    !!result &&
    typeof result === "object" &&
    "error" in result &&
    "message" in result &&
    typeof (result as GithubError).message === "string"
  );
}
