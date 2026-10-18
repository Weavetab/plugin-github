import type { GithubError, GithubRepoCache, GithubRunContext, TreeEntry } from "./types.js";
import { getRepoContext, isGithubError } from "./repoContext.js";
import { loadRepoCache, saveRepoCache } from "./cache.js";
import { canMakeApiCall, handleApiResponse } from "./rateLimiter.js";

const README_CANDIDATES = ["README.md", "README", "readme.md", "Readme.md", "README.txt"];

const API_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "Weavetab-GitHub-Plugin",
};

/**
 * `analyze` action — repository metadata, recursive default-branch file tree and
 * a README snippet. Results are cached in the plugin's isolated storage.
 */
export async function githubAnalyze(
  ctx: GithubRunContext,
  repoSlug?: unknown
): Promise<GithubRepoCache | GithubError> {
  const context = await getRepoContext(ctx.session, repoSlug);
  if (isGithubError(context)) return context;

  const { owner, repo } = context;

  const cached = await loadRepoCache(owner, repo, ctx.store, ctx.cacheTtlMs);
  if (cached) return cached;

  const rateLimitCheck = canMakeApiCall();
  if (isGithubError(rateLimitCheck)) return rateLimitCheck;

  // 1. Repo metadata
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: API_HEADERS,
  });

  const handledRepoRes = handleApiResponse(repoRes);
  if (isGithubError(handledRepoRes)) return handledRepoRes;

  if (repoRes.status === 404) {
    return {
      error: "REPO_NOT_FOUND",
      message:
        "Repository not found or not accessible. Note: only public repositories are supported.",
    };
  }

  if (!repoRes.ok) {
    return { error: "API_ERROR", message: `GitHub API error: ${repoRes.statusText}` };
  }

  const repoData: any = await repoRes.json();
  const default_branch: string = repoData.default_branch || "main";
  const description: string | null = repoData.description || null;
  const language: string | null = repoData.language || null;

  // 2. Recursive file tree
  const rateLimitCheck2 = canMakeApiCall();
  if (isGithubError(rateLimitCheck2)) return rateLimitCheck2;

  let file_tree: TreeEntry[] = [];
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${default_branch}?recursive=1`,
    { headers: API_HEADERS }
  );

  const handledTreeRes = handleApiResponse(treeRes);
  if (isGithubError(handledTreeRes)) return handledTreeRes;

  if (treeRes.ok) {
    const treeData: any = await treeRes.json();
    if (Array.isArray(treeData.tree)) {
      // Flat structure — compact and easy to grep.
      file_tree = treeData.tree.map((t: any) => ({
        path: t.path,
        mode: t.mode,
        type: t.type,
        sha: t.sha,
        size: t.size,
        url: t.url,
      }));
    }
  }

  // 3. README snippet (first 100 lines)
  let readme_snippet = "";
  const readmeEntry = file_tree.find((f) => README_CANDIDATES.includes(f.path));
  if (readmeEntry) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${default_branch}/${readmeEntry.path}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const rawRes = await fetch(rawUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (rawRes.ok) {
        const lines = (await rawRes.text()).split("\n");
        readme_snippet = lines.slice(0, 100).join("\n");
        if (lines.length > 100) readme_snippet += "\n\n... (truncated)";
      }
    } catch {
      /* best-effort — README is optional */
    }
  }

  const cacheData: GithubRepoCache = {
    owner,
    repo,
    default_branch,
    description,
    language,
    file_tree,
    readme_snippet,
    analyzed_at: Date.now(),
  };

  await saveRepoCache(cacheData, ctx.store);
  return cacheData;
}
