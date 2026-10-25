/**
 * @weavetab/plugin-github
 * Official Weavetab GitHub plugin — repository analysis, raw file reads, issue
 * search/inspection and pull request inspection over the GitHub REST API.
 *
 * All GitHub data is fetched over HTTP, so no browser turns are consumed and the
 * active tab is never navigated or mutated.
 *
 * Author: fy2ne
 * License: MIT
 */

import { definePlugin, defineTool, z, type PluginContext } from "@weavetab/sdk";
import { runGithub } from "./github.js";
import type { GithubToolArgs } from "./types.js";

export * from "./types.js";
export { runGithub } from "./github.js";

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_READ_LINES = 200;
const DEFAULT_ISSUE_LIMIT = 5;

const TOOL_DESCRIPTION =
  "Interact with GitHub repositories without burning browser turns. " +
  "Analyze a repo's file tree and README, read raw source files, list/search/inspect issues, " +
  "and examine pull request details, changed files and comments — all fetched over the GitHub REST API.";

/** Coerce a possibly-string config value into a positive integer. */
function positiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? parseInt(value, 10) : (value as number);
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const githubPlugin = definePlugin({
  name: "@weavetab/plugin-github",
  version: "1.0.1",
  description:
    "Official Weavetab GitHub plugin — analyze repositories, read raw source, inspect issues and pull requests over the GitHub API.",

  defaultConfig: {
    cacheTtlMs: DEFAULT_CACHE_TTL_MS,
    maxReadLines: DEFAULT_MAX_READ_LINES,
    defaultIssueLimit: DEFAULT_ISSUE_LIMIT,
  },

  async onLoad(ctx: PluginContext): Promise<void> {
    const cacheTtlMs = positiveInt(ctx.config?.cacheTtlMs, DEFAULT_CACHE_TTL_MS);
    const maxReadLines = positiveInt(ctx.config?.maxReadLines, DEFAULT_MAX_READ_LINES);
    const defaultIssueLimit = positiveInt(ctx.config?.defaultIssueLimit, DEFAULT_ISSUE_LIMIT);

    ctx.mcp.registerTool(
      defineTool({
        name: "plugin_github",
        description: TOOL_DESCRIPTION,
        requiresSession: false,
        schema: {
          action: z
            .enum(["analyze", "read", "issues", "pr"])
            .describe(
              "The GitHub operation to perform. 'analyze' = repo metadata, file tree & README; 'read' = raw file contents (needs 'paths'); 'issues' = list/search/inspect issues; 'pr' = list/inspect pull requests."
            ),
          repo: z
            .string()
            .optional()
            .describe(
              "Target repository as 'owner/repo' or a full github.com URL. Optional — when omitted, it is inferred from the active browser tab."
            ),
          paths: z
            .array(z.string())
            .optional()
            .describe("READ: file paths relative to the repo root, e.g. ['src/index.ts', 'README.md']."),
          line_range: z
            .array(z.number())
            .length(2)
            .optional()
            .describe("READ: optional [start, end] 1-indexed line range per file."),
          number: z
            .number()
            .optional()
            .describe("ISSUES / PR: issue or pull request number to fetch full detail and comments."),
          search: z
            .string()
            .optional()
            .describe("ISSUES: free-text query to search issues in the target repository."),
          labels: z.array(z.string()).optional().describe("ISSUES: restrict results to these labels."),
          state: z
            .enum(["open", "closed", "all"])
            .optional()
            .describe("ISSUES / PR: filter by state."),
          limit: z
            .number()
            .optional()
            .describe(
              `ISSUES / PR: max items to return when listing/searching (default ${DEFAULT_ISSUE_LIMIT} for issues, 10 for pull requests).`
            ),
        },
        handler: async (args, session) => {
          const result = await runGithub(
            {
              session: session as any,
              store: ctx.storage,
              cacheTtlMs,
              maxReadLines,
              defaultIssueLimit,
            },
            args as GithubToolArgs
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        },
      })
    );

    ctx.logger?.info(
      `@weavetab/plugin-github ready — tool "plugin_github" registered (cacheTtlMs=${cacheTtlMs}, maxReadLines=${maxReadLines}, defaultIssueLimit=${defaultIssueLimit}).`
    );
  },

  async onUnload(ctx: PluginContext): Promise<void> {
    ctx.logger?.info("@weavetab/plugin-github unloaded.");
  },
});

export default githubPlugin;
export const plugin = githubPlugin;
