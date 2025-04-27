import { LinearClient } from '@linear/sdk';
import { Octokit } from '@octokit/rest';
import { env } from './env.js';
import { GitHubAppService } from './github-app.js';
import * as fs from 'fs/promises';
import { Stats } from 'node:fs';
import { exec } from 'child_process';
import path from 'path';
import os from 'os';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface RepoInfo {
  owner: string;
  repo: string;
  defaultBranch?: string;
  localPath: string;
}

/**
 * LocalRepositoryManager for working with repositories on the local filesystem
 * to reduce GitHub API calls
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
   * Ensure a repository is cloned locally
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

      // Clone the repository
      console.log(`Cloning ${repoFullName} to ${repoPath}`);
      try {
        await execAsync(
          `git clone https://github.com/${repoFullName}.git ${repoPath}`
        );
      } catch (error: unknown) {
        // Check if error is because the directory already exists
        if (
          typeof error === 'object' &&
          error !== null &&
          'stderr' in error &&
          typeof error.stderr === 'string' &&
          error.stderr.includes('already exists and is not an empty directory')
        ) {
          console.log(
            `Repository already cloned at ${repoPath}, pulling latest changes`
          );
          await execAsync(`cd ${repoPath} && git pull`);
        } else {
          throw error;
        }
      }

      // Store repository info
      this.clonedRepos.set(repoFullName, {
        owner,
        repo,
        localPath: repoPath,
      });

      return repoPath;
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
      const repoPath = info?.localPath || path.join(this.tempDir, repoFullName);
      const { stdout } = await execAsync(
        `cd ${repoPath} && git remote show origin | grep 'HEAD branch' | cut -d' ' -f5`
      );
      const defaultBranch = stdout.trim();

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

    try {
      const repoPath =
        repoInfo?.localPath || path.join(this.tempDir, repoFullName);
      const defaultBranch =
        baseBranch || (await this.getDefaultBranch(repoFullName));

      // Checkout default branch and pull latest changes
      await execAsync(
        `cd ${repoPath} && git checkout ${defaultBranch} && git pull`
      );

      // Create and checkout new branch
      await execAsync(`cd ${repoPath} && git checkout -b ${branchName}`);

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

    try {
      const repoPath =
        repoInfo?.localPath || path.join(this.tempDir, repoFullName);
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

    try {
      const repoPath =
        repoInfo?.localPath || path.join(this.tempDir, repoFullName);
      const fullPath = path.join(repoPath, filePath);

      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // Checkout the specified branch
      await execAsync(`cd ${repoPath} && git checkout ${branch}`);

      // Write the file
      await fs.writeFile(fullPath, content);

      // Add the file and commit it
      await execAsync(`cd ${repoPath} && git add "${filePath}"`);
      await execAsync(`cd ${repoPath} && git commit -m "${commitMessage}"`);

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

    try {
      const repoPath =
        repoInfo?.localPath || path.join(this.tempDir, repoFullName);

      // Checkout the branch if specified
      if (branch) {
        await execAsync(`cd ${repoPath} && git checkout ${branch}`);
      }

      // Add all changes
      await execAsync(`cd ${repoPath} && git add .`);

      // Commit changes
      await execAsync(`cd ${repoPath} && git commit -m "${message}"`);

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

    try {
      const repoPath =
        repoInfo?.localPath || path.join(this.tempDir, repoFullName);

      // Checkout the branch if specified
      if (branch) {
        await execAsync(`cd ${repoPath} && git checkout ${branch}`);
      }

      // Get current branch if not specified
      let pushBranch = branch;
      if (!pushBranch) {
        const { stdout } = await execAsync(
          `cd ${repoPath} && git branch --show-current`
        );
        pushBranch = stdout.trim();
      }

      // Push changes
      await execAsync(`cd ${repoPath} && git push origin ${pushBranch}`);

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

    try {
      const repoPath =
        repoInfo?.localPath || path.join(this.tempDir, repoFullName);
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

    try {
      const repoPath =
        repoInfo?.localPath || path.join(this.tempDir, repoFullName);
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
    const repoPath =
      repoInfo?.localPath || path.join(this.tempDir, repoFullName);
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
   * Search for code in the local repository
   */
  async searchCode(
    query: string,
    repoFullName: string
  ): Promise<Array<{ path: string; line: number; content: string }>> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);

    try {
      const repoPath =
        repoInfo?.localPath || path.join(this.tempDir, repoFullName);

      // Use git grep for efficient searching
      const { stdout } = await execAsync(
        `cd ${repoPath} && git grep -n "${query}"`
      );

      if (!stdout.trim()) {
        return [];
      }

      const results: Array<{ path: string; line: number; content: string }> =
        [];

      // Parse grep output
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;

        const match = line.match(/^([^:]+):(\d+):(.*)$/);
        if (match) {
          const [, path, lineNumber, content] = match;
          results.push({
            path,
            line: parseInt(lineNumber, 10),
            content: content.trim(),
          });
        }
      }

      return results;
    } catch (error) {
      // If git grep returns non-zero (no matches), don't treat as error
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 1 &&
        'stderr' in error &&
        !error.stderr
      ) {
        return [];
      }

      console.error(`Error searching code in ${repoFullName}:`, error);
      throw error;
    }
  }

  /**
   * Get the git history for a file
   */
  async getFileHistory(
    filePath: string,
    repoFullName: string,
    limit: number = 10
  ): Promise<
    Array<{ commit: string; author: string; date: string; message: string }>
  > {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);

    try {
      const repoPath =
        repoInfo?.localPath || path.join(this.tempDir, repoFullName);

      const { stdout } = await execAsync(
        `cd ${repoPath} && git log -n ${limit} --pretty=format:"%H|%an|%ad|%s" -- "${filePath}"`
      );

      if (!stdout.trim()) {
        return [];
      }

      const results: Array<{
        commit: string;
        author: string;
        date: string;
        message: string;
      }> = [];

      // Parse git log output
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;

        const [commit, author, date, ...messageParts] = line.split('|');
        const message = messageParts.join('|'); // In case the commit message contains |

        results.push({
          commit,
          author,
          date,
          message,
        });
      }

      return results;
    } catch (error) {
      console.error(
        `Error getting history for ${filePath} in ${repoFullName}:`,
        error
      );
      throw error;
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
