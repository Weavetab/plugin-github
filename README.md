# `@weavetab/plugin-github`

> Official [Weavetab](https://weavetab.dev) plugin that gives the agent first-class, modular GitHub
> access — analyze repositories, read raw source, search issues, examine pull requests, fetch raw diffs,
> and inspect active tabs directly — **without burning browser turns or API quota**.

[![Trust: Official](https://img.shields.io/badge/trust-official-1e3a8a.svg?style=flat-square)](https://weavetab.dev)
[![Engine: Weavetab ^2.5.2](https://img.shields.io/badge/engine-weavetab_%5E2.5.2-black.svg?style=flat-square)](https://weavetab.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## Why

GitHub capabilities ship as an official modular plugin rather than polluting the core server. The tools are cleanly separated into dedicated, descriptive MCP tools prefixed with `github_`.

In addition to standard GitHub REST capabilities, the plugin includes **quota-free tools** (`github_read` direct branch reads, `github_diff`, `github_active_tab`) that operate completely outside GitHub's unauthenticated 60 requests/hour REST API rate limit and support private repositories currently active in the user's browser.

## Install

```bash
weavetab plugin add github         # resolves to the official @weavetab/plugin-github
# or explicitly
weavetab plugin add @weavetab/plugin-github
```

Because the package name starts with `@weavetab/plugin-`, it is automatically treated as
**Official** — fully trusted, no verification prompt.

Restart the Weavetab MCP server to activate the tools.

## The Tools

### 1. `github_analyze`
High-level repository reconnaissance: metadata, default branch, recursive file tree, and README preview. Results are cached in isolated storage (configurable TTL).
- **Parameters**: `repo` *(optional, falls back to active tab URL)*.

### 2. `github_read` *(Zero REST API Quota)*
Fetch raw file contents from `raw.githubusercontent.com`.
- **Parameters**:
  - `paths` *(required)*: Array of file paths relative to repo root.
  - `repo` *(optional)*: Target repository slug or URL.
  - `branch` *(optional)*: Explicit branch/tag. Avoids API discovery calls.
  - `line_range` *(optional)*: `[start, end]` 1-indexed lines.

### 3. `github_issues`
Search, list, or inspect issues and timeline comments.
- **Parameters**:
  - `repo` *(optional)*: Target repository slug or URL.
  - `number` *(optional)*: Specific issue number for full details & comments.
  - `search` *(optional)*: Search query string.
  - `labels` *(optional)*: Filter by labels.
  - `state` *(optional)*: `open` · `closed` · `all`.
  - `limit` *(optional)*: Max issues to return (default `5`).

### 4. `github_pull_request`
Examine pull request details, changed files, diff stats, and comments, or list recent pull requests.
- **Parameters**:
  - `repo` *(optional)*: Target repository slug or URL.
  - `number` *(optional)*: PR number for full details & changed files list.
  - `state` *(optional)*: `open` · `closed` · `all`.
  - `limit` *(optional)*: Max PRs when listing (default `10`).

### 5. `github_diff` *(Zero API Quota)*
Fetch raw git diffs or patches directly from `github.com` without consuming REST API rate limits.
- **Parameters**:
  - `repo` *(optional)*: Target repository slug or URL.
  - `pull_number` *(optional)*: Pull request number to fetch diff or patch for.
  - `commit_sha` *(optional)*: Commit SHA to fetch diff or patch for.
  - `base` + `head` *(optional)*: Compare range.
  - `format` *(optional)*: `diff` (unified diff) or `patch` (git patch format). Default `diff`.

### 6. `github_active_tab` *(Zero API Quota & Private Repo Support)*
Inspect the active browser tab on `github.com` via local CDP evaluation. Extracts repository overview, open PR/issue discussion, or file content directly from the browser DOM with ZERO network or API calls.
- **Parameters**:
  - `scope` *(optional)*: `auto` · `summary` · `files` · `comments` · `raw`.

---

## Examples

```jsonc
// Analyze repository structure
github_analyze({ "repo": "weavetab/mcp" })

// Read file directly without consuming API rate limit
github_read({ "repo": "weavetab/mcp", "paths": ["src/index.ts"], "line_range": [1, 50] })

// Search issues by label
github_issues({ "repo": "weavetab/mcp", "labels": ["bug"], "state": "open" })

// Inspect Pull Request #42
github_pull_request({ "repo": "weavetab/mcp", "number": 42 })

// Fetch raw pull request diff (0 API quota used)
github_diff({ "repo": "weavetab/mcp", "pull_number": 42, "format": "diff" })

// Extract active GitHub tab data from browser DOM
github_active_tab({ "scope": "auto" })
```

---

## Configuration

Written to `~/.weavetab/plugins/@weavetab_plugin-github/config.json` on first load:

```json
{
  "cacheTtlMs": 1800000,
  "maxReadLines": 200,
  "defaultIssueLimit": 5,
  "token": ""
}
```

| Key | Default | Meaning |
|---|---|---|
| `cacheTtlMs` | `1800000` (30 min) | How long an `analyze` result stays cached. |
| `maxReadLines` | `200` | Max lines returned before truncation. |
| `defaultIssueLimit` | `5` | Default issue count limit. |
| `token` | `""` | Optional GitHub Personal Access Token (`GITHUB_TOKEN`), bumps rate limit from 60 to 5,000 req/hr. |

---

## Permissions

| Permission | Why |
|---|---|
| `config.read` / `config.write` | Read and persist isolated plugin settings. |
| `cdp.evaluate` | Reads URL and DOM on github.com without navigating or mutating. |
| `network.domains` | `api.github.com`, `raw.githubusercontent.com`, `github.com`. |
| `tools.add` | Registers the 6 `github_*` MCP tools. |
