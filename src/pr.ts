import type { GithubRunContext, GithubPullRequestArgs } from "./types.js";
import { getDetailedRepoContext, isGithubError } from "./repoContext.js";
import { canMakeApiCall, handleApiResponse, getApiHeaders } from "./rateLimiter.js";

const DEFAULT_PR_LIMIT = 10;

/**
 * `pull_request` action — inspect a single pull request (changed files, diff stats and
 * comments) when `number` is given or active in tab, otherwise list recent pull requests.
 */
export async function githubPullRequest(
  ctx: GithubRunContext,
  args: GithubPullRequestArgs = {}
): Promise<any> {
  const context = await getDetailedRepoContext(ctx.session, args.repo);
  if (isGithubError(context)) return context;

  const { owner, repo } = context;
  const targetNumber = typeof args.number === "number" ? args.number : context.pullNumber;
  const apiHeaders = getApiHeaders(ctx.token);

  const rateLimitCheck = canMakeApiCall();
  if (isGithubError(rateLimitCheck)) return rateLimitCheck;

  if (targetNumber) {
    const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${targetNumber}`, {
      headers: apiHeaders,
    });
    const handledPrRes = handleApiResponse(prRes);
    if (isGithubError(handledPrRes)) return handledPrRes;

    if (!prRes.ok) {
      return {
        error: "FETCH_FAILED",
        status: prRes.status,
        message: `Failed to fetch PR #${targetNumber}`,
      };
    }

    const prData: any = await prRes.json();

    let files_changed: string[] = [];
    const rateLimitCheck2 = canMakeApiCall();
    if (!isGithubError(rateLimitCheck2)) {
      const filesRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${targetNumber}/files`,
        { headers: apiHeaders }
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
          `https://api.github.com/repos/${owner}/${repo}/issues/${targetNumber}/comments`,
          { headers: apiHeaders }
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
    { headers: apiHeaders }
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

export const githubGetPr = githubPullRequest;
