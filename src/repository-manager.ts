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

interface RepoInfo {
  owner: string;
  repo: string;
  defaultBranch?: string;
  localPath: string;
}

/*
 * LocalRepositoryManager
 *
 * This class manages local git repositories, minimizing GitHub API usage
 * to avoid rate limits. Most operations use isomorphic-git to work with
 * local repositories.
 *
 * NOTE: A few operations like creating pull requests still require the
 * GitHub API, as these cannot be performed using local git operations alone.
 * These methods are clearly marked.
 */
export class LocalRepositoryManager {
  private octokit: Octokit;
  private githubAppService: GitHubAppService | null = null;
  private clonedRepos: Map<string, RepoInfo> = new Map();
  private tempDir: string;

  constructor(
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

        // Clone the repository using isomorphic-git with token in URL
        await git.clone({
          fs,
          http,
          dir: repoPath,
          url: `https://${token}@github.com/${repoFullName}.git`,
          singleBranch: true,
          depth: 1, // Shallow clone for better performance
        });

        // Store repository info
        this.clonedRepos.set(repoFullName, {
          owner,
          repo,
          localPath: repoPath,
        });

        return repoPath;
      } catch (error: any) {
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
                url: `https://${token}@github.com/${repoFullName}.git`,
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
    } catch (error: any) {
      console.error(`Error cloning repository ${repoFullName}:`, error);

      // Add additional debug information for auth errors
      if (error.code === 'HttpError' && error.data?.statusCode === 401) {
        // Log token info without exposing the full token
        const octokit = await this.getOctokitForRepo(repoFullName);
        const auth = await octokit.auth();
        const token =
          typeof auth === 'object' && auth !== null && 'token' in auth
            ? auth.token
            : '';

        console.error(
          `Authentication error for ${repoFullName}. Token length: ${
            typeof token === 'string' ? token.length : 0
          }`
        );

        // Check if GitHub App authentication is being used
        if (this.githubAppService) {
          console.error(
            'GitHub App authentication is being used. Check app permissions and installation.'
          );
        } else {
          console.error(
            'Token-based authentication is being used. Check if token has correct permissions.'
          );
        }
      }

      throw error;
    }
  }

  /**
   * Get the default branch for a repository from the local clone
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
      const repoPath = info!.localPath;

      // Try to find the current branch first
      try {
        const currentBranch = await git.currentBranch({
          fs,
          dir: repoPath,
        });

        if (currentBranch) {
          // Update repoInfo with default branch
          if (this.clonedRepos.has(repoFullName) && info) {
            this.clonedRepos.set(repoFullName, {
              ...info,
              defaultBranch: currentBranch.toString(),
            });
          }

          return currentBranch.toString();
        }
      } catch (err) {
        console.log(`Couldn't get current branch: ${err}`);
      }

      // Fallback: Check for common default branch names by seeing which one exists
      for (const branch of ['main', 'master', 'develop']) {
        try {
          // Check if the branch exists in .git/refs/heads
          try {
            const branchPath = path.join(
              repoPath,
              '.git',
              'refs',
              'heads',
              branch
            );
            await fs.access(branchPath);

            // If we get here, the branch exists
            if (this.clonedRepos.has(repoFullName) && info) {
              this.clonedRepos.set(repoFullName, {
                ...info,
                defaultBranch: branch,
              });
            }

            return branch;
          } catch (accessErr) {
            // Branch file doesn't exist, continue to next branch
          }
        } catch (err) {
          // Error checking branch, try next one
        }
      }

      // Ultimate fallback
      return 'main';
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
        url: `https://${token}@github.com/${repoFullName}.git`,
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
        url: `https://${token}@github.com/${repoFullName}.git`,
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
   * NOTE: This operation requires the GitHub API and cannot be replaced with local git operations
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
   * Get the git history for a file using local git operations
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
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    try {
      const repoPath = repoInfo.localPath;
      const commits: Array<{
        commit: string;
        author: string;
        date: string;
        message: string;
      }> = [];

      // Get the commit history using isomorphic-git
      const logResults = await git.log({
        fs,
        dir: repoPath,
        depth: limit,
        filepath: filePath,
      });

      return logResults.map((commit) => ({
        commit: commit.oid,
        author: commit.commit.author.name,
        date: new Date(commit.commit.author.timestamp * 1000).toISOString(),
        message: commit.commit.message,
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
   * Search commit messages and content using local git operations
   */
  async searchCommits(
    searchTerm: string,
    repoFullName: string,
    limit: number = 10
  ): Promise<
    Array<{
      sha: string;
      commit: {
        message: string;
        author: { name: string; date: string };
        stats: { total: number };
      };
    }>
  > {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    try {
      const repoPath = repoInfo.localPath;

      // Use git.log to get commits
      const logResults = await git.log({
        fs,
        dir: repoPath,
        depth: 100, // Get more than we need for filtering
      });

      // Filter commits based on search term
      const searchTermLower = searchTerm.toLowerCase();
      const filteredCommits = logResults
        .filter((commit) =>
          commit.commit.message.toLowerCase().includes(searchTermLower)
        )
        .slice(0, limit);

      // Format to match the expected interface
      return filteredCommits.map((commit) => ({
        sha: commit.oid,
        commit: {
          message: commit.commit.message,
          author: {
            name: commit.commit.author.name,
            date: new Date(commit.commit.author.timestamp * 1000).toISOString(),
          },
          stats: {
            total: 1, // We don't have actual stats, so use placeholder
          },
        },
      }));
    } catch (error) {
      console.error(`Error searching commits in ${repoFullName}:`, error);
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
