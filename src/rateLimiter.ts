import type { GithubError } from "./types.js";

interface RateLimitState {
  remaining: number;
  resetAt: number | null; // Unix timestamp in seconds
}

const SAFETY_THRESHOLD = 5;

const state: RateLimitState = { remaining: 60, resetAt: null };

/**
 * Guard that refuses new API calls once the remaining quota drops below a safety
 * threshold, so we never trip GitHub's hard rate limit mid-flow.
 */
export function canMakeApiCall(): true | GithubError {
  const nowSec = Math.floor(Date.now() / 1000);

  if (state.resetAt && nowSec >= state.resetAt) {
    // We've passed the reset window, assume quota is restored.
    state.remaining = 60;
    state.resetAt = null;
  }

  if (state.remaining < SAFETY_THRESHOLD) {
    const resetTime = state.resetAt ? new Date(state.resetAt * 1000).toISOString() : "unknown";
    return {
      error: "RATE_LIMIT_LOW",
      message: `GitHub API hourly rate limit is too low (remaining: ${state.remaining}). Please wait until ${resetTime} before making more API calls. Note: read actions (api.github.com / raw.githubusercontent.com GETs) do NOT consume the rate-limited Search API quota.`,
      remaining: state.remaining,
      reset_at: state.resetAt,
    };
  }

  return true;
}

export function recordApiCall(headers: Headers): void {
  const remainingStr = headers.get("x-ratelimit-remaining");
  const resetStr = headers.get("x-ratelimit-reset");

  if (remainingStr) {
    state.remaining = parseInt(remainingStr, 10) || state.remaining;
  }
  if (resetStr) {
    state.resetAt = parseInt(resetStr, 10) || state.resetAt;
  }
}

export function handleApiResponse(response: Response): Response | GithubError {
  recordApiCall(response.headers);
  if (response.status === 403 || response.status === 429) {
    const resetTime = state.resetAt ? new Date(state.resetAt * 1000).toISOString() : "unknown";
    return {
      error: "RATE_LIMIT_EXCEEDED",
      message: `GitHub API rate limit exceeded. Please wait until ${resetTime}.`,
      remaining: state.remaining,
      reset_at: state.resetAt,
    };
  }
  return response;
}
