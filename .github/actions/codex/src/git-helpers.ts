import { spawnSync } from "child_process";
import * as github from "@actions/github";
import { EnvContext } from "./env-context";

function runGit(args: string[], silent = true): string {
  console.info(`Running git ${args.join(" ")}`);
  const res = spawnSync("git", args, {
    encoding: "utf8",
    stdio: silent ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    // Return stderr so caller may handle; else throw.
    throw new Error(
      `git ${args.join(" ")} failed with code ${res.status}: ${res.stderr}`,
    );
  }
  return res.stdout.trim();
}

function stageAllChanges() {
  runGit(["add", "-A"]);
}

function hasStagedChanges(): boolean {
  const res = spawnSync("git", ["diff", "--cached", "--quiet", "--exit-code"]);
  return res.status !== 0;
}

function ensureOnBranch(
  issueNumber: number,
  protectedBranches: string[],
  suggestedSlug?: string,
): string {
  let branch = "";
  try {
    branch = runGit(["symbolic-ref", "--short", "-q", "HEAD"]);
  } catch {
    branch = "";
  }

  // If detached HEAD or on a protected branch, create a new branch.
  if (!branch || protectedBranches.includes(branch)) {
    if (suggestedSlug) {
      const safeSlug = suggestedSlug
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      branch = `codex-fix-${issueNumber}-${safeSlug}`;
    } else {
      branch = `codex-fix-${issueNumber}-${Date.now()}`;
    }
    runGit(["switch", "-c", branch]);
  }
  return branch;
}

function commitIfNeeded(issueNumber: number) {
  if (hasStagedChanges()) {
    runGit([
      "commit",
      "-m",
      `fix: automated fix for #${issueNumber} via Codex`,
    ]);
  }
}

function pushBranch(branch: string, githubToken: string, ctx: EnvContext) {
  // Prefer pushing to PR head repo when available (supports forks)
  try {
    const eventPath = ctx.get("GITHUB_EVENT_PATH");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const event = require(eventPath);
    const headRepo = event?.pull_request?.head?.repo?.full_name as
      | string
      | undefined;
    const headRef = event?.pull_request?.head?.ref as string | undefined;
    const baseRef = event?.pull_request?.base?.ref as string | undefined;

    if (headRepo && headRef) {
      // Never push to protected branches (default or common names)
      const protectedBranches = new Set(
        ["main", "master", baseRef || ""].filter(Boolean),
      );
      let targetRef = headRef;
      if (protectedBranches.has(headRef)) {
        targetRef = `codex-fix-${Date.now()}`;
        // Ensure local branch exists to match the new remote ref
        try {
          runGit(["checkout", "-B", targetRef]);
        } catch {}
      }
      const headRemote = `https://x-access-token:${githubToken}@github.com/${headRepo}.git`;
      runGit(["remote", "remove", "pr"], true);
      try {
        runGit(["remote", "add", "pr", headRemote], true);
      } catch {}
      runGit(["fetch", "--no-tags", "pr", headRef], true);
      runGit(["push", "--force-with-lease", "-u", "pr", `HEAD:${targetRef}`]);
      return;
    }
  } catch {
    // Fall back to repo slug push below
  }

  const repoSlug = ctx.get("GITHUB_REPOSITORY"); // owner/repo
  // Protect common default branches
  let pushRef = branch;
  if (pushRef === "main" || pushRef === "master") {
    pushRef = `codex-fix-${Date.now()}`;
    try {
      runGit(["checkout", "-B", pushRef]);
    } catch {}
  }
  const remoteUrl = `https://x-access-token:${githubToken}@github.com/${repoSlug}.git`;
  runGit(["push", "--force-with-lease", "-u", remoteUrl, `HEAD:${pushRef}`]);
}

/**
 * If this returns a string, it is the URL of the created PR.
 */
export async function maybePublishPRForIssue(
  issueNumber: number,
  lastMessage: string,
  ctx: EnvContext,
): Promise<string | undefined> {
  // Only proceed if GITHUB_TOKEN available.
  const githubToken =
    ctx.tryGetNonEmpty("GITHUB_TOKEN") ?? ctx.tryGetNonEmpty("GH_TOKEN");
  if (!githubToken) {
    console.warn("No GitHub token - skipping PR creation.");
    return undefined;
  }

  // Print `git status` for debugging.
  runGit(["status"]);

  // Stage any remaining changes so they can be committed and pushed.
  stageAllChanges();

  const octokit = ctx.getOctokit(githubToken);

  const { owner, repo } = github.context.repo;

  // Determine default branch to treat as protected.
  let defaultBranch = "main";
  try {
    const repoInfo = await octokit.rest.repos.get({ owner, repo });
    defaultBranch = repoInfo.data.default_branch ?? "main";
  } catch (e) {
    console.warn(`Failed to get default branch, assuming 'main': ${e}`);
  }

  const sanitizedMessage = lastMessage.replace(/\u2022/g, "-");
  const [summaryLine] = sanitizedMessage.split(/\r?\n/);
  const branch = ensureOnBranch(
    issueNumber,
    [defaultBranch, "master"],
    summaryLine,
  );
  commitIfNeeded(issueNumber);
  pushBranch(branch, githubToken, ctx);

  // Try to find existing PR for this branch
  const headParam = `${owner}:${branch}`;
  const existing = await octokit.rest.pulls.list({
    owner,
    repo,
    head: headParam,
    state: "open",
  });
  if (existing.data.length > 0) {
    return existing.data[0].html_url;
  }

  // Determine base branch (default to main)
  let baseBranch = "main";
  try {
    const repoInfo = await octokit.rest.repos.get({ owner, repo });
    baseBranch = repoInfo.data.default_branch ?? "main";
  } catch (e) {
    console.warn(`Failed to get default branch, assuming 'main': ${e}`);
  }

  const pr = await octokit.rest.pulls.create({
    owner,
    repo,
    title: summaryLine,
    head: branch,
    base: baseBranch,
    body: sanitizedMessage,
  });
  return pr.data.html_url;
}
