import type { GithubRunContext } from "./types.js";
import { getRepoContext, isGithubError } from "./repoContext.js";
import { canMakeApiCall, handleApiResponse } from "./rateLimiter.js";

interface PrArgs {
  repo?: string;
  number?: number;
  state?: "open" | "closed" | "all";
  limit?: number;
}

const DEFAULT_PR_LIMIT = 10;

const API_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "Weavetab-GitHub-Plugin",
};

/**
 * `pr` action — inspect a single pull request (changed files, diff stats and
 * comments) when `number` is given, otherwise list recent pull requests.
 */
export async function githubGetPr(ctx: GithubRunContext, args: PrArgs): Promise<any> {
  const context = await getRepoContext(ctx.session, args.repo);
  if (isGithubError(context)) return context;

  const { owner, repo } = context;

  const rateLimitCheck = canMakeApiCall();
  if (isGithubError(rateLimitCheck)) return rateLimitCheck;

  if (args.number) {
    const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${args.number}`, {
      headers: API_HEADERS,
    });
    const handledPrRes = handleApiResponse(prRes);
    if (isGithubError(handledPrRes)) return handledPrRes;

    if (!prRes.ok) {
      return {
        error: "FETCH_FAILED",
        status: prRes.status,
        message: `Failed to fetch PR #${args.number}`,
      };
    }

    const prData: any = await prRes.json();

    let files_changed: string[] = [];
    const rateLimitCheck2 = canMakeApiCall();
    if (!isGithubError(rateLimitCheck2)) {
      const filesRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${args.number}/files`,
        { headers: API_HEADERS }
      );
      const handledFilesRes = handleApiResponse(filesRes);
      if (!isGithubError(handledFilesRes) && filesRes.ok) {
        const filesData: any[] = await filesRes.json();
        files_changed = filesData.map((f: any) => f.filename);
      }
    }

    let comments: any[] = [];
    if (prData.comments > 0) {
      const rateLimitCheck3 = canMakeApiCall();
      if (!isGithubError(rateLimitCheck3)) {
        const commentsRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/issues/${args.number}/comments`,
          { headers: API_HEADERS }
        );
        const handledCommentsRes = handleApiResponse(commentsRes);
        if (!isGithubError(handledCommentsRes) && commentsRes.ok) {
          const commentsData: any[] = await commentsRes.json();
          comments = commentsData.map((c: any) => ({
            id: c.id,
            user: c.user?.login,
            body: c.body,
            created_at: c.created_at,
          }));
        }
      }
    }

    return {
      number: prData.number,
      title: prData.title,
      state: prData.state,
      user: prData.user?.login,
      body: prData.body,
      created_at: prData.created_at,
      merged: prData.merged,
      mergeable: prData.mergeable,
      additions: prData.additions,
      deletions: prData.deletions,
      changed_files: prData.changed_files,
      files: files_changed,
      comments,
    };
  }

  // List recent pull requests
  const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 100) : DEFAULT_PR_LIMIT;
  const state = args.state || "all";
  const listRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=${limit}`,
    { headers: API_HEADERS }
  );
  const handledListRes = handleApiResponse(listRes);
  if (isGithubError(handledListRes)) return handledListRes;

  if (!listRes.ok) {
    return { error: "FETCH_FAILED", status: listRes.status, message: "Failed to list PRs" };
  }

  const listData: any[] = await listRes.json();
  return listData.map((pr: any) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    user: pr.user?.login,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
  }));
}
