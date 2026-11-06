import {
  definePlugin,
  defineTool,
  defineCommand,
  definePrompt,
  defineResource,
  z,
  type PluginContext,
} from "@weavetab/sdk";
import type { GithubRunContext } from "./types.js";
import {
  runGithub,
  githubAnalyze,
  githubRead,
  githubIssues,
  githubPullRequest,
  githubGetPr,
  githubDiff,
  githubActiveTab,
} from "./github.js";

export * from "./types.js";
export * from "./github.js";
export * from "./repoContext.js";
export * from "./rateLimiter.js";
export * from "./cache.js";

function makeRunContext(rawCtx: any): GithubRunContext {
  const cfg = rawCtx?.config || {};
  const session = rawCtx?.tab?.session || rawCtx?.session || (rawCtx?.Runtime ? rawCtx : undefined);
  return {
    session,
    store: rawCtx?.storage || null,
    cacheTtlMs: typeof cfg.cacheTtlMs === "number" ? cfg.cacheTtlMs : 1800000,
    maxReadLines: typeof cfg.maxReadLines === "number" ? cfg.maxReadLines : 200,
    defaultIssueLimit: typeof cfg.defaultIssueLimit === "number" ? cfg.defaultIssueLimit : 5,
    token: (typeof cfg.token === "string" && cfg.token) || process.env.GITHUB_TOKEN || undefined,
  };
}

function wrapText(res: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
  };
}

export const repoSummaryCommand = defineCommand({
  name: "repo-summary",
  description: "Fetch repository metadata, default branch, file tree, and README snippet via CLI.",
  usage: "weavetab plugin use github repo-summary --repo <owner/repo>",
  requiresSession: false,
  schema: {
    repo: z.string().describe("Repository in 'owner/repo' format or full GitHub URL"),
  },
  handler: async (args: { repo: string }, ctx: any) => {
    return await githubAnalyze(makeRunContext(ctx), args.repo);
  },
});

export const prDiffCommand = defineCommand({
  name: "pr-diff",
  description: "Fetch unified diff and stats for a pull request directly from GitHub without API quota.",
  usage: "weavetab plugin use github pr-diff --repo <owner/repo> --pull_number <n>",
  requiresSession: false,
  schema: {
    repo: z.string().describe("Repository in 'owner/repo' format"),
    pull_number: z.number().describe("Pull request number"),
  },
  handler: async (args: { repo: string; pull_number: number }, ctx: any) => {
    return await githubDiff(makeRunContext(ctx), {
      repo: args.repo,
      pull_number: Number(args.pull_number),
      format: "diff",
    });
  },
});

export const issueSearchCommand = defineCommand({
  name: "issue-search",
  description: "Search open or closed repository issues by keyword directly via CLI.",
  usage: "weavetab plugin use github issue-search --repo <owner/repo> --query <text>",
  requiresSession: false,
  schema: {
    repo: z.string().describe("Repository in 'owner/repo' format"),
    query: z.string().describe("Keywords to search"),
    limit: z.number().optional().describe("Max issues to return (default 5)"),
  },
  handler: async (args: { repo: string; query: string; limit?: number }, ctx: any) => {
    return await githubIssues(makeRunContext(ctx), {
      repo: args.repo,
      search: args.query,
      limit: args.limit ?? 5,
    });
  },
});

export const prReviewPrompt = definePrompt({
  name: "pr-review",
  description: "Structured pull request review prompt for security, performance, and regression analysis.",
  arguments: {
    repo: z.string().describe("Repository in owner/repo format"),
    pr: z.string().describe("Pull request number"),
  },
  handler: async ({ repo, pr }: { repo: string; pr: string }) =>
    `Review PR #${pr} in ${repo}. Call \`github_diff\` with \`repo: "${repo}", pull_number: ${pr}\`, then audit for security flaws, edge-case regressions, and breaking API changes.`,
});

export const issueTriagePrompt = definePrompt({
  name: "issue-triage",
  description: "Structured issue triage prompt to diagnose root cause and plan implementation.",
  arguments: {
    repo: z.string().describe("Repository in owner/repo format"),
    issue: z.string().describe("Issue number"),
  },
  handler: async ({ repo, issue }: { repo: string; issue: string }) =>
    `Triage issue #${issue} in ${repo}. Call \`github_issues\` with \`repo: "${repo}", number: ${issue}\` to inspect problem description and comments, identify target files, and plan the fix.`,
});

export const githubRateLimitResource = defineResource({
  name: "github-ratelimit",
  uri: "github://ratelimit",
  description: "Current GitHub REST API rate-limit budget and quota status.",
  mimeType: "application/json",
  read: async () => {
    const { getRateLimitStatus } = await import("./rateLimiter.js");
    return JSON.stringify(getRateLimitStatus(), null, 2);
  },
});

export const githubContextResource = defineResource({
  name: "github-context",
  uri: "github://context",
  description: "Active tab GitHub DOM context (current repository, branch, open PR, or issue metadata).",
  mimeType: "application/json",
  read: async (_uri: string, _vars: Record<string, string | string[]>, rawCtx: any) => {
    const runCtx = makeRunContext(rawCtx);
    if (!runCtx.session) {
      return JSON.stringify({ error: "no_active_session", message: "Attach an active browser tab on github.com to read DOM context." }, null, 2);
    }
    const tabState = await githubActiveTab(runCtx, { scope: "auto" });
    return JSON.stringify(tabState, null, 2);
  },
});

export const githubPlugin = definePlugin({
  name: "@weavetab/plugin-github",
  version: "1.3.0",
  description:
    "Official Weavetab GitHub plugin — modular repository analysis, raw source reads, issues, pull requests, raw diffs, CLI commands, and active-tab DOM inspection.",
  agentsMd: "AGENTS.md",
  defaultConfig: {
    cacheTtlMs: 1800000,
    maxReadLines: 200,
    defaultIssueLimit: 5,
  },
  permissions: {
    config: {
      read: true,
      write: true,
      reason: "Read and persist isolated plugin settings.",
    },
    cdp: {
      evaluate: true,
      reason: "Reads URL and DOM on github.com without navigating or mutating.",
    },
    network: {
      domains: ["api.github.com", "raw.githubusercontent.com", "github.com"],
      reason: "Fetches repository metadata, issues, PRs, raw files, and diffs from GitHub.",
    },
    tools: {
      add: true,
      reason: "Registers the 6 modular github_* MCP tools.",
    },
    commands: {
      add: true,
      reason: "Registers repo-summary and pr-diff CLI commands.",
    },
    prompts: {
      add: true,
      reason: "Registers /pr-review prompt utility.",
    },
    resources: {
      add: true,
      reason: "Registers @github://ratelimit resource utility.",
    },
  },
  commands: [repoSummaryCommand, prDiffCommand],
  prompts: [prReviewPrompt],
  resources: [githubRateLimitResource],

  async onLoad(ctx: PluginContext): Promise<void> {
    ctx.mcp.registerTool(
      defineTool({
        name: "github_analyze",
        description:
          "High-level repository reconnaissance: metadata, default branch, recursive file tree, and README preview. Results are cached in isolated storage.",
        requiresSession: false,
        schema: {
          repo: z.string().optional().describe("Repository in 'owner/repo' format or GitHub URL (inferred from active tab if omitted)."),
        },
        handler: async (args: { repo?: string }, rawCtx: any) => {
          const runCtx = makeRunContext(rawCtx || ctx);
          const res = await githubAnalyze(runCtx, args.repo);
          return wrapText(res);
        },
      })
    );

    ctx.mcp.registerTool(
      defineTool({
        name: "github_read",
        description:
          "Fetch raw file contents from raw.githubusercontent.com with zero REST API quota consumption.",
        requiresSession: false,
        schema: {
          repo: z.string().optional().describe("Repository in 'owner/repo' format or GitHub URL."),
          paths: z.array(z.string()).optional().describe("File paths relative to repository root."),
          branch: z.string().optional().describe("Target branch or tag (defaults to cached default branch or 'main')."),
          line_range: z.array(z.number()).optional().describe("Optional [start, end] 1-indexed line slice."),
        },
        handler: async (args: any, rawCtx: any) => {
          const runCtx = makeRunContext(rawCtx || ctx);
          const res = await githubRead(runCtx, args);
          return wrapText(res);
        },
      })
    );

    ctx.mcp.registerTool(
      defineTool({
        name: "github_issues",
        description: "Inspect a single issue with comments or list/search repository issues.",
        requiresSession: false,
        schema: {
          repo: z.string().optional().describe("Repository in 'owner/repo' format or GitHub URL."),
          number: z.number().optional().describe("Specific issue number to fetch with timeline comments."),
          search: z.string().optional().describe("Search query string for repository issues."),
          labels: z.array(z.string()).optional().describe("Filter by label names."),
          state: z.enum(["open", "closed", "all"]).optional().describe("Issue state filter."),
          limit: z.number().optional().describe("Max issues to return (default 5)."),
        },
        handler: async (args: any, rawCtx: any) => {
          const runCtx = makeRunContext(rawCtx || ctx);
          const res = await githubIssues(runCtx, args);
          return wrapText(res);
        },
      })
    );

    ctx.mcp.registerTool(
      defineTool({
        name: "github_pull_request",
        description: "Inspect a pull request (changed files, diff stats, comments) or list recent pull requests.",
        requiresSession: false,
        schema: {
          repo: z.string().optional().describe("Repository in 'owner/repo' format or GitHub URL."),
          number: z.number().optional().describe("Specific pull request number."),
          state: z.enum(["open", "closed", "all"]).optional().describe("PR state filter."),
          limit: z.number().optional().describe("Max PRs to return when listing (default 10)."),
        },
        handler: async (args: any, rawCtx: any) => {
          const runCtx = makeRunContext(rawCtx || ctx);
          const res = await githubPullRequest(runCtx, args);
          return wrapText(res);
        },
      })
    );

    ctx.mcp.registerTool(
      defineTool({
        name: "github_diff",
        description:
          "Fetch raw unified diffs or git patches directly from github.com with zero REST API quota usage.",
        requiresSession: false,
        schema: {
          repo: z.string().optional().describe("Repository in 'owner/repo' format or GitHub URL."),
          pull_number: z.number().optional().describe("Pull request number to fetch diff for."),
          commit_sha: z.string().optional().describe("Commit SHA to fetch diff for."),
          base: z.string().optional().describe("Base branch or commit for compare diff."),
          head: z.string().optional().describe("Head branch or commit for compare diff."),
          format: z.enum(["diff", "patch"]).optional().describe("Output format: 'diff' or 'patch'."),
        },
        handler: async (args: any, rawCtx: any) => {
          const runCtx = makeRunContext(rawCtx || ctx);
          const res = await githubDiff(runCtx, args);
          return wrapText(res);
        },
      })
    );

    ctx.mcp.registerTool(
      defineTool({
        name: "github_active_tab",
        description:
          "Extract structured repository, PR, issue, or blob state from the active github.com browser tab via local CDP.",
        requiresSession: true,
        schema: {
          scope: z.enum(["auto", "summary", "files", "comments", "raw"]).optional().describe("Extraction scope."),
        },
        handler: async (args: any, rawCtx: any) => {
          const runCtx = makeRunContext(rawCtx || ctx);
          const res = await githubActiveTab(runCtx, args);
          return wrapText(res);
        },
      })
    );

    ctx.cli?.registerCommand?.(repoSummaryCommand);
    ctx.cli?.registerCommand?.(prDiffCommand);
    ctx.cli?.registerCommand?.(issueSearchCommand);
    ctx.mcp?.registerPrompt?.(prReviewPrompt);
    ctx.mcp?.registerPrompt?.(issueTriagePrompt);
    ctx.mcp?.registerResource?.(githubRateLimitResource);
    ctx.mcp?.registerResource?.(githubContextResource);

    ctx.logger?.info("@weavetab/plugin-github loaded");
  },

  async onUnload(ctx: PluginContext): Promise<void> {
    ctx.logger?.info("@weavetab/plugin-github unloaded");
  },
});

export default githubPlugin;
export const plugin = githubPlugin;
