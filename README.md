# `@weavetab/plugin-github`

> Official [Weavetab](https://weavetab.dev) plugin that gives the agent first-class GitHub
> access — analyze repositories, read raw source, search and inspect issues, and examine pull
> requests — **without burning browser turns**.

[![Trust: Official](https://img.shields.io/badge/trust-official-1e3a8a.svg?style=flat-square)](https://weavetab.dev)
[![Engine: Weavetab ^2.5.1](https://img.shields.io/badge/engine-weavetab_%5E2.5.1-black.svg?style=flat-square)](https://weavetab.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## Why

GitHub support ships as an official plugin rather than a built-in tool: the core server stays lean
at **41 built-in tools**, and GitHub is delivered as the **independently versioned**
`@weavetab/plugin-github` package that can be installed, updated and removed like any other plugin.
It registers a single `plugin_github` tool (actions: `analyze`, `read`, `issues`, `pr`).

All GitHub data is fetched directly over HTTP (`api.github.com` / `raw.githubusercontent.com`),
so the active browser tab is **never navigated or mutated** and no browser turns are consumed.

## Install

```bash
weavetab plugin add github         # resolves to the official @weavetab/plugin-github
# or explicitly
weavetab plugin add @weavetab/plugin-github
```

Because the package name starts with `@weavetab/plugin-`, it is automatically treated as
**Official** — fully trusted, no verification prompt.

Restart the Weavetab MCP server to activate the tool.

## The `plugin_github` tool

A single, well-organized action-dispatch tool.

| Parameter | Applies to | Description |
|---|---|---|
| `action` *(required)* | all | `analyze` · `read` · `issues` · `pr` |
| `repo` | all | `owner/repo` or a full `github.com` URL. Omit to use the active tab's repo. |
| `paths` | `read` | File paths relative to the repo root. |
| `line_range` | `read` | Optional `[start, end]`, 1-indexed. |
| `number` | `issues`, `pr` | Issue / PR number for full detail + comments. |
| `search` | `issues` | Free-text query (GitHub Search API, scoped to the repo). |
| `labels` | `issues` | Restrict to issues carrying these labels. |
| `state` | `issues` | `open` · `closed` · `all` |
| `limit` | `issues` | Max issues returned (default `5`). |

### Actions

- **`analyze`** — repository metadata, recursive default-branch file tree, and a README snippet.
  Results are cached in the plugin's isolated storage (TTL configurable).
- **`read`** — raw contents of the requested `paths`, with optional line ranges and automatic
  truncation for large files.
- **`issues`** — inspect one issue with its comments (`number`), or list / search issues.
- **`pr`** — inspect one pull request with changed files, diff stats and comments (`number`),
  or list recent pull requests.

### Examples

```jsonc
// Analyze a repo
{ "action": "analyze", "repo": "weavetab/mcp" }

// Read two files, lines 1-40 of the first
{ "action": "read", "repo": "weavetab/mcp", "paths": ["src/index.ts", "README.md"], "line_range": [1, 40] }

// Search issues by label
{ "action": "issues", "repo": "weavetab/mcp", "search": "rate limit", "labels": ["bug"], "state": "open" }

// Inspect PR #42
{ "action": "pr", "repo": "weavetab/mcp", "number": 42 }
```

## Configuration

Written to `~/.weavetab/plugins/@weavetab_plugin-github/config.json` on first load:

```json
{
  "cacheTtlMs": 1800000,
  "maxReadLines": 200,
  "defaultIssueLimit": 5
}
```

| Key | Default | Meaning |
|---|---|---|
| `cacheTtlMs` | `1800000` (30 min) | How long an `analyze` result stays cached. |
| `maxReadLines` | `200` | Files longer than this are truncated when no `line_range` is given. |
| `defaultIssueLimit` | `5` | Default `limit` for the `issues` action. |

## Permissions

| Permission | Why |
|---|---|
| `config.read` / `config.write` | Read and persist isolated plugin settings. |
| `cdp.evaluate` | Read the active tab URL **only**, to infer the target repo when `repo` is omitted. |
| `network: api.github.com`, `raw.githubusercontent.com`, `github.com` | Fetch public repo data over HTTP. |
| `tools.add` | Register the single `plugin_github` tool. |

No filesystem access beyond the plugin's own sandbox, no HUD/overlay injection, no tab mutation.

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm test           # node:test manifest + schema + handler smoke tests
npm run dev        # tsc --watch
```

### Project layout

```text
plugin-github/
├── src/index.ts       # definePlugin + registerTool("plugin_github")
├── src/github.ts      # action dispatcher
├── src/{analyze,read,issues,pr}.ts
├── src/{repoContext,cache,rateLimiter,types}.ts
├── weavetab.json      # manifest (permissions + tool schema)
├── test/              # node:test smoke tests
└── dist/              # compiled output (generated)
```

> **Local development note.** Inside the Weavetab monorepo this package pins
> `"@weavetab/sdk": "file:../../sdk"` so it builds against the in-repo SDK. In the standalone
> published repository, pin the released SDK instead: `"@weavetab/sdk": "^2.5.1"`.

---

## License

MIT © [Weavetab](https://github.com/Weavetab) & [fy2ne](https://github.com/fy2ne)
