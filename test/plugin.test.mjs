import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import plugin, { githubPlugin, runGithub } from "../dist/index.js";
import { parseRepoSlug, isGithubError } from "../dist/repoContext.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "..", "weavetab.json"), "utf-8"));

/** Build a mock PluginContext good enough for onLoad + handler paths. */
function makeMockContext() {
  const files = new Map();
  let registeredTool = null;

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
        registeredTool = tool;
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };

  return { ctx, getTool: () => registeredTool };
}

describe("@weavetab/plugin-github", () => {
  it("exposes a valid Weavetab plugin definition", () => {
    assert.equal(githubPlugin, plugin);
    assert.equal(plugin.name, "@weavetab/plugin-github");
    assert.equal(plugin.version, "1.0.1");
    assert.equal(typeof plugin.onLoad, "function");
    assert.equal(typeof plugin.onUnload, "function");
    assert.deepEqual(plugin.defaultConfig, {
      cacheTtlMs: 1800000,
      maxReadLines: 200,
      defaultIssueLimit: 5,
    });
  });

  it("ships a manifest whose name grants Official trust", () => {
    assert.equal(manifest.name, "@weavetab/plugin-github");
    assert.ok(manifest.name.startsWith("@weavetab/plugin-"), "must be an official plugin prefix");
    assert.equal(manifest.version, "1.0.1");
    assert.equal(manifest.entry, "dist/index.js");

    // Every declared permission must carry a human-readable reason.
    for (const [key, value] of Object.entries(manifest.permissions)) {
      if (value && typeof value === "object" && "reason" in value) {
        assert.equal(typeof value.reason, "string", `${key} reason must be a string`);
        assert.ok(value.reason.length > 0, `${key} reason must not be empty`);
      }
    }

    assert.ok(Array.isArray(manifest.tools) && manifest.tools.length === 1);
    assert.equal(manifest.tools[0].name, "plugin_github");
  });

  it("registers exactly one `plugin_github` tool with a fully wired schema", async () => {
    const { ctx, getTool } = makeMockContext();
    await plugin.onLoad(ctx);

    const tool = getTool();
    assert.ok(tool, "plugin_github tool must be registered during onLoad");
    assert.equal(tool.name, "plugin_github");
    assert.equal(typeof tool.handler, "function");

    const schema = tool.schema;
    for (const field of [
      "action",
      "repo",
      "paths",
      "line_range",
      "number",
      "search",
      "labels",
      "state",
      "limit",
    ]) {
      assert.ok(schema[field], `schema must declare '${field}'`);
    }

    // action is a required enum of the four operations
    assert.deepEqual(schema.action.parse("analyze"), "analyze");
    assert.throws(() => schema.action.parse("nope"));

    // line_range is an optional pair
    assert.deepEqual(schema.line_range.parse([1, 20]), [1, 20]);
    assert.throws(() => schema.line_range.parse([1, 2, 3]));
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

  it("returns a structured error for `read` without paths (no network)", async () => {
    const result = await runGithub(
      { store: null, cacheTtlMs: 1000, maxReadLines: 200, defaultIssueLimit: 5 },
      { action: "read" }
    );
    assert.ok(isGithubError(result));
    assert.equal(result.error, "MISSING_PATHS");
  });

  it("returns a structured error for an unparseable repo slug (no network)", async () => {
    const result = await runGithub(
      { store: null, cacheTtlMs: 1000, maxReadLines: 200, defaultIssueLimit: 5 },
      { action: "analyze", repo: "definitely not a repo" }
    );
    assert.ok(isGithubError(result));
    assert.equal(result.error, "INVALID_REPO_SLUG");
  });

  it("returns a structured error for an unknown action (no network)", async () => {
    const result = await runGithub(
      { store: null, cacheTtlMs: 1000, maxReadLines: 200, defaultIssueLimit: 5 },
      { action: "nope" }
    );
    assert.ok(isGithubError(result));
    assert.equal(result.error, "INVALID_ACTION");
  });

  it("handler wraps results as MCP text content", async () => {
    const { ctx, getTool } = makeMockContext();
    await plugin.onLoad(ctx);

    const res = await getTool().handler({ action: "read" }, undefined);
    assert.ok(Array.isArray(res.content));
    assert.equal(res.content[0].type, "text");
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.error, "MISSING_PATHS");
  });
});
