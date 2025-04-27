import { Octokit } from '@octokit/rest';
import { env } from './env.js';
import { GitHubAppService } from './github-app.js';
import * as fs from 'fs/promises';
import { Stats, WriteFileOptions, MakeDirectoryOptions } from 'node:fs';
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
  localPath: string;
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

  constructor(
    private allowedRepositories: string[] = [],
    baseTempDir: string = path.join(os.tmpdir(), 'linear-agent-repos'),
    maxConcurrentFileOps: number = 20, // Reduced default
    maxConcurrentGitOps: number = 2 // Reduced default
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
   * Ensure a repository is cloned locally using isomorphic-git
   * with optimizations for serverless environments
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
      await this.safeMkdir(this.tempDir, { recursive: true });

      const repoPath = path.join(this.tempDir, repoFullName);
      const ownerPath = path.join(this.tempDir, owner);

      // Create owner directory if it doesn't exist
      await this.safeMkdir(ownerPath, { recursive: true });

      // Check if directory already exists and is not empty
      try {
        const repoDir = await this.safeReaddir(repoPath);
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
        await this.safeMkdir(repoPath, { recursive: true });
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

        // Clone the repository using isomorphic-git with optimizations
        console.log(`Cloning repository with optimized settings...`);

        // Create a limited FS implementation
        const limitedFS = this.createLimitedFS();

        // Get repo info from GitHub first to avoid cloning unnecessarily large repos
        const { data: repoData } = await octokit.repos.get({
          owner,
          repo,
        });

        if (repoData.size > 100000) {
          // Size is in KB
          console.warn(
            `Repository ${repoFullName} is very large (${repoData.size}KB). This may cause problems in serverless environments.`
          );
        }

        // Optimized clone that minimizes file operations
        const cloneOptions = {
          fs: limitedFS.promises,
          http,
          dir: repoPath,
          url: `https://x-access-token:${token}@github.com/${repoFullName}.git`,
          singleBranch: true,
          depth: 1, // Shallow clone
          noCheckout: false, // We need the files for searching
          noTags: true, // Skip tags
          cache: {
            fs: limitedFS.promises, // Cache results to minimize file operations
          },
          onProgress: (progress: {
            phase?: string;
            loaded: number;
            total?: number;
          }) => {
            // Only log occasional progress to reduce noise
            if (!progress.phase) return;

            if (progress.phase === 'Analyzing workdir') {
              if (progress.loaded % 1000 === 0) {
                console.log(
                  `Clone progress: ${progress.phase} (processing...)`
                );
              }
            } else if (progress.loaded % 50 === 0) {
              console.log(`Clone progress: ${progress.phase}`);
            }
          },
          corsProxy: undefined,
        };

        // Execute the clone with additional throttling and EMFILE protection
        console.log('Starting clone with controlled concurrency...');
        await git.clone(cloneOptions);

        console.log(`Successfully cloned ${repoFullName} to ${repoPath}`);

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
   * Search for code in the repository
   * Optimized to avoid EMFILE errors in serverless environments
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

      // First, list all files efficiently
      console.log(`Listing files in ${repoFullName}...`);
      const allFiles: string[] = [];

      // Use isomorphic-git to list files more efficiently
      const files = await git.listFiles({
        fs: this.createLimitedFS().promises,
        dir: repoPath,
        ref: 'HEAD',
      });

      // Apply filters to exclude common directories like node_modules
      const filteredFiles = files.filter(
        (file) =>
          !file.includes('node_modules/') &&
          !file.includes('.git/') &&
          !file.endsWith('.jpg') &&
          !file.endsWith('.png') &&
          !file.endsWith('.gif') &&
          !file.endsWith('.pdf')
      );

      // Limit number of files to search to avoid EMFILE
      const MAX_FILES_TO_SEARCH = 50;
      const filesToSearch = filteredFiles.slice(0, MAX_FILES_TO_SEARCH);

      console.log(
        `Found ${filteredFiles.length} files, searching through ${filesToSearch.length}`
      );

      // Search regex
      const searchRegex = new RegExp(query, 'i');

      // Process files in small batches to avoid EMFILE
      const BATCH_SIZE = 5;
      for (let i = 0; i < filesToSearch.length; i += BATCH_SIZE) {
        const batch = filesToSearch.slice(i, i + BATCH_SIZE);

        // Process one batch at a time
        for (const file of batch) {
          try {
            const fullPath = path.join(repoPath, file);
            const content = await this.safeReadFile(fullPath, {
              encoding: 'utf-8',
            });
            const lines = content.split('\n');

            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
              const line = lines[lineIndex];
              if (searchRegex.test(line)) {
                results.push({
                  path: file,
                  line: lineIndex + 1,
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
          }
        }
      }

      // If no results from content search, try filename search
      if (results.length === 0) {
        console.log('No content matches found, searching filenames...');

        // Search filenames for query terms
        const queryParts = query.toLowerCase().split(/\s+/);

        for (const file of filteredFiles) {
          const lowerFile = file.toLowerCase();
          // Check if any part of the query matches the filename
          if (
            queryParts.some(
              (part) => part.length > 3 && lowerFile.includes(part)
            )
          ) {
            try {
              // Just get the first line to provide some context
              const fullPath = path.join(repoPath, file);
              const content = await this.safeReadFile(fullPath, {
                encoding: 'utf-8',
              });
              const firstLine =
                content.split('\n')[0] || 'File matched by name';

              results.push({
                path: file,
                line: 1,
                content: firstLine.trim(),
              });

              // Limit filename matches to avoid overwhelming results
              if (results.length >= 20) break;
            } catch (err) {
              // If we can't read the file, still include it but without content
              results.push({
                path: file,
                line: 1,
                content: 'File matched by name',
              });
            }
          }
        }
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
      return await this.safeReadFile(fullPath, { encoding: 'utf-8' });
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

      // Process entries in batches to avoid EMFILE
      const BATCH_SIZE = 10;
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);

        for (const entry of batch) {
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
   * Get the default branch of a repository
   */
  async getDefaultBranch(repoFullName: string): Promise<string> {
    // Check if we have it cached
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (repoInfo && repoInfo.defaultBranch) {
      return repoInfo.defaultBranch;
    }

    try {
      await this.ensureRepoCloned(repoFullName);
      const repoPath = repoInfo?.localPath!;

      // Try to get from isomorphic-git
      await this.gitOpSemaphore.acquire();
      try {
        const currentBranch = await git.currentBranch({
          fs: this.createLimitedFS().promises,
          dir: repoPath,
          fullname: false,
        });

        const defaultBranch = currentBranch?.toString() || 'main';

        // Cache it
        if (repoInfo) {
          repoInfo.defaultBranch = defaultBranch;
          this.clonedRepos.set(repoFullName, repoInfo);
        }

        return defaultBranch;
      } finally {
        this.gitOpSemaphore.release();
      }
    } catch (error) {
      console.error(`Error getting default branch from isomorphic-git:`, error);

      // Fall back to GitHub API
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
      } catch (apiError) {
        console.error(
          `Error getting default branch for ${repoFullName}:`,
          apiError
        );
        // Fall back to main as default branch
        return 'main';
      }
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
        fs: this.createLimitedFS().promises,
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
        fs: this.createLimitedFS().promises,
        http,
        dir: repoPath,
        url: `https://x-access-token:${token}@github.com/${repoFullName}.git`,
        ref: baseRef,
        singleBranch: true,
        depth: 1,
      });

      // Create new branch from current HEAD
      await git.branch({
        fs: this.createLimitedFS().promises,
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
    await this.safeMkdir(path.dirname(fullPath), { recursive: true });

    // Write the file
    await this.safeWriteFile(fullPath, content);
    console.log(`File ${filePath} written to ${repoFullName}/${branch}`);

    await this.gitOpSemaphore.acquire();
    try {
      // Add file to git
      await git.add({
        fs: this.createLimitedFS().promises,
        dir: repoPath,
        filepath: filePath,
      });

      // Commit changes
      await git.commit({
        fs: this.createLimitedFS().promises,
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
        fs: this.createLimitedFS().promises,
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
