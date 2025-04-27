import { Octokit } from '@octokit/rest';
import { env } from './env.js';
import { GitHubAppService } from './github-app.js';
import * as fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
// @ts-ignore - isomorphic-git doesn't have type definitions in DefinitelyTyped
import git from 'isomorphic-git';
// @ts-ignore - isomorphic-git http client
import http from 'isomorphic-git/http/node/index.js';

// Types for fs operations
type FSWrite = {
  encoding?: BufferEncoding;
  mode?: number;
  flag?: string;
};

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
  localPath?: string; // Make localPath optional since we don't use it in API-based approach
}

/**
 * Run a Git command in a specific directory
 */
async function runGitCommand(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const process = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Git command failed: ${stderr}`));
      }
    });

    process.on('error', (err) => {
      reject(new Error(`Failed to spawn git process: ${err.message}`));
    });
  });
}

// Cache interfaces
interface FileContentCache {
  [key: string]: {
    content: string;
    timestamp: number;
  };
}

interface SearchResultCache {
  [key: string]: {
    results: Array<{ path: string; line: number; content: string }>;
    timestamp: number;
  };
}

// GitHub API rate limiter
class APIRateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private requestsPerSecond: number;

  constructor(requestsPerSecond: number = 5) {
    this.requestsPerSecond = requestsPerSecond;
  }

  public async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const task = this.queue.shift();

    if (task) {
      try {
        await task();
      } catch (error) {
        console.error('Error processing task:', error);
      }
    }

    // Delay to respect rate limits
    await new Promise((resolve) =>
      setTimeout(resolve, 1000 / this.requestsPerSecond)
    );
    this.processQueue();
  }
}

/*
 * LocalRepositoryManager
 *
 * This class manages local git repositories, minimizing GitHub API usage
 * to avoid rate limits. Most operations use Git commands to work with
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
  private repoCache: Map<string, RepoInfo> = new Map();
  private fileContentCache: FileContentCache = {};
  private searchResultCache: SearchResultCache = {};
  private rateLimiter: APIRateLimiter;

  // Cache expiration times (in milliseconds)
  private static CACHE_TTL = {
    FILE_CONTENT: 5 * 60 * 1000, // 5 minutes
    SEARCH_RESULTS: 2 * 60 * 1000, // 2 minutes
  };

  constructor(
    private allowedRepositories: string[] = [],
    baseTempDir: string = path.join(os.tmpdir(), 'linear-agent-repos'),
    maxConcurrentFileOps: number = 20, // Reduced default
    maxConcurrentGitOps: number = 2, // Reduced default
    requestsPerSecond: number = 20 / 60 // Reduced default
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

    // Initialize the rate limiter - GitHub search API allows 30 requests per minute
    // We'll use a more conservative 20 per minute to be safe
    this.rateLimiter = new APIRateLimiter(requestsPerSecond);
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
   * Wrapper around fs.writeFile to limit concurrent file operations
   */
  private async safeWriteFile(
    filePath: string,
    data: string | Uint8Array,
    options?: FSWrite
  ): Promise<void> {
    await this.fileOpSemaphore.acquire();
    try {
      await fs.writeFile(filePath, data, options);
    } finally {
      this.fileOpSemaphore.release();
    }
  }

  /**
   * Safely read directory contents with concurrency control
   */
  private async safeReaddir(dirPath: string): Promise<string[]> {
    await this.fileOpSemaphore.acquire();
    try {
      return await fs.readdir(dirPath);
    } finally {
      this.fileOpSemaphore.release();
    }
  }

  /**
   * Safely create directory with concurrency control
   */
  private async safeMkdir(
    dirPath: string,
    options?: { recursive?: boolean; mode?: number }
  ): Promise<void> {
    await this.fileOpSemaphore.acquire();
    try {
      await fs.mkdir(dirPath, options);
    } finally {
      this.fileOpSemaphore.release();
    }
  }

  /**
   * Create a custom FS implementation for isomorphic-git that limits concurrent operations
   */
  private createLimitedFS() {
    const self = this;
    return {
      promises: {
        async readFile(
          path: string,
          options?: { encoding?: BufferEncoding; flag?: string }
        ) {
          return self.safeReadFile(path, options);
        },
        async writeFile(
          path: string,
          data: string | Uint8Array,
          options?: FSWrite
        ) {
          return self.safeWriteFile(path, data, options);
        },
        async unlink(path: string) {
          await self.fileOpSemaphore.acquire();
          try {
            return await fs.unlink(path);
          } finally {
            self.fileOpSemaphore.release();
          }
        },
        async readdir(path: string) {
          return self.safeReaddir(path);
        },
        async mkdir(
          path: string,
          options?: { recursive?: boolean; mode?: number }
        ) {
          return self.safeMkdir(path, options);
        },
        async rmdir(path: string) {
          await self.fileOpSemaphore.acquire();
          try {
            return await fs.rmdir(path);
          } finally {
            self.fileOpSemaphore.release();
          }
        },
        async stat(path: string) {
          await self.fileOpSemaphore.acquire();
          try {
            return await fs.stat(path);
          } finally {
            self.fileOpSemaphore.release();
          }
        },
        async lstat(path: string) {
          await self.fileOpSemaphore.acquire();
          try {
            return await fs.lstat(path);
          } finally {
            self.fileOpSemaphore.release();
          }
        },
        async readlink(path: string) {
          await self.fileOpSemaphore.acquire();
          try {
            return await fs.readlink(path);
          } finally {
            self.fileOpSemaphore.release();
          }
        },
        async symlink(target: string, path: string) {
          await self.fileOpSemaphore.acquire();
          try {
            return await fs.symlink(target, path);
          } finally {
            self.fileOpSemaphore.release();
          }
        },
      },
    };
  }

  /**
   * Ensure a repository is accessible and get basic info
   */
  async ensureRepoCloned(repoFullName: string): Promise<string> {
    if (this.repoCache.has(repoFullName)) {
      // We're only returning the repo name since we don't have local paths in the API implementation
      return repoFullName;
    }

    const [owner, repo] = repoFullName.split('/');

    if (
      this.allowedRepositories.length > 0 &&
      !this.allowedRepositories.includes(repoFullName)
    ) {
      throw new Error(`Repository ${repoFullName} is not in the allowed list`);
    }

    try {
      // Get repository info from GitHub API
      console.log(`Getting info for ${repoFullName}...`);
      const octokit = await this.getOctokitForRepo(repoFullName);

      const { data: repoData } = await octokit.repos.get({
        owner,
        repo,
      });

      // Store repo info in cache
      this.repoCache.set(repoFullName, {
        owner,
        repo,
        defaultBranch: repoData.default_branch,
      });

      console.log(`Repository ${repoFullName} verified and available`);
      return repoFullName; // Return repo name as we don't have a local path
    } catch (error: any) {
      // Handle authentication errors
      if (error.status === 401) {
        console.error(`Authentication error for ${repoFullName}:`, error);
        if (this.githubAppService) {
          throw new Error(
            `Authentication error with GitHub App. Check app permissions and installation.`
          );
        } else {
          throw new Error(`Authentication error. Check GitHub token.`);
        }
      }

      // Handle not found errors
      if (error.status === 404) {
        throw new Error(`Repository ${repoFullName} not found or no access`);
      }

      console.error(`Error accessing repository ${repoFullName}:`, error);
      throw error;
    }
  }

  /**
   * Search for code in the repository using GitHub's code search API
   * with intelligent caching and efficient query strategies
   */
  async searchCode(
    query: string,
    repoFullName: string
  ): Promise<Array<{ path: string; line: number; content: string }>> {
    await this.ensureRepoCloned(repoFullName);

    // Generate a cache key
    const cacheKey = `${repoFullName}:${query}`;

    // Check cache first
    const cachedResult = this.searchResultCache[cacheKey];
    if (
      cachedResult &&
      Date.now() - cachedResult.timestamp <
        LocalRepositoryManager.CACHE_TTL.SEARCH_RESULTS
    ) {
      console.log(
        `Using cached search results for "${query}" in ${repoFullName}`
      );
      return cachedResult.results;
    }

    try {
      console.log(
        `Searching for "${query}" in ${repoFullName} using GitHub API`
      );

      // Get Octokit instance for this repo
      const octokit = await this.getOctokitForRepo(repoFullName);

      // Use rate limiter to prevent hitting GitHub API limits
      const results = await this.rateLimiter.enqueue(async () => {
        // Performing GitHub search
        // The GitHub search API is quite powerful but has limitations
        const searchQuery = `repo:${repoFullName} ${query}`;

        // First try an exact search
        const { data: searchData } = await octokit.search.code({
          q: searchQuery,
          per_page: 30,
        });

        const matchResults: Array<{
          path: string;
          line: number;
          content: string;
        }> = [];

        // Process each search result
        for (const item of searchData.items) {
          // We need to get the file content to find the matching line
          const fileContent = await this.getFileContent(
            item.path,
            repoFullName
          );

          // Find matching lines
          const lines = fileContent.split('\n');
          const lowercaseQuery = query.toLowerCase();

          let foundMatch = false;

          // Look for matches in each line
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.toLowerCase().includes(lowercaseQuery)) {
              matchResults.push({
                path: item.path,
                line: i + 1,
                content: line.trim(),
              });
              foundMatch = true;
              // Only include the first match per file to avoid overwhelming results
              break;
            }
          }

          // If no specific line matched but the file matched, include the first line
          if (!foundMatch) {
            matchResults.push({
              path: item.path,
              line: 1,
              content: lines[0]?.trim() || 'File matched by name',
            });
          }
        }

        return matchResults;
      });

      // Cache the search results
      this.searchResultCache[cacheKey] = {
        results,
        timestamp: Date.now(),
      };

      return results;
    } catch (error) {
      console.error(`Error searching code in ${repoFullName}:`, error);

      // If search fails, try a different approach - check if we have any text matches
      if (query.length > 3) {
        try {
          console.log('Falling back to filename search...');
          const [owner, repo] = repoFullName.split('/');
          const octokit = await this.getOctokitForRepo(repoFullName);

          // Get some files from the repository that might be relevant by name
          const { data: contentsData } = await octokit.repos.getContent({
            owner,
            repo,
            path: '',
          });

          const results: Array<{
            path: string;
            line: number;
            content: string;
          }> = [];

          // If we got a directory listing, look for files with names matching parts of the query
          if (Array.isArray(contentsData)) {
            const queryParts = query.toLowerCase().split(/\s+/);

            for (const item of contentsData) {
              if (item.type === 'file') {
                const lowerName = item.name.toLowerCase();
                if (
                  queryParts.some(
                    (part) => part.length > 3 && lowerName.includes(part)
                  )
                ) {
                  results.push({
                    path: item.path,
                    line: 1,
                    content: 'File matched by name',
                  });
                }
              }
            }

            return results;
          }
        } catch (fallbackError) {
          console.error('Fallback search also failed:', fallbackError);
        }
      }

      return [];
    }
  }

  /**
   * Get the content of a file using the GitHub API
   * Implements caching to minimize API calls
   */
  async getFileContent(
    filePath: string,
    repoFullName: string
  ): Promise<string> {
    await this.ensureRepoCloned(repoFullName);

    // Generate cache key
    const cacheKey = `${repoFullName}:${filePath}`;

    // Check cache first
    const cachedContent = this.fileContentCache[cacheKey];
    if (
      cachedContent &&
      Date.now() - cachedContent.timestamp <
        LocalRepositoryManager.CACHE_TTL.FILE_CONTENT
    ) {
      console.log(`Using cached content for ${filePath} in ${repoFullName}`);
      return cachedContent.content;
    }

    try {
      const [owner, repo] = repoFullName.split('/');
      const octokit = await this.getOctokitForRepo(repoFullName);

      // Use rate limiter to prevent hitting GitHub API limits
      const content = await this.rateLimiter.enqueue(async () => {
        console.log(
          `Fetching content of ${filePath} from ${repoFullName} via GitHub API`
        );

        // Get the file content from GitHub API
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path: filePath,
        });

        if ('content' in data && typeof data.content === 'string') {
          // Decode base64 content
          const content = Buffer.from(data.content, 'base64').toString('utf-8');
          return content;
        } else {
          throw new Error(`Unexpected response format for ${filePath}`);
        }
      });

      // Store in cache
      this.fileContentCache[cacheKey] = {
        content,
        timestamp: Date.now(),
      };

      return content;
    } catch (error) {
      console.error(
        `Error getting file content for ${filePath} from ${repoFullName}:`,
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

    try {
      const [owner, repo] = repoFullName.split('/');
      const octokit = await this.getOctokitForRepo(repoFullName);

      // Use rate limiter to prevent hitting GitHub API limits
      return await this.rateLimiter.enqueue(async () => {
        console.log(
          `Listing contents of ${
            dirPath || '/'
          } in ${repoFullName} via GitHub API`
        );

        // GitHub API doesn't have a recursive directory listing, so we need to recursively
        // traverse the directory structure. This is less efficient than a local walk, but
        // is the best we can do with the API.
        const results: string[] = [];

        async function walk(currentPath: string): Promise<void> {
          const { data: contents } = await octokit.repos.getContent({
            owner,
            repo,
            path: currentPath === '' ? '' : currentPath,
          });

          if (!Array.isArray(contents)) {
            // This is a file, not a directory
            return;
          }

          for (const item of contents) {
            const itemPath = item.path;

            if (item.type === 'dir') {
              // Skip node_modules and .git directories
              if (
                itemPath.includes('node_modules/') ||
                itemPath.includes('.git/')
              ) {
                continue;
              }
              await walk(itemPath);
            } else if (item.type === 'file') {
              if (!filter || filter(itemPath)) {
                results.push(itemPath);
              }
            }
          }
        }

        await walk(dirPath || '');
        return results;
      });
    } catch (error) {
      console.error(
        `Error walking directory ${dirPath} in ${repoFullName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get the default branch of a repository
   */
  async getDefaultBranch(repoFullName: string): Promise<string> {
    // Check if we have it cached
    const repoInfo = this.repoCache.get(repoFullName);
    if (repoInfo && repoInfo.defaultBranch) {
      return repoInfo.defaultBranch;
    }

    try {
      // Get it from GitHub API
      const [owner, repo] = repoFullName.split('/');
      const octokit = await this.getOctokitForRepo(repoFullName);

      const { data } = await octokit.repos.get({ owner, repo });
      const defaultBranch = data.default_branch;

      // Cache the default branch
      if (repoInfo) {
        repoInfo.defaultBranch = defaultBranch;
        this.repoCache.set(repoFullName, repoInfo);
      } else {
        this.repoCache.set(repoFullName, {
          owner,
          repo,
          defaultBranch,
        });
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

    try {
      const [owner, repo] = repoFullName.split('/');
      const octokit = await this.getOctokitForRepo(repoFullName);

      // Get base branch if not provided
      const baseRef = baseBranch || (await this.getDefaultBranch(repoFullName));

      // First get the SHA of the latest commit on the base branch
      const { data: refData } = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${baseRef}`,
      });

      const baseSha = refData.object.sha;

      // Create the new branch pointing to the same commit
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      });

      console.log(
        `Created branch ${branchName} in ${repoFullName} based on ${baseRef}`
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

    try {
      const [owner, repo] = repoFullName.split('/');
      const octokit = await this.getOctokitForRepo(repoFullName);

      // Check if the file already exists to get its SHA if it does
      let sha: string | undefined;
      try {
        const { data: fileData } = await octokit.repos.getContent({
          owner,
          repo,
          path: filePath,
          ref: branch,
        });

        if ('sha' in fileData) {
          sha = fileData.sha;
        }
      } catch (error) {
        // File doesn't exist yet, which is fine
      }

      // Create or update the file
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: commitMessage,
        content: Buffer.from(content).toString('base64'),
        branch,
        sha, // Include SHA if updating an existing file
      });

      console.log(`File ${filePath} updated in ${repoFullName}/${branch}`);

      // Clear the file cache if it exists
      const cacheKey = `${repoFullName}:${filePath}`;
      if (this.fileContentCache[cacheKey]) {
        delete this.fileContentCache[cacheKey];
      }
    } catch (error) {
      console.error(
        `Error updating file ${filePath} in ${repoFullName}/${branch}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Create a pull request on GitHub
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

  /**
   * Cleanup method - with API-based implementation, we just clear caches
   */
  async cleanup(): Promise<void> {
    // Clear all caches
    this.fileContentCache = {};
    this.searchResultCache = {};
    console.log(`Cleared all caches`);
  }
}
