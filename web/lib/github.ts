import { getSettingsSync } from "./settings";

export type GitHubConfig = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
};

export type GitHubPublishSuccess = {
  published: true;
  commitSha: string;
  htmlUrl: string;
};

export type GitHubPublishResult =
  | GitHubPublishSuccess
  | { published: false; error: string }
  | { published: false; skipped: true };

export class GitHubPublishError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubPublishError";
  }
}

export function isGitHubConfigured(): boolean {
  const github = getSettingsSync().github;
  return Boolean(
    github.token.trim() &&
      (github.owner.trim() || "Garret27") &&
      (github.repo.trim() || "The-Bannered-Pony-Mare"),
  );
}

export function getGitHubConfig(): GitHubConfig | null {
  const github = getSettingsSync().github;
  const token = github.token.trim();
  if (!token) {
    return null;
  }

  return {
    token,
    owner: github.owner.trim() || "Garret27",
    repo: github.repo.trim() || "The-Bannered-Pony-Mare",
    branch: github.branch.trim() || "main",
  };
}
type ContentsMetadataResponse = {
  sha?: string;
};

type ContentsPutResponse = {
  commit?: {
    sha?: string;
    html_url?: string;
  };
};

async function getFileSha(
  config: GitHubConfig,
  relativePath: string,
): Promise<string | undefined> {
  const url = new URL(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${relativePath}`,
  );
  url.searchParams.set("ref", config.branch);

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new GitHubPublishError(
      `Failed to read ${relativePath} from GitHub (${response.status}): ${body}`,
      response.status,
    );
  }

  const data = (await response.json()) as ContentsMetadataResponse;
  return data.sha;
}

export async function publishFileToGitHub(
  relativePath: string,
  content: Buffer | string,
  message: string,
): Promise<GitHubPublishSuccess> {
  const config = getGitHubConfig();
  if (!config) {
    throw new GitHubPublishError("GitHub is not configured");
  }

  const encoded =
    typeof content === "string"
      ? Buffer.from(content, "utf-8").toString("base64")
      : content.toString("base64");

  const sha = await getFileSha(config, relativePath);

  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${relativePath}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      message,
      content: encoded,
      branch: config.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GitHubPublishError(
      `Failed to publish ${relativePath} to GitHub (${response.status}): ${body}`,
      response.status,
    );
  }

  const data = (await response.json()) as ContentsPutResponse;
  const commitSha = data.commit?.sha;
  const htmlUrl = data.commit?.html_url;

  if (!commitSha || !htmlUrl) {
    throw new GitHubPublishError(
      `GitHub accepted ${relativePath} but returned an incomplete response`,
    );
  }

  return {
    published: true,
    commitSha,
    htmlUrl,
  };
}

export async function tryPublishFileToGitHub(
  relativePath: string,
  content: Buffer | string,
  message: string,
): Promise<GitHubPublishResult> {
  if (!isGitHubConfigured()) {
    return { published: false, skipped: true };
  }

  try {
    return await publishFileToGitHub(relativePath, content, message);
  } catch (error) {
    const messageText =
      error instanceof GitHubPublishError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown GitHub publish error";
    console.error(`GitHub publish failed for ${relativePath}:`, error);
    return { published: false, error: messageText };
  }
}
