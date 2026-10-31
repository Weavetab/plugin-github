import type { PluginStorage } from "@weavetab/sdk";
import type { GithubRepoCache } from "./types.js";

const CACHE_SUBDIR = "github_cache";

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]/g, "_");
}

function cacheFile(owner: string, repo: string): string {
  return `${CACHE_SUBDIR}/${safeSegment(owner)}_${safeSegment(repo)}.json`;
}

/**
 * Load a previously analyzed repository from the plugin's isolated storage.
 * Returns null when absent, malformed, or older than `ttlMs`.
 */
export async function loadRepoCache(
  owner: string,
  repo: string,
  store: PluginStorage | undefined | null,
  ttlMs: number
): Promise<GithubRepoCache | null> {
  if (!store || typeof store.getJSON !== "function") return null;
  const data = await store.getJSON<GithubRepoCache>(cacheFile(owner, repo));
  if (!data || typeof data.analyzed_at !== "number") return null;
  if (Date.now() - data.analyzed_at > ttlMs) return null; // stale
  return data;
}

/** Persist an analysis result into the plugin's isolated storage. */
export async function saveRepoCache(
  data: GithubRepoCache,
  store: PluginStorage | undefined | null
): Promise<void> {
  if (!store || typeof store.setJSON !== "function") return;
  await store.setJSON(cacheFile(data.owner, data.repo), data);
}
