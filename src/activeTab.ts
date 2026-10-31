import type { GithubActiveTabArgs, GithubError, GithubRunContext } from "./types.js";

/**
 * `github_active_tab` — extract structured information from the active browser
 * tab when open on github.com.
 *
 * Runs entirely via local CDP evaluation with ZERO API calls. Works on both public
 * and private repositories that the user is authenticated to view in their browser.
 */
export async function githubActiveTab(
  ctx: GithubRunContext,
  args: GithubActiveTabArgs = {}
): Promise<any | GithubError> {
  const session = ctx.session;
  if (!session) {
    return {
      error: "NO_ACTIVE_SESSION",
      message: "No active browser session connected. Open a github.com page in Weavetab.",
    };
  }

  const requestedScope = args.scope || "auto";

  const evalExpression = `(() => {
    try {
      const url = new URL(window.location.href);
      if (!url.hostname.includes("github.com")) {
        return { error: "NOT_ON_GITHUB", message: "Active tab is not on github.com (" + url.hostname + ")" };
      }

      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length < 2) {
        return {
          url: url.href,
          page_type: "github_home_or_profile",
          title: document.title,
        };
      }

      const owner = parts[0];
      const repo = parts[1];
      const section = parts[2] || "root";
      const idOrBranch = parts[3] || "";
      const scope = ${JSON.stringify(requestedScope)};

      const res = {
        url: url.href,
        owner,
        repo,
        page_type: section === "root" ? "repo_overview" : section,
        title: document.title,
      };

      // Pull Request or Issue views
      if (section === "pull" || section === "issues") {
        const titleEl = document.querySelector("bdi.markdown-title, .gh-header-title, [data-testid='issue-title'], h1");
        const stateBadge = document.querySelector("[data-testid='state-label'], [data-testid='issue-state-badge'], .State, [data-state]");
        const bodyEl = document.querySelector("[data-testid='comment-body'], .comment-body");

        // Files scope on PR
        if (scope === "files") {
          const fileEls = Array.from(document.querySelectorAll("[data-tagsearch-path], [data-path], .file-header [data-path], .file-info a"));
          const changedFiles = Array.from(new Set(fileEls.map((el) => el.getAttribute("data-tagsearch-path") || el.getAttribute("data-path") || el.textContent?.trim()).filter(Boolean)));
          return {
            ...res,
            number: parseInt(idOrBranch, 10) || null,
            item_title: titleEl?.textContent?.replace(/\\s+/g, " ")?.trim(),
            files_count: changedFiles.length,
            files: changedFiles,
          };
        }

        const maxComments = scope === "comments" ? 50 : 5;
        const commentEls = Array.from(document.querySelectorAll("[data-testid='issue-comment-item'], .timeline-comment, .timeline-comment-group")).slice(0, maxComments);
        const comments = commentEls.map((el) => {
          const authorEl = el.querySelector("[data-testid='author-avatar-link'], a.author, .author");
          const body = el.querySelector("[data-testid='comment-body'], .comment-body");
          return {
            author: authorEl?.textContent?.trim() || "unknown",
            preview: (body?.textContent?.trim() || "").slice(0, 400),
          };
        });

        return {
          ...res,
          number: parseInt(idOrBranch, 10) || null,
          item_title: titleEl?.textContent?.replace(/\\s+/g, " ")?.trim(),
          state: stateBadge?.textContent?.trim(),
          body_preview: bodyEl?.textContent?.trim().slice(0, 1000),
          comments_count: comments.length,
          recent_comments: comments,
        };
      }

      // Blob code viewer
      if (section === "blob") {
        const path = parts.slice(4).join("/");
        const codeContainer = document.querySelector("#read-only-cursor-text-area, [data-target='react-app.embeddedData'], .blob-wrapper table, textarea[aria-label='file content']");
        const rawText = codeContainer ? codeContainer.textContent : document.querySelector("article, main")?.textContent;
        return {
          ...res,
          file_path: path,
          branch: idOrBranch,
          content_preview: (rawText || "").slice(0, 2000),
        };
      }

      // Default repo root overview
      const descEl = document.querySelector("p.f4, .BorderGrid-cell p, [data-testid='repo-description']");
      const readmeEl = document.querySelector("#readme article, [data-testid='readme'] article");
      return {
        ...res,
        description: descEl?.textContent?.trim() || null,
        readme_preview: readmeEl?.textContent?.trim().slice(0, 800) || null,
      };
    } catch (e) {
      return { error: "EVAL_ERROR", message: String(e) };
    }
  })()`;

  try {
    const { result } = await session.Runtime.evaluate({
      expression: evalExpression,
      returnByValue: true,
    });
    return result.value as any;
  } catch (err: any) {
    return {
      error: "CDP_EVALUATION_FAILED",
      message: err?.message || "Failed to inspect active tab DOM",
    };
  }
}
