import type { GithubRunContext, GithubIssuesArgs } from "./types.js";
import { getDetailedRepoContext, isGithubError } from "./repoContext.js";
import { canMakeApiCall, handleApiResponse, getApiHeaders } from "./rateLimiter.js";

/**
 * `issues` action — inspect a single issue (with comments) when `number` is
 * given or open in the active tab, otherwise list or search issues.
 */
export async function githubIssues(ctx: GithubRunContext, args: GithubIssuesArgs = {}): Promise<any> {
  const context = await getDetailedRepoContext(ctx.session, args.repo);
  if (isGithubError(context)) return context;

  const { owner, repo } = context;
  const targetNumber = typeof args.number === "number" ? args.number : context.issueNumber;
  const limit = args.limit || ctx.defaultIssueLimit;
  const apiHeaders = getApiHeaders(ctx.token);

  const rateLimitCheck = canMakeApiCall();
  if (isGithubError(rateLimitCheck)) return rateLimitCheck;

  // Single issue + comments
  if (targetNumber) {
    const issueRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${targetNumber}`,
      { headers: apiHeaders }
    );
    const handledIssueRes = handleApiResponse(issueRes);
    if (isGithubError(handledIssueRes)) return handledIssueRes;

    if (!issueRes.ok) {
      return {
        error: "FETCH_FAILED",
        status: issueRes.status,
        message: `Failed to fetch issue #${targetNumber}`,
      };
    }

    const issueData: any = await issueRes.json();

    let comments: any[] = [];
    if (issueData.comments > 0) {
      const rateLimitCheck2 = canMakeApiCall();
      if (!isGithubError(rateLimitCheck2)) {
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
      number: issueData.number,
      title: issueData.title,
      state: issueData.state,
      user: issueData.user?.login,
      body: issueData.body,
      created_at: issueData.created_at,
      labels: issueData.labels?.map((l: any) => l.name),
      comments,
    };
  }

  // List or search issues
  let urlStr = `https://api.github.com/repos/${owner}/${repo}/issues?per_page=${limit}`;
  if (args.state) urlStr += `&state=${args.state}`;
  if (args.labels && args.labels.length > 0) urlStr += `&labels=${args.labels.join(",")}`;

  if (args.search) {
    let q = `repo:${owner}/${repo} is:issue ${args.search}`;
    if (args.state && args.state !== "all") q += ` is:${args.state}`;
    if (args.labels) args.labels.forEach((l) => (q += ` label:"${l}"`));
    urlStr = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${limit}`;
  }

  const listRes = await fetch(urlStr, { headers: apiHeaders });
  const handledListRes = handleApiResponse(listRes);
  if (isGithubError(handledListRes)) return handledListRes;

  if (!listRes.ok) {
    return { error: "FETCH_FAILED", status: listRes.status, message: "Failed to list/search issues" };
  }

  const listData: any = await listRes.json();
  const items: any[] = args.search ? listData.items : listData;

  return items.map((i: any) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    user: i.user?.login,
    labels: i.labels?.map((l: any) => l.name),
    created_at: i.created_at,
    comments_count: i.comments,
  }));
}
