import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import plugin, {
  githubPlugin,
  runGithub,
  githubAnalyze,
  githubRead,
  githubIssues,
  githubPullRequest,
  githubDiff,
  githubActiveTab,
} from "../dist/index.js";
import { parseRepoSlug, parseDetailedUrl, isGithubError } from "../dist/repoContext.js";
import { parseDiffStats } from "../dist/diff.js";
import { getRateLimitStatus } from "../dist/rateLimiter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "..", "weavetab.json"), "utf-8"));

/** Build a mock PluginContext tracking all registered tools. */
function makeMockContext() {
  const files = new Map();
  const registeredTools = new Map();

  const ctx = {
    name: plugin.name,
    pluginDir: "/tmp/weavetab-plugin-github",
    config: {},
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => false,
      getJSON: async (name) => (files.has(name) ? files.get(name) : null),
      setJSON: async (name, data) => {
        files.set(name, data);
      },
      getPath: (sub = "") => join("/tmp/weavetab-plugin-github", sub),
      list: async () => [],
    },
    mcp: {
      registerTool: (tool) => {
        registeredTools.set(tool.name, tool);
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };

  return { ctx, getTools: () => registeredTools, getTool: (name) => registeredTools.get(name) };
}

describe("@weavetab/plugin-github", () => {
  it("exposes a valid Weavetab plugin definition", () => {
    assert.equal(githubPlugin, plugin);
    assert.equal(plugin.name, "@weavetab/plugin-github");
    assert.equal(plugin.version, "1.1.0");
    assert.equal(typeof plugin.onLoad, "function");
    assert.equal(typeof plugin.onUnload, "function");
    assert.deepEqual(plugin.defaultConfig, {
      cacheTtlMs: 1800000,
      maxReadLines: 200,
      defaultIssueLimit: 5,
    });
  });

  it("ships a manifest with official trust and all 6 declared tools", () => {
    assert.equal(manifest.name, "@weavetab/plugin-github");
    assert.ok(manifest.name.startsWith("@weavetab/plugin-"), "must be an official plugin prefix");
    assert.equal(manifest.version, "1.1.0");
    assert.equal(manifest.entry, "dist/index.js");

    for (const [key, value] of Object.entries(manifest.permissions)) {
      if (value && typeof value === "object" && "reason" in value) {
        assert.equal(typeof value.reason, "string", `${key} reason must be a string`);
        assert.ok(value.reason.length > 0, `${key} reason must not be empty`);
      }
    }

    assert.ok(Array.isArray(manifest.tools));
    assert.equal(manifest.tools.length, 6);

    const toolNames = manifest.tools.map((t) => t.name);
    assert.deepEqual(toolNames.sort(), [
      "github_active_tab",
      "github_analyze",
      "github_diff",
      "github_issues",
      "github_pull_request",
      "github_read",
    ]);
  });

  it("registers all 6 modular tools with properly typed schemas", async () => {
    const { ctx, getTools, getTool } = makeMockContext();
    await plugin.onLoad(ctx);

    const tools = getTools();
    assert.equal(tools.size, 6);

    // 1. github_analyze
    const analyze = getTool("github_analyze");
    assert.ok(analyze);
    assert.ok(analyze.schema.repo);

    // 2. github_read
    const read = getTool("github_read");
    assert.ok(read);
    assert.ok(read.schema.paths);
    assert.ok(read.schema.branch);
    assert.ok(read.schema.line_range);

    // 3. github_issues
    const issues = getTool("github_issues");
    assert.ok(issues);
    assert.ok(issues.schema.number);
    assert.ok(issues.schema.search);
    assert.ok(issues.schema.state);

    // 4. github_pull_request
    const pr = getTool("github_pull_request");
    assert.ok(pr);
    assert.ok(pr.schema.number);
    assert.ok(pr.schema.state);

    // 5. github_diff
    const diff = getTool("github_diff");
    assert.ok(diff);
    assert.ok(diff.schema.pull_number);
    assert.ok(diff.schema.commit_sha);
    assert.ok(diff.schema.format);

    // 6. github_active_tab
    const tab = getTool("github_active_tab");
    assert.ok(tab);
    assert.equal(tab.requiresSession, true);
    assert.ok(tab.schema.scope);
  });

  it("parses 'owner/repo' shorthands and full GitHub URLs", () => {
    assert.deepEqual(parseRepoSlug("weavetab/plugin-github"), {
      owner: "weavetab",
      repo: "plugin-github",
    });
    assert.deepEqual(parseRepoSlug("https://github.com/weavetab/mcp/tree/main/docs"), {
      owner: "weavetab",
      repo: "mcp",
    });
    assert.equal(parseRepoSlug("not-a-repo"), null);
    assert.equal(parseRepoSlug(42), null);
    assert.equal(parseRepoSlug(null), null);
  });

  it("parses detailed route URLs into deep context objects", () => {
    const prCtx = parseDetailedUrl("https://github.com/weavetab/mcp/pull/42/files");
    assert.deepEqual(prCtx, {
      owner: "weavetab",
      repo: "mcp",
      section: "pull",
      pullNumber: 42,
    });

    const issueCtx = parseDetailedUrl("https://github.com/facebook/react/issues/1000");
    assert.deepEqual(issueCtx, {
      owner: "facebook",
      repo: "react",
      section: "issues",
      issueNumber: 1000,
    });

    const commitCtx = parseDetailedUrl("https://github.com/torvalds/linux/commit/8016e297");
    assert.deepEqual(commitCtx, {
      owner: "torvalds",
      repo: "linux",
      section: "commit",
      commitSha: "8016e297",
    });

    const blobCtx = parseDetailedUrl("https://github.com/weavetab/mcp/blob/dev/src/tools/burst.ts");
    assert.deepEqual(blobCtx, {
      owner: "weavetab",
      repo: "mcp",
      section: "blob",
      branch: "dev",
      filePath: "src/tools/burst.ts",
    });

    assert.equal(parseDetailedUrl("https://google.com"), null);
    assert.equal(parseDetailedUrl("invalid url"), null);
  });

  it("parseDiffStats extracts files, additions, and deletions from unified diffs", () => {
    const sampleDiff = `
diff --git a/src/index.ts b/src/index.ts
index abc..def 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
-const old = 1;
+const next = 2;
+const extra = 3;
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
-bad
+good
`.trim();

    const stats = parseDiffStats(sampleDiff);
    assert.deepEqual(stats.files_changed, ["src/index.ts", "README.md"]);
    assert.equal(stats.additions, 3);
    assert.equal(stats.deletions, 2);
  });

  it("github_diff returns MISSING_TARGET when no target is supplied or inferable", async () => {
    const res = await githubDiff(
      { store: null, cacheTtlMs: 1000, maxReadLines: 200, defaultIssueLimit: 5 },
      { repo: "weavetab/mcp" }
    );
    assert.ok(isGithubError(res));
    assert.equal(res.error, "MISSING_TARGET");
  });

  it("github_diff auto-infers pull_number from active tab URL", async () => {
    const mockSession = {
      Runtime: {
        evaluate: async () => ({
          result: { value: "https://github.com/weavetab/mcp/pull/99" },
        }),
      },
    };

    // Fails on fetch (network test repo doesn't exist), but verifies target was inferred
    const res = await githubDiff(
      { session: mockSession, store: null, cacheTtlMs: 1000, maxReadLines: 200, defaultIssueLimit: 5 },
      {}
    );
    // Should NOT be MISSING_TARGET because pull 99 was inferred from tab
    assert.notEqual(res?.error, "MISSING_TARGET");
  });

  it("github_read detects binary files without fetching text lines", async () => {
    const res = await githubRead(
      { store: null, cacheTtlMs: 1000, maxReadLines: 200, defaultIssueLimit: 5 },
      { repo: "weavetab/mcp", paths: ["logo.png", "icon.ico"] }
    );
    assert.ok(Array.isArray(res.files));
    assert.equal(res.files.length, 2);
    assert.equal(res.files[0].binary, true);
    assert.equal(res.files[1].binary, true);
  });

  it("github_read auto-infers filePath and branch when viewing a blob in active tab", async () => {
    const mockSession = {
      Runtime: {
        evaluate: async () => ({
          result: { value: "https://github.com/weavetab/mcp/blob/staging/logo.png" },
        }),
      },
    };

    const res = await githubRead(
      { session: mockSession, store: null, cacheTtlMs: 1000, maxReadLines: 200, defaultIssueLimit: 5 },
      {}
    );
    assert.ok(Array.isArray(res.files));
    assert.equal(res.files[0].path, "logo.png");
    assert.equal(res.files[0].branch, "staging");
    assert.equal(res.files[0].binary, true);
  });

  it("github_active_tab returns NO_ACTIVE_SESSION when session is absent", async () => {
    const res = await githubActiveTab(
      { store: null, cacheTtlMs: 1000, maxReadLines: 200, defaultIssueLimit: 5 },
      {}
    );
    assert.ok(isGithubError(res));
    assert.equal(res.error, "NO_ACTIVE_SESSION");
  });

  it("github_active_tab evaluates DOM properly with mock session", async () => {
    const mockSession = {
      Runtime: {
        evaluate: async () => ({
          result: {
            value: {
              url: "https://github.com/owner/test-repo/pull/42",
              owner: "owner",
              repo: "test-repo",
              page_type: "pull",
              number: 42,
              item_title: "Fix bug",
            },
          },
        }),
      },
    };

    const res = await githubActiveTab(
      { session: mockSession, store: null, cacheTtlMs: 1000, maxReadLines: 200, defaultIssueLimit: 5 },
      {}
    );
    assert.equal(res.owner, "owner");
    assert.equal(res.repo, "test-repo");
    assert.equal(res.number, 42);
  });

  it("rate limiter status reports correct limits", () => {
    const status = getRateLimitStatus();
    assert.ok(typeof status.remaining === "number");
    assert.ok(status.limit === 60 || status.limit === 5000);
  });

  it("legacy runGithub still dispatches actions correctly", async () => {
    const res = await runGithub(
      { store: null, cacheTtlMs: 1000, maxReadLines: 200, defaultIssueLimit: 5 },
      { action: "read" }
    );
    assert.ok(isGithubError(res));
    assert.equal(res.error, "MISSING_PATHS");
  });

  it("tool handlers wrap results as MCP text content", async () => {
    const { ctx, getTool } = makeMockContext();
    await plugin.onLoad(ctx);

    const diffTool = getTool("github_diff");
    const res = await diffTool.handler({ repo: "weavetab/mcp" }, undefined);
    assert.ok(Array.isArray(res.content));
    assert.equal(res.content[0].type, "text");
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.error, "MISSING_TARGET");
  });
});
