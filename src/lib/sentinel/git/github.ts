/**
 * Real GitHub integration: branch resolution, tarball snapshots,
 * compare API (incremental changed files), and raw file fetches.
 * All outbound calls are allowlisted (SSRF guard).
 */
import { assertSafeFetchUrl, clampString, MAX_JSON_BYTES } from "../security/guards";

export interface GitHubConfig {
  token?: string;
}

export interface CompareResult {
  baseSha: string;
  headSha: string;
  changedFiles: { filename: string; status: string; additions: number; deletions: number }[];
  truncated: boolean;
}

function headers(cfg: GitHubConfig): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "api-sentinel/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (cfg.token) h.Authorization = `Bearer ${cfg.token}`;
  return h;
}

async function ghFetch(url: string, cfg: GitHubConfig, init?: RequestInit): Promise<Response> {
  assertSafeFetchUrl(url);
  const res = await fetch(url, {
    ...init,
    headers: { ...headers(cfg), ...(init?.headers ?? {}) },
    redirect: "follow",
  });
  return res;
}

function friendlyError(status: number, body: string): string {
  if (status === 401) return "GitHub authentication failed (401). Verify the token.";
  if (status === 403) {
    if (/rate limit/i.test(body))
      return "GitHub rate limit exceeded. Add a token or wait before retrying.";
    return "GitHub access forbidden (403). The token may lack repo scope or the repo may be private.";
  }
  if (status === 404) return "Repository not found (404). Check the URL or token access.";
  return `GitHub request failed (${status}): ${body.slice(0, 220)}`;
}

export async function getRepoInfo(
  owner: string,
  repo: string,
  cfg: GitHubConfig
): Promise<{ defaultBranch: string; private: boolean; description?: string }> {
  const res = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`, cfg);
  const text = await res.text();
  if (!res.ok) throw new Error(friendlyError(res.status, text));
  const j = JSON.parse(text) as { default_branch: string; private: boolean; description?: string };
  return { defaultBranch: j.default_branch, private: j.private, description: j.description };
}

export async function getBranchSha(
  owner: string,
  repo: string,
  branch: string,
  cfg: GitHubConfig
): Promise<string> {
  const res = await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
    cfg
  );
  const text = await res.text();
  if (!res.ok) throw new Error(friendlyError(res.status, text));
  const j = JSON.parse(text) as { sha: string };
  return j.sha;
}

/** Full snapshot via codeload tarball (first scan / recovery / manual rescan). */
export async function downloadTarball(
  owner: string,
  repo: string,
  ref: string,
  cfg: GitHubConfig
): Promise<{ bytes: Buffer; sha: string }> {
  const sha = await getBranchSha(owner, ref === "" ? "" : repo, ref, cfg).catch(() => ref);
  void sha;
  const res = await ghFetch(
    `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(ref)}`,
    cfg
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(friendlyError(res.status, text));
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > 120 * 1024 * 1024) {
    throw new Error("Repository archive exceeds the 120MB download cap.");
  }
  return { bytes: Buffer.from(ab), sha: ref };
}

export async function compareCommits(
  owner: string,
  repo: string,
  base: string,
  head: string,
  cfg: GitHubConfig
): Promise<CompareResult> {
  const res = await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=300`,
    cfg
  );
  const text = await res.text();
  if (!res.ok) throw new Error(friendlyError(res.status, text));
  if (text.length > MAX_JSON_BYTES) throw new Error("GitHub compare payload too large.");
  const j = JSON.parse(text) as {
    base_commit: { sha: string };
    merge_base_commit: { sha: string };
    commits: { sha: string }[];
    files?: { filename: string; status: string; additions: number; deletions: number }[];
    truncated?: boolean;
  };
  return {
    baseSha: j.base_commit?.sha ?? base,
    headSha: j.commits?.length ? j.commits[j.commits.length - 1].sha : head,
    changedFiles: (j.files ?? []).map((f) => ({
      filename: clampString(f.filename, 500),
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
    truncated: j.truncated === true,
  };
}

/** Fetch a single file's raw content at a ref (incremental analysis). */
export async function fetchRawFile(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
  cfg: GitHubConfig
): Promise<string | null> {
  const res = await ghFetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${filePath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    cfg
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(friendlyError(res.status, text));
  }
  const text = await res.text();
  if (text.length > 2 * 1024 * 1024) {
    throw new Error(`File ${filePath} exceeds the 2MB raw fetch cap.`);
  }
  return text;
}

/** Resolve the token from settings store or environment (server-side only). */
export function resolveGitHubToken(settingsToken?: string): string | undefined {
  if (settingsToken) return settingsToken;
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
}
