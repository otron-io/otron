import { LinearClient } from '@linear/sdk';
import { Octokit } from '@octokit/rest';
import { env } from './env.js';
import { GitHubAppService } from './github-app.js';
import * as fs from 'fs/promises';
import { Stats } from 'node:fs';
import path from 'path';
import os from 'os';
// @ts-ignore - isomorphic-git doesn't have type definitions in DefinitelyTyped
import git from 'isomorphic-git';
// @ts-ignore - isomorphic-git http client
import http from 'isomorphic-git/http/node/index.js';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

interface RepoInfo {
  owner: string;
  repo: string;
  defaultBranch?: string;
  localPath: string;
}

/**
 * LocalRepositoryManager for working with repositories on the local filesystem
 * using isomorphic-git instead of shell commands to be compatible with serverless environments
 */
export class LocalRepositoryManager {
  private octokit: Octokit;
  private githubAppService: GitHubAppService | null = null;
  private clonedRepos: Map<string, RepoInfo> = new Map();
  private tempDir: string;

  constructor(
    private linearClient: LinearClient,
    private allowedRepositories: string[] = [],
    baseTempDir: string = path.join(os.tmpdir(), 'linear-agent-repos')
  ) {
    // Only GitHub App authentication is supported
    if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
      // GitHub App mode: initialize the service
      this.githubAppService = GitHubAppService.getInstance();
      // Initialize with a temporary Octokit that will be replaced per-repo
      this.octokit = new Octokit();
    } else {
      throw new Error(
        'GitHub App authentication is required. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.'
      );
    }

    // Parse allowed repositories from env variable if not provided
    if (this.allowedRepositories.length === 0 && env.ALLOWED_REPOSITORIES) {
      this.allowedRepositories = env.ALLOWED_REPOSITORIES.split(',').map((r) =>
        r.trim()
      );
    }

    // Create a unique temporary directory for this instance
    this.tempDir = `${baseTempDir}-${Date.now()}`;
  }

  /**
   * Get the appropriate Octokit client for a repository
   */
  private async getOctokitForRepo(repository: string): Promise<Octokit> {
    if (this.githubAppService) {
      // Using GitHub App authentication
      return this.githubAppService.getOctokitForRepo(repository);
    }
    // Using PAT authentication (already initialized)
    return this.octokit;
  }

  /**
   * Ensure a repository is cloned locally using isomorphic-git
   */
  async ensureRepoCloned(repoFullName: string): Promise<string> {
    if (this.clonedRepos.has(repoFullName)) {
      return this.clonedRepos.get(repoFullName)!.localPath;
    }

    const [owner, repo] = repoFullName.split('/');

    if (
      this.allowedRepositories.length > 0 &&
      !this.allowedRepositories.includes(repoFullName)
    ) {
      throw new Error(`Repository ${repoFullName} is not in the allowed list`);
    }

    try {
      // Create temp directory if it doesn't exist
      await fs.mkdir(this.tempDir, { recursive: true });

      const repoPath = path.join(this.tempDir, repoFullName);
      const ownerPath = path.join(this.tempDir, owner);

      // Create owner directory if it doesn't exist
      await fs.mkdir(ownerPath, { recursive: true });
      await fs.mkdir(repoPath, { recursive: true });

      console.log(`Cloning ${repoFullName} to ${repoPath}`);

      try {
        // Get access token for the repo
        const octokit = await this.getOctokitForRepo(repoFullName);
        const auth = await octokit.auth();
        const token =
          typeof auth === 'object' && auth !== null && 'token' in auth
            ? auth.token
            : '';

        if (!token) {
          throw new Error(
            `Could not get authentication token for repository ${repoFullName}`
          );
        }

        // Clone the repository using isomorphic-git
        await git.clone({
          fs,
          http,
          dir: repoPath,
          url: `https://github.com/${repoFullName}.git`,
          singleBranch: true,
          depth: 1, // Shallow clone for better performance
          onAuth: () => ({ username: token as string }),
        });

        // Store repository info
        this.clonedRepos.set(repoFullName, {
          owner,
          repo,
          localPath: repoPath,
        });

        return repoPath;
      } catch (error) {
        // If the directory exists and has content, try pulling latest changes
        try {
          const files = await fs.readdir(repoPath);
          if (files.length > 0) {
            console.log(
              `Repository already cloned at ${repoPath}, pulling latest changes`
            );

            // Get the current branch
            const currentBranch = await git.currentBranch({
              fs,
              dir: repoPath,
            });

            if (currentBranch) {
              // Get access token for the repo
              const octokit = await this.getOctokitForRepo(repoFullName);
              const auth = await octokit.auth();
              const token =
                typeof auth === 'object' && auth !== null && 'token' in auth
                  ? auth.token
                  : '';

              await git.pull({
                fs,
                http,
                dir: repoPath,
                ref: currentBranch,
                singleBranch: true,
                onAuth: () => ({ username: token as string }),
              });
            }

            // Add repo info to the map
            this.clonedRepos.set(repoFullName, {
              owner,
              repo,
              localPath: repoPath,
            });

            return repoPath;
          }
          throw error;
        } catch (dirError) {
          throw error;
        }
      }
    } catch (error) {
      console.error(`Error cloning repository ${repoFullName}:`, error);
      throw error;
    }
  }

  /**
   * Get the default branch for a repository
   */
  async getDefaultBranch(repoFullName: string): Promise<string> {
    const repoInfo = this.clonedRepos.get(repoFullName);

    if (!repoInfo) {
      await this.ensureRepoCloned(repoFullName);
    }

    const info = this.clonedRepos.get(repoFullName);
    if (info?.defaultBranch) {
      return info.defaultBranch;
    }

    try {
      // Get the default branch from GitHub API
      const [owner, repo] = repoFullName.split('/');
      const octokit = await this.getOctokitForRepo(repoFullName);

      const { data } = await octokit.repos.get({
        owner,
        repo,
      });

      const defaultBranch = data.default_branch;

      // Update repoInfo with default branch
      if (this.clonedRepos.has(repoFullName) && info) {
        this.clonedRepos.set(repoFullName, {
          ...info,
          defaultBranch,
        });
      }

      return defaultBranch;
    } catch (error) {
      console.error(`Error getting default branch for ${repoFullName}:`, error);
      // Fallback to 'main' if we can't determine the default branch
      return 'main';
    }
  }

  /**
   * Create a new branch for changes
   */
  async createBranch(
    branchName: string,
    repoFullName: string,
    baseBranch?: string
  ): Promise<void> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    try {
      const repoPath = repoInfo.localPath;
      const defaultBranch =
        baseBranch || (await this.getDefaultBranch(repoFullName));

      // Checkout default branch and pull latest changes
      await git.checkout({
        fs,
        dir: repoPath,
        ref: defaultBranch,
      });

      // Get access token for the repo
      const octokit = await this.getOctokitForRepo(repoFullName);
      const auth = await octokit.auth();
      const token =
        typeof auth === 'object' && auth !== null && 'token' in auth
          ? auth.token
          : '';

      await git.pull({
        fs,
        http,
        dir: repoPath,
        ref: defaultBranch,
        singleBranch: true,
        onAuth: () => ({ username: token as string }),
      });

      // Create and checkout new branch
      await git.branch({
        fs,
        dir: repoPath,
        ref: branchName,
        checkout: true,
      });

      console.log(
        `Created and checked out branch ${branchName} in ${repoFullName}`
      );
    } catch (error) {
      console.error(
        `Error creating branch ${branchName} in ${repoFullName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get the content of a file from the local repository
   */
  async getFileContent(
    filePath: string,
    repoFullName: string
  ): Promise<string> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    try {
      const repoPath = repoInfo.localPath;
      const fullPath = path.join(repoPath, filePath);

      return await fs.readFile(fullPath, 'utf-8');
    } catch (error) {
      console.error(
        `Error reading file ${filePath} from ${repoFullName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Create or update a file in the local repository
   */
  async createOrUpdateFile(
    filePath: string,
    content: string,
    commitMessage: string,
    repoFullName: string,
    branch: string = 'main'
  ): Promise<void> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    try {
      const repoPath = repoInfo.localPath;
      const fullPath = path.join(repoPath, filePath);

      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // Checkout the specified branch
      await git.checkout({
        fs,
        dir: repoPath,
        ref: branch,
      });

      // Write the file
      await fs.writeFile(fullPath, content);

      // Add the file and commit it
      await git.add({
        fs,
        dir: repoPath,
        filepath: filePath,
      });

      const name = 'Linear Agent';
      const email = 'linear-agent@example.com';

      await git.commit({
        fs,
        dir: repoPath,
        message: commitMessage,
        author: { name, email },
        committer: { name, email },
      });

      console.log(`Created/updated file ${filePath} in ${repoFullName}`);
    } catch (error) {
      console.error(
        `Error creating/updating file ${filePath} in ${repoFullName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Commit changes to the local repository
   */
  async commitChanges(
    message: string,
    repoFullName: string,
    branch?: string
  ): Promise<void> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    try {
      const repoPath = repoInfo.localPath;

      // Checkout the branch if specified
      if (branch) {
        await git.checkout({
          fs,
          dir: repoPath,
          ref: branch,
        });
      }

      // Get status to find modified files
      const status = await git.statusMatrix({ fs, dir: repoPath });

      // Add all changes
      for (const [filepath, , worktreeStatus] of status) {
        if (worktreeStatus !== 1) {
          // If file is modified in working dir
          await git.add({
            fs,
            dir: repoPath,
            filepath,
          });
        }
      }

      // Commit changes
      const name = 'Linear Agent';
      const email = 'linear-agent@example.com';

      await git.commit({
        fs,
        dir: repoPath,
        message,
        author: { name, email },
        committer: { name, email },
      });

      console.log(
        `Committed changes to ${branch || 'current branch'} in ${repoFullName}`
      );
    } catch (error) {
      console.error(
        `Error committing changes to ${
          branch || 'current branch'
        } in ${repoFullName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Push changes to GitHub
   */
  async pushChanges(repoFullName: string, branch?: string): Promise<void> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    try {
      const repoPath = repoInfo.localPath;

      // Checkout the branch if specified
      if (branch) {
        await git.checkout({
          fs,
          dir: repoPath,
          ref: branch,
        });
      }

      // Get current branch if not specified
      let pushBranch = branch;
      if (!pushBranch) {
        pushBranch = (await git.currentBranch({
          fs,
          dir: repoPath,
        })) as string;
      }

      // Get access token for the repo
      const octokit = await this.getOctokitForRepo(repoFullName);
      const auth = await octokit.auth();
      const token =
        typeof auth === 'object' && auth !== null && 'token' in auth
          ? auth.token
          : '';

      if (!token) {
        throw new Error(
          `Could not get authentication token for repository ${repoFullName}`
        );
      }

      // Push changes
      await git.push({
        fs,
        http,
        dir: repoPath,
        remote: 'origin',
        ref: pushBranch,
        onAuth: () => ({ username: token as string }),
      });

      console.log(`Pushed changes to ${pushBranch} in ${repoFullName}`);
    } catch (error) {
      console.error(
        `Error pushing changes to ${
          branch || 'current branch'
        } in ${repoFullName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Create a pull request
   * Note: This still requires the GitHub API
   */
  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
    repoFullName: string
  ): Promise<{ url: string; number: number }> {
    const [owner, repo] = repoFullName.split('/');
    await this.pushChanges(repoFullName, head);

    try {
      // Get the appropriate Octokit instance for this repository
      const octokit = await this.getOctokitForRepo(repoFullName);

      const response = await octokit.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
      });

      console.log(
        `Created pull request #${response.data.number} in ${repoFullName}`
      );
      return {
        url: response.data.html_url,
        number: response.data.number,
      };
    } catch (error) {
      console.error(`Error creating pull request in ${repoFullName}:`, error);
      throw error;
    }
  }

  /**
   * Get contents of a directory in the local repository
   */
  async getDirectoryContents(
    dirPath: string,
    repoFullName: string
  ): Promise<string[]> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    try {
      const repoPath = repoInfo.localPath;
      const fullPath = path.join(repoPath, dirPath);

      const files = await fs.readdir(fullPath);
      return files;
    } catch (error) {
      console.error(
        `Error reading directory ${dirPath} from ${repoFullName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get file stats for a path in the local repository
   */
  async getFileStats(filePath: string, repoFullName: string): Promise<Stats> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    try {
      const repoPath = repoInfo.localPath;
      const fullPath = path.join(repoPath, filePath);

      return await fs.stat(fullPath);
    } catch (error) {
      console.error(
        `Error getting stats for ${filePath} from ${repoFullName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Walk a directory recursively to find all files with an optional filter
   */
  async walkDirectory(
    dirPath: string,
    repoFullName: string,
    filter?: (filePath: string) => boolean
  ): Promise<string[]> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    const repoPath = repoInfo.localPath;
    const fullPath = path.join(repoPath, dirPath);

    const results: string[] = [];

    async function walk(dir: string, relativePath: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        const entryRelativePath = path.join(relativePath, entry.name);

        if (entry.isDirectory()) {
          // Skip node_modules and .git directories
          if (entry.name === 'node_modules' || entry.name === '.git') {
            continue;
          }
          await walk(entryPath, entryRelativePath);
        } else if (entry.isFile()) {
          if (!filter || filter(entryRelativePath)) {
            results.push(entryRelativePath);
          }
        }
      }
    }

    try {
      await walk(fullPath, '');
      return results;
    } catch (error) {
      console.error(
        `Error walking directory ${dirPath} in ${repoFullName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Search for code in the local repository using JavaScript regex
   * instead of git grep which is not available in serverless environments
   */
  async searchCode(
    query: string,
    repoFullName: string
  ): Promise<Array<{ path: string; line: number; content: string }>> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    try {
      const repoPath = repoInfo.localPath;
      const results: Array<{ path: string; line: number; content: string }> =
        [];

      // Walk the repository and search each file
      const files = await this.walkDirectory(
        '',
        repoFullName,
        (filepath) =>
          !filepath.includes('node_modules') && !filepath.includes('.git')
      );

      const searchRegex = new RegExp(query, 'i');

      for (const file of files) {
        try {
          const content = await this.getFileContent(file, repoFullName);
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (searchRegex.test(line)) {
              results.push({
                path: file,
                line: i + 1,
                content: line.trim(),
              });
            }
          }
        } catch (err) {
          // Skip files that can't be read as text
          continue;
        }
      }

      return results;
    } catch (error) {
      console.error(`Error searching code in ${repoFullName}:`, error);
      return [];
    }
  }

  /**
   * Get the git history for a file using the GitHub API
   * since we can't use git log in serverless environments
   */
  async getFileHistory(
    filePath: string,
    repoFullName: string,
    limit: number = 10
  ): Promise<
    Array<{ commit: string; author: string; date: string; message: string }>
  > {
    const [owner, repo] = repoFullName.split('/');

    try {
      const octokit = await this.getOctokitForRepo(repoFullName);

      const { data } = await octokit.repos.listCommits({
        owner,
        repo,
        path: filePath,
        per_page: limit,
      });

      return data.map((item) => ({
        commit: item.sha,
        author: item.commit.author?.name || item.author?.login || 'Unknown',
        date: item.commit.author?.date || new Date().toISOString(),
        message: item.commit.message,
      }));
    } catch (error) {
      console.error(
        `Error getting history for ${filePath} in ${repoFullName}:`,
        error
      );
      return [];
    }
  }

  /**
   * Clean up temporary directories
   */
  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      this.clonedRepos.clear();
      console.log(`Cleaned up temporary directory ${this.tempDir}`);
    } catch (error) {
      console.error(
        `Error cleaning up temporary directory ${this.tempDir}:`,
        error
      );
    }
  }
}
