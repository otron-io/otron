import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { workerEnv } from "./env.js";
import { getInstallationToken } from "./github-auth.js";

/**
 * Ensure a repository is cloned locally and up to date.
 * Uses a short-lived GitHub App installation token for auth.
 * Returns the absolute path to the repo.
 */
export async function ensureRepo(
  repository: string,
  branch?: string
): Promise<string> {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error(`Invalid repository: ${repository}`);

  const repoDir = join(workerEnv.REPOS_DIR, owner, repo);
  const token = await getInstallationToken(repository);

  if (!existsSync(repoDir)) {
    const parentDir = join(workerEnv.REPOS_DIR, owner);
    mkdirSync(parentDir, { recursive: true });

    const cloneUrl = `https://x-access-token:${token}@github.com/${repository}.git`;
    console.log(`Cloning ${repository}...`);
    execSync(`git clone --depth=50 ${cloneUrl} ${repoDir}`, {
      stdio: "inherit",
    });
  } else {
    // Update the remote URL with the fresh token (installation tokens expire)
    const remoteUrl = `https://x-access-token:${token}@github.com/${repository}.git`;
    execSync(`git remote set-url origin ${remoteUrl}`, {
      cwd: repoDir,
      stdio: "inherit",
    });

    console.log(`Updating ${repository}...`);
    execSync(`git fetch origin`, { cwd: repoDir, stdio: "inherit" });
  }

  const targetBranch = branch || "main";
  try {
    execSync(`git checkout ${targetBranch}`, {
      cwd: repoDir,
      stdio: "inherit",
    });
    execSync(`git pull --rebase origin ${targetBranch}`, {
      cwd: repoDir,
      stdio: "inherit",
    });
  } catch {
    if (targetBranch !== "main") {
      execSync(`git checkout main`, { cwd: repoDir, stdio: "inherit" });
      execSync(`git pull --rebase origin main`, {
        cwd: repoDir,
        stdio: "inherit",
      });
    }
  }

  return repoDir;
}
