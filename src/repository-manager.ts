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

// A simple semaphore for limiting concurrent operations
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(count: number) {
    this.permits = count;
  }

  public async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  public release(): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }
}

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
  // Limit concurrent file operations to avoid EMFILE errors
  private fileOpSemaphore: Semaphore;
  // Limit concurrent git operations
  private gitOpSemaphore: Semaphore;

  constructor(
    private allowedRepositories: string[] = [],
    baseTempDir: string = path.join(os.tmpdir(), 'linear-agent-repos'),
    maxConcurrentFileOps: number = 100,
    maxConcurrentGitOps: number = 5
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

    // Initialize the semaphores for file and git operations
    this.fileOpSemaphore = new Semaphore(maxConcurrentFileOps);
    this.gitOpSemaphore = new Semaphore(maxConcurrentGitOps);
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
   * Wrapper around fs.readFile to limit concurrent file operations
   */
  private async safeReadFile(
    filePath: string,
    options?: { encoding?: BufferEncoding; flag?: string }
  ): Promise<string> {
    await this.fileOpSemaphore.acquire();
    try {
      const result = await fs.readFile(filePath, options);
      return result.toString();
    } finally {
      this.fileOpSemaphore.release();
    }
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

    // Acquire git operation semaphore to limit concurrent cloning
    await this.gitOpSemaphore.acquire();

    try {
      // Create temp directory if it doesn't exist
      await fs.mkdir(this.tempDir, { recursive: true });

      const repoPath = path.join(this.tempDir, repoFullName);
      const ownerPath = path.join(this.tempDir, owner);

      // Create owner directory if it doesn't exist
      await fs.mkdir(ownerPath, { recursive: true });

      // Check if directory already exists and is not empty
      try {
        const repoDir = await fs.readdir(repoPath);
        if (repoDir.length > 0) {
          console.log(
            `Repository ${repoFullName} already exists at ${repoPath}, skipping clone`
          );

          // Store repo info for future reference
          this.clonedRepos.set(repoFullName, {
            owner,
            repo,
            localPath: repoPath,
          });

          return repoPath;
        }
      } catch (err) {
        // Directory doesn't exist or can't be read, we'll create it
        await fs.mkdir(repoPath, { recursive: true });
      }

      console.log(`Cloning ${repoFullName} to ${repoPath}`);

      try {
        // Get access token for the repo
        console.log(`Getting Octokit for ${repoFullName}...`);
        const octokit = await this.getOctokitForRepo(repoFullName);

        // Debug logging
        console.log(`Got Octokit instance, retrieving auth token...`);

        const auth = await octokit.auth();
        console.log(
          `Auth result type: ${typeof auth}, format: ${
            auth ? (typeof auth === 'object' ? 'object' : 'string') : 'null'
          }`
        );

        const token =
          typeof auth === 'object' && auth !== null && 'token' in auth
            ? auth.token
            : '';

        console.log(
          `Token received: ${
            token
              ? 'Yes (length: ' +
                (typeof token === 'string' ? token.length : 'unknown') +
                ')'
              : 'No'
          }`
        );

        if (!token) {
          throw new Error(
            `Could not get authentication token for repository ${repoFullName}`
          );
        }

        // Clone the repository using isomorphic-git with token in URL
        console.log(`Cloning repository with auth token...`);

        // Use a more controlled approach with explicit error handling
        await git.clone({
          fs,
          http,
          dir: repoPath,
          url: `https://x-access-token:${token}@github.com/${repoFullName}.git`,
          singleBranch: true,
          depth: 1, // Shallow clone for better performance
          onProgress: (progress: {
            phase?: string;
            loaded: number;
            total?: number;
          }) => {
            // Only log progress every 10%
            if (progress.phase && progress.loaded % 10 === 0) {
              console.log(
                `Clone progress: ${progress.phase} ${Math.round(
                  (progress.loaded / (progress.total || 100)) * 100
                )}%`
              );
            }
          },
        });

        // Store repo info for future reference
        this.clonedRepos.set(repoFullName, {
          owner,
          repo,
          localPath: repoPath,
        });

        return repoPath;
      } catch (error: any) {
        // Handle specific git errors
        if (error.code === 'ENOENT') {
          console.error(`File not found error during clone: ${error.message}`);
          throw new Error(
            `File not found during clone: ${error.message}. This may be due to too many concurrent operations.`
          );
        } else if (error.code === 'EMFILE') {
          console.error(`Too many open files during clone: ${error.message}`);
          throw new Error(
            `Too many open files during clone. Try increasing the system limit or reducing concurrent operations.`
          );
        }

        // Handle authentication errors
        if (error.message?.includes('401')) {
          console.error(`Authentication error cloning ${repoFullName}:`, error);
          if (this.githubAppService) {
            throw new Error(
              `Authentication error with GitHub App. Check app permissions and installation.`
            );
          } else {
            throw new Error(`Authentication error. Check GitHub token.`);
          }
        }

        console.error(`Error cloning repository ${repoFullName}:`, error);
        throw error;
      }
    } finally {
      // Always release the semaphore
      this.gitOpSemaphore.release();
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
        (filepath: string) =>
          !filepath.includes('node_modules') && !filepath.includes('.git')
      );

      const searchRegex = new RegExp(query, 'i');

      // Limit the number of files searched to avoid too many open files
      const MAX_FILES_TO_SEARCH = 100;
      const filesToSearch = files.slice(0, MAX_FILES_TO_SEARCH);

      if (files.length > MAX_FILES_TO_SEARCH) {
        console.log(
          `Limiting search to ${MAX_FILES_TO_SEARCH} out of ${files.length} files to avoid EMFILE errors`
        );
      }

      // Process files in batches to avoid too many open files
      const BATCH_SIZE = 10;
      for (let i = 0; i < filesToSearch.length; i += BATCH_SIZE) {
        const batch = filesToSearch.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (file: string) => {
          try {
            const fullPath = path.join(repoPath, file);
            const content = await this.safeReadFile(fullPath, {
              encoding: 'utf-8',
            });
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
            console.log(
              `Error reading file ${file}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
            return null;
          }
        });

        await Promise.all(batchPromises);
      }

      return results;
    } catch (error) {
      console.error(`Error searching code in ${repoFullName}:`, error);
      return [];
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

      await this.fileOpSemaphore.acquire();
      try {
        const result = await fs.readFile(fullPath, 'utf-8');
        return result.toString();
      } finally {
        this.fileOpSemaphore.release();
      }
    } catch (error) {
      console.error(
        `Error reading file ${filePath} from ${repoFullName}:`,
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

  /**
   * Get the default branch of a repository
   */
  async getDefaultBranch(repoFullName: string): Promise<string> {
    // Check if we have it cached
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (repoInfo && repoInfo.defaultBranch) {
      return repoInfo.defaultBranch;
    }

    try {
      const [owner, repo] = repoFullName.split('/');
      const octokit = await this.getOctokitForRepo(repoFullName);

      const { data } = await octokit.repos.get({ owner, repo });
      const defaultBranch = data.default_branch;

      // Cache the default branch
      if (repoInfo) {
        repoInfo.defaultBranch = defaultBranch;
        this.clonedRepos.set(repoFullName, repoInfo);
      }

      return defaultBranch;
    } catch (error) {
      console.error(`Error getting default branch for ${repoFullName}:`, error);
      // Fall back to main as default branch
      return 'main';
    }
  }

  /**
   * Create a new branch in a repository
   */
  async createBranch(
    branchName: string,
    repoFullName: string,
    baseBranch?: string
  ): Promise<void> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    const repoPath = repoInfo.localPath;

    // Get base branch if not provided
    const baseRef = baseBranch || (await this.getDefaultBranch(repoFullName));

    await this.gitOpSemaphore.acquire();
    try {
      // Checkout base branch first
      await git.checkout({
        fs,
        dir: repoPath,
        ref: baseRef,
      });

      // Fetch latest from remote
      const octokit = await this.getOctokitForRepo(repoFullName);
      const auth = await octokit.auth();
      const token =
        typeof auth === 'object' && auth !== null && 'token' in auth
          ? auth.token
          : '';

      await git.fetch({
        fs,
        http,
        dir: repoPath,
        url: `https://x-access-token:${token}@github.com/${repoFullName}.git`,
        ref: baseRef,
        singleBranch: true,
      });

      // Create new branch from current HEAD
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
    } finally {
      this.gitOpSemaphore.release();
    }
  }

  /**
   * Create or update a file in a repository
   */
  async createOrUpdateFile(
    filePath: string,
    content: string,
    commitMessage: string,
    repoFullName: string,
    branch: string
  ): Promise<void> {
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    const repoPath = repoInfo.localPath;
    const fullPath = path.join(repoPath, filePath);

    // Create directories if they don't exist
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    await this.fileOpSemaphore.acquire();
    try {
      // Write the file
      await fs.writeFile(fullPath, content);
      console.log(`File ${filePath} written to ${repoFullName}/${branch}`);
    } finally {
      this.fileOpSemaphore.release();
    }

    await this.gitOpSemaphore.acquire();
    try {
      // Add file to git
      await git.add({
        fs,
        dir: repoPath,
        filepath: filePath,
      });

      // Commit changes
      await git.commit({
        fs,
        dir: repoPath,
        message: commitMessage,
        author: {
          name: 'Linear Agent',
          email: 'agent@example.com',
        },
      });

      console.log(
        `Changes to ${filePath} committed to ${repoFullName}/${branch}`
      );

      // Push changes
      const octokit = await this.getOctokitForRepo(repoFullName);
      const auth = await octokit.auth();
      const token =
        typeof auth === 'object' && auth !== null && 'token' in auth
          ? auth.token
          : '';

      await git.push({
        fs,
        http,
        dir: repoPath,
        url: `https://x-access-token:${token}@github.com/${repoFullName}.git`,
        ref: branch,
      });

      console.log(`Changes to ${filePath} pushed to ${repoFullName}/${branch}`);
    } catch (error) {
      console.error(
        `Error updating file ${filePath} in ${repoFullName}/${branch}:`,
        error
      );
      throw error;
    } finally {
      this.gitOpSemaphore.release();
    }
  }

  /**
   * Create a pull request on GitHub
   * Note: This requires the GitHub API, it can't be done with local git operations
   */
  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
    repoFullName: string
  ): Promise<{ url: string }> {
    const [owner, repo] = repoFullName.split('/');

    try {
      // Get Octokit for this repo
      const octokit = await this.getOctokitForRepo(repoFullName);

      // Create the pull request
      const { data } = await octokit.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
      });

      console.log(`Created pull request #${data.number} in ${repoFullName}`);
      return { url: data.html_url };
    } catch (error) {
      console.error(`Error creating pull request in ${repoFullName}:`, error);
      throw error;
    }
  }
}
