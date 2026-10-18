import type { CdpSession, GithubError, RepoContext } from "./types.js";

/**
 * Parse a repo slug from a string that can be:
 *  - "owner/repo"
 *  - "https://github.com/owner/repo[/anything]"
 *
 * Returns null (instead of throwing) for any non-string input so callers never
 * encounter `TypeError: slug.trim is not a function`.
 */
export function parseRepoSlug(slug: unknown): RepoContext | null {
  // Runtime guard: MCP argument dispatch can forward an object / number / null
  // when the model omits the field in some call patterns.
  if (typeof slug !== "string") return null;

  const trimmed = slug.trim();
  if (!trimmed) return null;

  // Full GitHub URL
  try {
    const u = new URL(trimmed);
    if (u.hostname === "github.com" || u.hostname === "www.github.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return { owner: parts[0]!, repo: parts[1]! };
    }
  } catch {
    /* not a URL — fall through to shorthand parse */
  }

  // "owner/repo" shorthand
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length >= 2) return { owner: parts[0]!, repo: parts[1]! };
  return null;
}

/**
 * Resolve the current GitHub repository target.
 *
 * @param session  - CDP session used only to read the active tab URL.
 * @param repoSlug - Optional "owner/repo" or full GitHub URL. When provided, it
 *                   is used directly and the active tab is never read or mutated.
 *
 * GitHub data is always fetched over HTTP, so the active tab is never navigated.
 */
export async function getRepoContext(
  session: CdpSession | undefined,
  repoSlug?: unknown
): Promise<RepoContext | GithubError> {
  const slugStr =
    typeof repoSlug === "string" && repoSlug.trim() !== "" ? repoSlug.trim() : undefined;

  // Explicit slug wins over the current tab URL.
  if (slugStr) {
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
        "No active browser session. Pass a 'repo' argument (e.g. \"owner/repo\") or open a github.com repository in the browser.",
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

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { error: "INVALID_URL", message: "Active tab URL is invalid." };
  }

  if (url.hostname !== "github.com") {
    return {
      error: "NOT_ON_GITHUB_REPO",
      message:
        "Navigate to a GitHub repository first, or pass a 'repo' argument (e.g. \"owner/repo\").",
    };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return {
      error: "NOT_ON_GITHUB_REPO",
      message: "Navigate to a specific GitHub repository first (e.g. github.com/owner/repo).",
    };
  }

  return { owner: parts[0]!, repo: parts[1]! };
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
