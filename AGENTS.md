# GitHub Plugin — Agent Playbook

Official GitHub intelligence plugin for Weavetab (`@weavetab/plugin-github`).

## MCP Tools
- `github_analyze`: Fetch repo metadata, default branch, file tree, and README (`repo`).
- `github_read`: Read raw files via CDN with zero REST API quota (`repo`, `paths`, `branch`, `line_range`).
- `github_issues`: List, search, or inspect issues + comments (`repo`, `number`, `search`, `labels`, `state`).
- `github_pull_request`: Inspect a PR or list recent PRs (`repo`, `number`, `state`, `limit`).
- `github_diff`: Fetch raw `.diff` or `.patch` with zero REST API quota (`repo`, `pull_number`, `commit_sha`, `base`, `head`).
- `github_active_tab`: Extract repo/PR/issue/blob state from an active `github.com` browser tab via CDP (`scope`).

## CLI Commands (`weavetab plugin use github <cmd>`)
- `weavetab plugin use github repo-summary --repo <owner/repo>`: Fetch repository summary and file tree.
- `weavetab plugin use github pr-diff --repo <owner/repo> --pull_number <n>`: Fetch unified diff and stats for a PR.
- `weavetab plugin use github issue-search --repo <owner/repo> --query <text>`: Search repository issues via CLI.

## Utilities (`/` Prompts & `@` Resources)
- `/pr-review`: Structured pull request security and regression review workflow.
- `/issue-triage`: Triage an issue, diagnose root cause, and synthesize fix plan.
- `@github://ratelimit`: Live GitHub REST API quota status.
- `@github://context`: Active tab GitHub DOM state (repo, branch, open PR, or issue).
