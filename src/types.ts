/**
 * Shared types for @weavetab/plugin-github.
 *
 * The plugin is intentionally decoupled from the Weavetab MCP internals: it only
 * depends on the minimal CDP surface it actually uses (`session.Runtime.evaluate`)
 * and on the isolated storage contract exposed by the plugin runtime.
 */

import type { PluginStorage } from "@weavetab/sdk";

/** Minimal CDP client surface used to read active tab URL and DOM. */
export interface CdpSession {
  Runtime: {
    evaluate(params: {
      expression: string;
      returnByValue?: boolean;
    }): Promise<{ result: { value: unknown } }>;
  };
}

/** A resolved GitHub repository target with optional deep route context. */
export interface RepoContext {
  owner: string;
  repo: string;
}

export interface DetailedRepoContext extends RepoContext {
  section?: "pull" | "issues" | "blob" | "tree" | "commit" | "releases" | string;
  issueNumber?: number;
  pullNumber?: number;
  commitSha?: string;
  branch?: string;
  filePath?: string;
}

/** Structured, non-throwing error returned to the MCP layer. */
export interface GithubError {
  error: string;
  message: string;
  [key: string]: unknown;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

/** Cached result of the `analyze` action. */
export interface GithubRepoCache {
  owner: string;
  repo: string;
  default_branch: string;
  description: string | null;
  language: string | null;
  file_tree: TreeEntry[];
  readme_snippet: string;
  analyzed_at: number;
}

/** Runtime dependencies injected into every GitHub action. */
export interface GithubRunContext {
  session?: CdpSession;
  store: PluginStorage;
  cacheTtlMs: number;
  maxReadLines: number;
  defaultIssueLimit: number;
  token?: string;
}

export interface GithubAnalyzeArgs {
  repo?: string;
}

export interface GithubReadArgs {
  repo?: string;
  paths?: string[];
  branch?: string;
  line_range?: number[];
}

export interface GithubIssuesArgs {
  repo?: string;
  number?: number;
  search?: string;
  labels?: string[];
  state?: "open" | "closed" | "all";
  limit?: number;
}

export interface GithubPullRequestArgs {
  repo?: string;
  number?: number;
  state?: "open" | "closed" | "all";
  limit?: number;
}

export interface GithubDiffArgs {
  repo?: string;
  pull_number?: number;
  commit_sha?: string;
  base?: string;
  head?: string;
  format?: "diff" | "patch";
}

export interface DiffStats {
  files_changed: string[];
  additions: number;
  deletions: number;
}

export interface GithubActiveTabArgs {
  scope?: "auto" | "summary" | "files" | "comments" | "raw";
}

/** Backwards-compatible legacy single tool argument shape. */
export interface GithubToolArgs {
  action: "analyze" | "read" | "issues" | "pr";
  repo?: string;
  paths?: string[];
  branch?: string;
  line_range?: number[];
  number?: number;
  search?: string;
  labels?: string[];
  state?: "open" | "closed" | "all";
  limit?: number;
}
