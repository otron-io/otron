import { Octokit } from '@octokit/rest';
import { env } from './env.js';
import { GitHubAppService } from './github-app.js';
import * as fs from 'fs/promises';
import { Stats } from 'node:fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
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
   * Get file content using git cat-file instead of fs.readFile
   * This is more efficient for git repositories as it reads from git objects
   */
  private async gitCatFile(
    repoPath: string,
    filePath: string,
    ref: string = 'HEAD'
  ): Promise<string> {
    await this.gitOpSemaphore.acquire();
    try {
      const { stdout } = await runGitCommand(repoPath, [
        'cat-file',
        '-p',
        `${ref}:${filePath}`,
      ]);
      return stdout;
    } catch (error) {
      console.error(`Error reading file ${filePath} with git cat-file:`, error);
      throw error;
    } finally {
      this.gitOpSemaphore.release();
    }
  }

  /**
   * Get a list of all files in a repository using git ls-files
   * Much faster than walking the directory
   */
  private async gitLsFiles(
    repoPath: string,
    patterns: string[] = []
  ): Promise<string[]> {
    await this.gitOpSemaphore.acquire();
    try {
      const args = ['ls-files', '--full-name', '--', ...patterns];
      const { stdout } = await runGitCommand(repoPath, args);
      return stdout.trim().split('\n').filter(Boolean);
    } catch (error) {
      console.error(`Error listing files with git ls-files:`, error);
      return [];
    } finally {
      this.gitOpSemaphore.release();
    }
  }

  /**
   * Search for patterns in files using git grep
   * Much more efficient than reading each file separately
   */
  private async gitGrep(
    repoPath: string,
    pattern: string,
    filePatterns: string[] = []
  ): Promise<Array<{ path: string; line: number; content: string }>> {
    await this.gitOpSemaphore.acquire();
    try {
      // Use git grep with line numbers and null-byte output for reliable parsing
      const args = [
        'grep',
        '-n', // Show line numbers
        '-I', // Ignore binary files
        '-z', // Use null byte as separator
        '--no-color', // No color codes
        pattern,
        'HEAD', // Search in HEAD
        '--', // Separator for paths
        ...filePatterns, // Add file patterns if specified
      ];

      const { stdout } = await runGitCommand(repoPath, args);

      // Parse the output format: path\0linenumber:content\0
      const results: Array<{ path: string; line: number; content: string }> =
        [];

      if (!stdout.trim()) {
        return results;
      }

      const entries = stdout.split('\0');

      // Process each entry (path\0linenumber:content)
      for (let i = 0; i < entries.length - 1; i++) {
        // Last entry is empty due to trailing \0
        const entry = entries[i];
        if (!entry) continue;

        // Format is "path:line:content"
        const firstColon = entry.indexOf(':');
        if (firstColon === -1) continue;

        const path = entry.substring(0, firstColon);
        const rest = entry.substring(firstColon + 1);

        const secondColon = rest.indexOf(':');
        if (secondColon === -1) continue;

        const lineStr = rest.substring(0, secondColon);
        const content = rest.substring(secondColon + 1);

        const line = parseInt(lineStr, 10);
        if (isNaN(line)) continue;

        results.push({
          path,
          line,
          content: content.trim(),
        });
      }

      return results;
    } catch (error) {
      console.error(`Error searching with git grep:`, error);
      return [];
    } finally {
      this.gitOpSemaphore.release();
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
            // Handle progress reporting in a better way
            if (progress.phase === 'Analyzing workdir') {
              // Only log occasionally for this phase to avoid spam
              if (progress.loaded % 100 === 0) {
                console.log(
                  `Clone progress: ${progress.phase} (processing files...)`
                );
              }
            } else if (progress.phase && progress.loaded % 10 === 0) {
              // For other phases, cap at 100%
              const percentage = Math.min(
                100,
                Math.round((progress.loaded / (progress.total || 100)) * 100)
              );
              console.log(`Clone progress: ${progress.phase} ${percentage}%`);
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
   * Search for code in the local repository using git grep
   * instead of reading all files individually
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

      // Search using git grep instead of reading each file
      console.log(`Searching for "${query}" in ${repoFullName} using git grep`);

      // Attempt to use git-grep for searching (much faster)
      // Define file types to search in to reduce search scope
      const filePatterns = [
        '*.js',
        '*.jsx',
        '*.ts',
        '*.tsx', // JavaScript/TypeScript
        '*.py',
        '*.rb',
        '*.php',
        '*.java', // Other popular languages
        '*.go',
        '*.c',
        '*.cpp',
        '*.h',
        '*.cs', // More languages
        '*.json',
        '*.yml',
        '*.yaml', // Config files
        '*.md',
        '*.txt', // Documentation
      ];

      // Progressive search approach:
      // 1. First try exact pattern with git grep (fastest)
      // 2. If no results, try a more flexible regex pattern
      // 3. If still no results, fall back to filename search

      // Step 1: Try direct git grep with exact pattern
      let results = await this.gitGrep(repoPath, query, filePatterns);

      // Step 2: If no results, try a more flexible search
      if (results.length === 0 && query.length > 3) {
        console.log('No exact matches, trying more flexible search...');
        // Create a more flexible pattern by breaking up the query
        const words = query.split(/\s+/).filter((w) => w.length > 3);

        // Try searching for individual words from the query
        for (const word of words) {
          const wordResults = await this.gitGrep(repoPath, word, filePatterns);
          results.push(...wordResults);

          // If we found enough results, stop searching
          if (results.length >= 20) break;
        }
      }

      // Step 3: If still no results, try searching in filenames
      if (results.length === 0) {
        console.log('No content matches, searching in filenames...');
        const files = await this.gitLsFiles(repoPath);

        // Find files that match parts of the query
        const words = query.toLowerCase().split(/\s+/);
        const matchingFiles = files
          .filter((file) => {
            const lowerFile = file.toLowerCase();
            return words.some((word) => lowerFile.includes(word));
          })
          .slice(0, 20);

        // For each matching file, add it to results with a sample line
        for (const file of matchingFiles) {
          try {
            // Read just the first few lines of the file to get a sample
            const content = await this.gitCatFile(repoPath, file);
            const firstLine = content.split('\n')[0] || 'File matched by name';

            results.push({
              path: file,
              line: 1,
              content: firstLine.trim(),
            });
          } catch (err) {
            // Skip files we can't read
            console.log(
              `Error reading file ${file}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }

      // Sort results by relevance (exact matches first, then by path similarity to query)
      results.sort((a, b) => {
        // Exact content matches get highest priority
        const aExact = a.content.includes(query);
        const bExact = b.content.includes(query);

        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        // Then prioritize by filename matches
        const aFileMatch = a.path.includes(query);
        const bFileMatch = b.path.includes(query);

        if (aFileMatch && !bFileMatch) return -1;
        if (!aFileMatch && bFileMatch) return 1;

        // Finally sort by path
        return a.path.localeCompare(b.path);
      });

      // Limit to most relevant results
      return results.slice(0, 50);
    } catch (error) {
      console.error(`Error searching code in ${repoFullName}:`, error);

      // Fall back to lightweight file search if grep fails
      console.log('Falling back to file name search only...');
      try {
        const repoPath = repoInfo.localPath;
        const files = await this.gitLsFiles(repoPath);

        // Find files that might be relevant based on name
        const relevantFiles = files
          .filter((file) => {
            const lowercaseFile = file.toLowerCase();
            const lowercaseQuery = query.toLowerCase();
            return (
              lowercaseFile.includes(lowercaseQuery) ||
              query
                .split(/\s+/)
                .some((word) => lowercaseFile.includes(word.toLowerCase()))
            );
          })
          .slice(0, 20);

        return relevantFiles.map((file) => ({
          path: file,
          line: 1,
          content: 'File matched by name',
        }));
      } catch (fallbackError) {
        console.error('Fallback search also failed:', fallbackError);
        return [];
      }
    }
  }

  /**
   * Get the content of a file from the local repository
   * Uses git cat-file instead of fs.readFile
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

      // Use git cat-file to get file content
      // This is more efficient than reading from the file system
      return await this.gitCatFile(repoPath, filePath);
    } catch (error) {
      console.error(
        `Error reading file ${filePath} from ${repoFullName} with git cat-file:`,
        error
      );

      // Fall back to regular file system if git cat-file fails
      console.log('Falling back to regular file reading...');
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
      } catch (fallbackError) {
        console.error('Fallback file reading also failed:', fallbackError);
        throw error; // Throw the original error
      }
    }
  }

  /**
   * Walk a directory recursively to find all files with an optional filter
   * This method is deprecated - use gitLsFiles instead for better performance
   */
  async walkDirectory(
    dirPath: string,
    repoFullName: string,
    filter?: (filePath: string) => boolean
  ): Promise<string[]> {
    console.log('Note: walkDirectory is deprecated, consider using gitLsFiles');
    await this.ensureRepoCloned(repoFullName);
    const repoInfo = this.clonedRepos.get(repoFullName);
    if (!repoInfo) throw new Error(`Repository ${repoFullName} not found`);

    // Try to use git ls-files first (much faster)
    try {
      const repoPath = repoInfo.localPath;
      const fullPath = path.join(repoPath, dirPath);
      const relDir = dirPath ? `${dirPath}/` : '';

      // Use git ls-files to get all files
      const files = await this.gitLsFiles(repoPath);

      // Filter files based on the provided path and filter function
      return files
        .filter((file) => file.startsWith(relDir))
        .filter((file) => !filter || filter(file));
    } catch (error) {
      console.error(
        'Git ls-files failed, falling back to directory walk:',
        error
      );

      // Fall back to original implementation
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
      } catch (walkError) {
        console.error(
          `Error walking directory ${dirPath} in ${repoFullName}:`,
          walkError
        );
        throw walkError;
      }
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
      // Ensure repo is cloned
      await this.ensureRepoCloned(repoFullName);
      const repoPath = repoInfo?.localPath!;

      // Try to get default branch from git directly
      await this.gitOpSemaphore.acquire();
      try {
        const { stdout } = await runGitCommand(repoPath, [
          'symbolic-ref',
          '--short',
          'HEAD',
        ]);

        const defaultBranch = stdout.trim();

        // Cache the default branch
        if (repoInfo) {
          repoInfo.defaultBranch = defaultBranch;
          this.clonedRepos.set(repoFullName, repoInfo);
        }

        return defaultBranch;
      } finally {
        this.gitOpSemaphore.release();
      }
    } catch (error) {
      console.error(`Error getting default branch from git:`, error);

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
      // Use git command for better reliability
      await runGitCommand(repoPath, ['checkout', baseRef]);

      // Fetch latest from remote
      const octokit = await this.getOctokitForRepo(repoFullName);
      const auth = await octokit.auth();
      const token =
        typeof auth === 'object' && auth !== null && 'token' in auth
          ? auth.token
          : '';

      const remote = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
      await runGitCommand(repoPath, ['fetch', 'origin', baseRef, '--depth=1']);

      // Create and checkout the new branch
      await runGitCommand(repoPath, ['checkout', '-b', branchName]);

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
      // Make sure we're on the right branch
      await runGitCommand(repoPath, ['checkout', branch]);

      // Add file to git
      await runGitCommand(repoPath, ['add', filePath]);

      // Commit changes
      await runGitCommand(repoPath, [
        'commit',
        '-m',
        commitMessage,
        '--author=Linear Agent <agent@example.com>',
      ]);

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

      // Configure remote URL with token
      await runGitCommand(repoPath, [
        'remote',
        'set-url',
        'origin',
        `https://x-access-token:${token}@github.com/${repoFullName}.git`,
      ]);

      // Push changes
      await runGitCommand(repoPath, ['push', 'origin', branch]);

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
