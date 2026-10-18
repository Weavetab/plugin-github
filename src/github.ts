import type { GithubError, GithubRunContext, GithubToolArgs } from "./types.js";
import { githubAnalyze } from "./analyze.js";
import { githubRead } from "./read.js";
import { githubIssues } from "./issues.js";
import { githubGetPr } from "./pr.js";

/**
 * Single entry point for the `github` MCP tool. Dispatches to the matching
 * action handler and funnels every result through a plain serializable value.
 */
export async function runGithub(
  ctx: GithubRunContext,
  args: GithubToolArgs
): Promise<any | GithubError> {
  switch (args.action) {
    case "analyze":
      return githubAnalyze(ctx, args.repo);

    case "read": {
      const paths = Array.isArray(args.paths) ? args.paths.filter((p) => typeof p === "string") : [];
      if (paths.length === 0) {
        return {
          error: "MISSING_PATHS",
          message: "action 'read' requires a 'paths' array with at least one file path.",
        };
      }
      return githubRead(ctx, { repo: args.repo, paths, line_range: args.line_range });
    }

    case "issues":
      return githubIssues(ctx, {
        repo: args.repo,
        search: args.search,
        number: args.number,
        labels: args.labels,
        state: args.state,
        limit: args.limit,
      });

    case "pr":
      return githubGetPr(ctx, { repo: args.repo, number: args.number, state: args.state, limit: args.limit });

    default:
      return {
        error: "INVALID_ACTION",
        message: `Unknown action: ${(args as any).action}. Must be 'analyze', 'read', 'issues', or 'pr'.`,
      };
  }
}

export { githubAnalyze, githubRead, githubIssues, githubGetPr };
