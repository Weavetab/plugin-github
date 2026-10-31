/**
 * @weavetab/plugin-github
 * Official Weavetab GitHub plugin — modular GitHub tools with zero-API options.
 *
 * All GitHub data is fetched over HTTP or directly via active tab DOM evaluation,
 * so browser turns and rate-limited API quotas are minimized.
 *
 * Author: fy2ne
 * License: MIT
 */

import { definePlugin, defineTool, z, type PluginContext } from "@weavetab/sdk";
import {
  githubAnalyze,
  githubRead,
  githubIssues,
  githubPullRequest,
  githubDiff,
  githubActiveTab,
  runGithub,
} from "./github.js";
import type {
  GithubAnalyzeArgs,
  GithubReadArgs,
  GithubIssuesArgs,
  GithubPullRequestArgs,
  GithubDiffArgs,
  GithubActiveTabArgs,
  GithubRunContext,
} from "./types.js";

export * from "./types.js";
export * from "./github.js";

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_READ_LINES = 200;
const DEFAULT_ISSUE_LIMIT = 5;

function positiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? parseInt(value, 10) : (value as number);
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function buildRunContext(ctx: PluginContext, session: unknown): GithubRunContext {
  return {
    session: session as any,
    store: ctx.storage,
    cacheTtlMs: positiveInt(ctx.config?.cacheTtlMs, DEFAULT_CACHE_TTL_MS),
    maxReadLines: positiveInt(ctx.config?.maxReadLines, DEFAULT_MAX_READ_LINES),
    defaultIssueLimit: positiveInt(ctx.config?.defaultIssueLimit, DEFAULT_ISSUE_LIMIT),
    token: (ctx.config?.token as string) || process.env.GITHUB_TOKEN,
  };
}

export const githubPlugin = definePlugin({
  name: "@weavetab/plugin-github",
  version: "1.1.0",
  description:
    "Official Weavetab GitHub plugin — modular repository analysis, raw source reads, issues, pull requests, raw diffs, and active-tab DOM inspection.",

  defaultConfig: {
    cacheTtlMs: DEFAULT_CACHE_TTL_MS,
    maxReadLines: DEFAULT_MAX_READ_LINES,
    defaultIssueLimit: DEFAULT_ISSUE_LIMIT,
  },

  async onLoad(ctx: PluginContext): Promise<void> {
    // 1. github_analyze
    ctx.mcp.registerTool(
      defineTool({
        name: "github_analyze",
        description:
          "Analyze a GitHub repository's metadata, default branch, recursive file tree, and README snippet over the GitHub REST API without burning browser turns.",
        requiresSession: false,
        schema: {
          repo: z
            .string()
            .optional()
            .describe(
              "Target repository as 'owner/repo' or full github.com URL. When omitted, inferred from the active browser tab."
            ),
        },
        handler: async (args, session) => {
          const runCtx = buildRunContext(ctx, session);
          const result = await githubAnalyze(runCtx, (args as GithubAnalyzeArgs).repo);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
      })
    );

    // 2. github_read
    ctx.mcp.registerTool(
      defineTool({
        name: "github_read",
        description:
          "Fetch raw source files from a GitHub repository directly over HTTP without burning browser turns or API search quota.",
        requiresSession: false,
        schema: {
          paths: z
            .array(z.string())
            .optional()
            .describe(
              "File paths relative to the repository root, e.g. ['src/index.ts', 'README.md']. When omitted, inferred from active tab if viewing a file blob."
            ),
          repo: z
            .string()
            .optional()
            .describe(
              "Target repository as 'owner/repo' or full github.com URL. Optional — inferred from active tab if omitted."
            ),
          branch: z
            .string()
            .optional()
            .describe(
              "Target branch or tag (defaults to 'main' or cached default branch). Avoids API discovery calls."
            ),
          line_range: z
            .array(z.number())
            .length(2)
            .optional()
            .describe("Optional [start, end] 1-indexed line range to return per file."),
        },
        handler: async (args, session) => {
          const runCtx = buildRunContext(ctx, session);
          const result = await githubRead(runCtx, args as GithubReadArgs);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
      })
    );

    // 3. github_issues
    ctx.mcp.registerTool(
      defineTool({
        name: "github_issues",
        description:
          "List, search, or inspect issues and comments in a GitHub repository without burning browser turns.",
        requiresSession: false,
        schema: {
          repo: z
            .string()
            .optional()
            .describe("Target repository as 'owner/repo' or full github.com URL."),
          number: z
            .number()
            .optional()
            .describe("Specific issue number to fetch full details and timeline comments for."),
          search: z
            .string()
            .optional()
            .describe("Free-text query to search issues in the repository."),
          labels: z.array(z.string()).optional().describe("Restrict results to these labels."),
          state: z
            .enum(["open", "closed", "all"])
            .optional()
            .describe("Filter by issue state (default 'open')."),
          limit: z
            .number()
            .optional()
            .describe("Maximum number of issues to return (default 5)."),
        },
        handler: async (args, session) => {
          const runCtx = buildRunContext(ctx, session);
          const result = await githubIssues(runCtx, args as GithubIssuesArgs);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
      })
    );

    // 4. github_pull_request
    ctx.mcp.registerTool(
      defineTool({
        name: "github_pull_request",
        description:
          "Examine pull request details, changed files, diff stats, and comments, or list recent pull requests in a GitHub repository without burning browser turns.",
        requiresSession: false,
        schema: {
          repo: z
            .string()
            .optional()
            .describe("Target repository as 'owner/repo' or full github.com URL."),
          number: z
            .number()
            .optional()
            .describe("Pull request number to fetch full detail, changed files, and comments for."),
          state: z
            .enum(["open", "closed", "all"])
            .optional()
            .describe("Filter pull requests by state (default 'all' when listing)."),
          limit: z
            .number()
            .optional()
            .describe("Maximum pull requests to return when listing (default 10)."),
        },
        handler: async (args, session) => {
          const runCtx = buildRunContext(ctx, session);
          const result = await githubPullRequest(runCtx, args as GithubPullRequestArgs);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
      })
    );

    // 5. github_diff (Zero API Calls)
    ctx.mcp.registerTool(
      defineTool({
        name: "github_diff",
        description:
          "Fetch raw git diffs or patches for pull requests, commits, or branch comparisons directly from github.com without consuming REST API rate limits.",
        requiresSession: false,
        schema: {
          repo: z
            .string()
            .optional()
            .describe("Target repository as 'owner/repo' or full github.com URL."),
          pull_number: z.number().optional().describe("Pull request number to fetch the diff or patch for."),
          commit_sha: z.string().optional().describe("Commit SHA to fetch the diff or patch for."),
          base: z.string().optional().describe("Base branch/commit for compare diff (requires 'head')."),
          head: z.string().optional().describe("Head branch/commit for compare diff (requires 'base')."),
          format: z
            .enum(["diff", "patch"])
            .optional()
            .describe("Output format: 'diff' (unified diff) or 'patch' (git patch with metadata). Default 'diff'."),
        },
        handler: async (args, session) => {
          const runCtx = buildRunContext(ctx, session);
          const result = await githubDiff(runCtx, args as GithubDiffArgs);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
      })
    );

    // 6. github_active_tab (Zero API Calls, works on private repos via CDP)
    ctx.mcp.registerTool(
      defineTool({
        name: "github_active_tab",
        description:
          "Inspect the active browser tab on github.com via local CDP evaluation. Extracts repository overview, open PR/issue discussion, or file content directly from the browser DOM with ZERO API calls. Works on private repositories you are logged into.",
        requiresSession: true,
        schema: {
          scope: z
            .enum(["auto", "summary", "files", "comments", "raw"])
            .optional()
            .describe("Scope of data extraction from the page DOM (default 'auto')."),
        },
        handler: async (args, session) => {
          const runCtx = buildRunContext(ctx, session);
          const result = await githubActiveTab(runCtx, args as GithubActiveTabArgs);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
      })
    );

    ctx.logger?.info(
      `@weavetab/plugin-github ready — registered 6 tools: github_analyze, github_read, github_issues, github_pull_request, github_diff, github_active_tab.`
    );
  },

  async onUnload(ctx: PluginContext): Promise<void> {
    ctx.logger?.info("@weavetab/plugin-github unloaded.");
  },
});

export default githubPlugin;
export const plugin = githubPlugin;
