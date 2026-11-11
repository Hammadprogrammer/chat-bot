import { env } from "@/lib/env";

export class GitHubError extends Error {}

export const MAX_GITHUB_FILES = 200;
const TEXT_EXT = /\.(md|mdx|markdown|txt|rst|adoc|json|ya?ml|html?|csv)$/i;
const IGNORED = /(^|\/)(node_modules|\.git|dist|build|vendor|\.next|coverage|test|tests|__tests__|fixtures|locales?)(\/|$)/i;

export type GitHubPayload = {
  owner: string;
  repo: string;
  branch: string;
  files: string[];
  processed: number;
  failed: { path: string; error: string }[];
};

export function parseGitHubUrl(input: string) {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+))?\/?$/i);
  if (!m) throw new GitHubError("Enter a GitHub repository URL like https://github.com/owner/repo");
  return { owner: m[1], repo: m[2], branch: m[3] };
}

function headers() {
  const token = env().GITHUB_TOKEN;
  return { accept: "application/vnd.github+json", "user-agent": "MultiSiteChatbot", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, { headers: headers() });
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new GitHubError("GitHub API rate limit reached. Set GITHUB_TOKEN to raise the limit.");
  }
  if (res.status === 404) throw new GitHubError("Repository not found (private repos require GITHUB_TOKEN)");
  if (!res.ok) throw new GitHubError(`GitHub API error ${res.status}`);
  return res.json() as Promise<T>;
}

export async function newGitHubPayload(url: string): Promise<GitHubPayload> {
  const { owner, repo, branch: requested } = parseGitHubUrl(url);
  const branch = requested ?? (await gh<{ default_branch: string }>(`/repos/${owner}/${repo}`)).default_branch;
  const tree = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  const files = tree.tree
    .filter((t) => t.type === "blob" && TEXT_EXT.test(t.path) && !IGNORED.test(t.path) && (t.size ?? 0) < 512 * 1024)
    .map((t) => t.path)
    .sort((a, b) => (/readme/i.test(a) ? -1 : /readme/i.test(b) ? 1 : a.localeCompare(b)))
    .slice(0, MAX_GITHUB_FILES);
  if (files.length === 0) throw new GitHubError("No importable text/markdown files found in this repository");
  return { owner, repo, branch, files, processed: 0, failed: [] };
}

export async function fetchGitHubFile(p: GitHubPayload, path: string) {
  const url = `https://raw.githubusercontent.com/${p.owner}/${p.repo}/${encodeURIComponent(p.branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const token = env().GITHUB_TOKEN;
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new GitHubError(`Failed to fetch ${path} (${res.status})`);
  return { text: await res.text(), url: `https://github.com/${p.owner}/${p.repo}/blob/${p.branch}/${path}` };
}
