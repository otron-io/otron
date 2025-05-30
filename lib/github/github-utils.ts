import { Octokit } from '@octokit/rest';
import { GitHubAppService } from './github-app.js';

// Get GitHub App service instance
const githubAppService = GitHubAppService.getInstance();

// Simple in-memory cache for file content
const fileCache = new Map<string, { content: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get an authenticated Octokit client for a repository
 */
const getOctokitForRepo = async (repository: string): Promise<Octokit> => {
  return await githubAppService.getOctokitForRepo(repository);
};

/**
 * Get the content of a file from GitHub, optionally limited to a range of lines
 */
export const getFileContent = async (
  path: string,
  repository: string,
  startLine: number = 1,
  maxLines: number = 200,
  branch?: string
): Promise<string> => {
  try {
    // Validate line ranges
    if (startLine < 1) startLine = 1;
    if (maxLines > 200) maxLines = 200;

    // Check cache
    const cacheKey = `${repository}:${path}:${branch || 'default'}`;
    const cached = fileCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`Using cached content for ${path} in ${repository}`);
      const allLines = cached.content.split('\n');
      const totalLines = allLines.length;
      const endLine = Math.min(startLine + maxLines - 1, totalLines);
      const requestedLines = allLines.slice(startLine - 1, endLine);
      const lineInfo = `// Lines ${startLine}-${endLine} of ${totalLines}\n`;
      return lineInfo + requestedLines.join('\n');
    }

    console.log(
      `Fetching content of ${path} from ${repository}${
        branch ? ` (branch: ${branch})` : ''
      }`
    );
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (!('content' in data) || typeof data.content !== 'string') {
      throw new Error(`Unexpected response format for ${path}`);
    }

    // Decode base64 content
    const content = Buffer.from(data.content, 'base64').toString('utf-8');

    // Cache the full content
    fileCache.set(cacheKey, {
      content,
      timestamp: Date.now(),
    });

    // Split into lines and extract the requested range
    const allLines = content.split('\n');
    const totalLines = allLines.length;
    const endLine = Math.min(startLine + maxLines - 1, totalLines);
    const requestedLines = allLines.slice(startLine - 1, endLine);
    const lineInfo = `// Lines ${startLine}-${endLine} of ${totalLines}\n`;
    return lineInfo + requestedLines.join('\n');
  } catch (error: any) {
    console.error(
      `Error getting file content for ${path} from ${repository}:`,
      error
    );
    if (error.status === 404) {
      return `# File not found: ${path}${branch ? ` (branch: ${branch})` : ''}`;
    }
    return `# Error retrieving content for ${path}${
      branch ? ` (branch: ${branch})` : ''
    }`;
  }
};

/**
 * Get the default branch of a repository
 */
export const getDefaultBranch = async (repository: string): Promise<string> => {
  const [owner, repo] = repository.split('/');
  try {
    const octokit = await getOctokitForRepo(repository);
    const { data } = await octokit.repos.get({ owner, repo });
    return data.default_branch;
  } catch (error) {
    console.error(`Error getting default branch for ${repository}:`, error);
    return 'main'; // Fallback to main
  }
};

/**
 * Create a branch in the repository
 */
export const createBranch = async (
  branch: string,
  repository: string,
  baseBranch?: string
): Promise<void> => {
  const [owner, repo] = repository.split('/');

  try {
    // Get base branch if not provided
    const baseRef = baseBranch || (await getDefaultBranch(repository));
    const octokit = await getOctokitForRepo(repository);

    // Get SHA of latest commit on base branch
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseRef}`,
    });

    // Create new branch
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: refData.object.sha,
    });

    console.log(`Created branch ${branch} in ${repository}`);
  } catch (error) {
    console.error(`Error creating branch ${branch} in ${repository}:`, error);
    throw error;
  }
};

/**
 * Reset a branch to the head of another branch (or default branch)
 */
export const resetBranchToHead = async (
  repository: string,
  branch: string,
  baseBranch?: string
): Promise<void> => {
  const [owner, repo] = repository.split('/');

  try {
    // Get base branch if not provided
    const baseRef = baseBranch || (await getDefaultBranch(repository));
    const octokit = await getOctokitForRepo(repository);

    // Get SHA of latest commit on base branch
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseRef}`,
    });

    try {
      // Try to update the existing branch
      await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: refData.object.sha,
        force: true, // Force update to reset the branch
      });

      console.log(
        `Reset branch ${branch} to head of ${baseRef} in ${repository}`
      );
    } catch (updateError: any) {
      // If the branch doesn't exist (422 error), create it instead
      if (updateError.status === 422) {
        console.log(`Branch ${branch} doesn't exist, creating it instead...`);

        await octokit.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${branch}`,
          sha: refData.object.sha,
        });

        console.log(
          `Created branch ${branch} from head of ${baseRef} in ${repository}`
        );
      } else {
        // Re-throw other errors
        throw updateError;
      }
    }
  } catch (error) {
    console.error(`Error resetting branch ${branch} in ${repository}:`, error);
    throw error;
  }
};

/**
 * Create or update a file in a repository
 */
export const createOrUpdateFile = async (
  path: string,
  content: string,
  message: string,
  repository: string,
  branch: string
): Promise<void> => {
  console.log('🔧 createOrUpdateFile CALLED');
  console.log('Parameters:', {
    path,
    contentLength: content.length,
    message,
    repository,
    branch,
  });

  const [owner, repo] = repository.split('/');

  try {
    console.log('🔑 Getting Octokit client for repository...');
    const octokit = await getOctokitForRepo(repository);
    console.log('✅ Got Octokit client');

    // Check if file exists to get SHA
    let sha: string | undefined;
    try {
      console.log('📖 Checking if file exists to get SHA...');
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });

      if ('sha' in data) {
        sha = data.sha;
        console.log('✅ File exists, got SHA:', sha.substring(0, 8) + '...');
      }
    } catch (error) {
      // File doesn't exist yet, which is fine
      console.log("📝 File doesn't exist yet, will create new file");
    }

    console.log('💾 Creating/updating file via GitHub API...');
    // Create or update file
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      sha,
    });

    console.log(`✅ File ${path} updated in ${repository}/${branch}`);

    // Clear cache for this file
    const cacheKey = `${repository}:${path}:${branch}`;
    fileCache.delete(cacheKey);
    const defaultCacheKey = `${repository}:${path}:default`;
    fileCache.delete(defaultCacheKey);
    console.log('🗑️ Cleared file cache');
  } catch (error) {
    console.error(
      `❌ Error updating file ${path} in ${repository}/${branch}:`,
      error
    );
    throw error;
  }
};

/**
 * Create a pull request
 */
export const createPullRequest = async (
  title: string,
  body: string,
  head: string,
  base: string,
  repository: string
): Promise<{ url: string; number: number }> => {
  const [owner, repo] = repository.split('/');

  try {
    const octokit = await getOctokitForRepo(repository);

    // Check if head branch exists first
    try {
      await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${head}`,
      });
      console.log(`Branch ${head} exists, proceeding with PR creation`);
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error(
          `Branch ${head} does not exist. Create it before making a PR.`
        );
      }
      console.warn(`Warning when checking branch ${head}: ${error.message}`);
    }

    // Create the pull request
    const { data } = await octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });

    console.log(`Created pull request #${data.number} in ${repository}`);
    return { url: data.html_url, number: data.number };
  } catch (error) {
    console.error(`Error creating pull request in ${repository}:`, error);
    throw error;
  }
};

/**
 * Update a pull request (title, body, state)
 */
export const updatePullRequest = async (
  repository: string,
  pullNumber: number,
  updates: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    base?: string;
  }
): Promise<void> => {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    await octokit.pulls.update({
      owner,
      repo,
      pull_number: pullNumber,
      ...updates,
    });

    console.log(`Updated pull request #${pullNumber} in ${repository}`);
  } catch (error) {
    console.error(
      `Error updating pull request #${pullNumber} in ${repository}:`,
      error
    );
    throw error;
  }
};

/**
 * Add a comment to a pull request
 */
export const addPullRequestComment = async (
  repository: string,
  pullNumber: number,
  body: string
): Promise<{ id: number; url: string }> => {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    const { data } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });

    console.log(
      `Added comment to pull request #${pullNumber} in ${repository}`
    );
    return { id: data.id, url: data.html_url };
  } catch (error) {
    console.error(
      `Error adding comment to pull request #${pullNumber} in ${repository}:`,
      error
    );
    throw error;
  }
};

/**
 * Add a review comment to a specific line in a pull request
 */
export const addPullRequestReviewComment = async (
  repository: string,
  pullNumber: number,
  body: string,
  commitSha: string,
  path: string,
  line: number
): Promise<{ id: number; url: string }> => {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    const { data } = await octokit.pulls.createReviewComment({
      owner,
      repo,
      pull_number: pullNumber,
      body,
      commit_id: commitSha,
      path,
      line,
    });

    console.log(
      `Added review comment to pull request #${pullNumber} in ${repository}`
    );
    return { id: data.id, url: data.html_url };
  } catch (error) {
    console.error(
      `Error adding review comment to pull request #${pullNumber} in ${repository}:`,
      error
    );
    throw error;
  }
};

/**
 * Reply to an existing comment
 */
export const replyToComment = async (
  repository: string,
  commentId: number,
  body: string
): Promise<{ id: number; url: string }> => {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    // Get the original comment to find the issue/PR number
    const { data: originalComment } = await octokit.issues.getComment({
      owner,
      repo,
      comment_id: commentId,
    });

    // Extract issue number from the issue URL
    const issueNumber = parseInt(
      originalComment.issue_url.split('/').pop() || '0'
    );

    const { data } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });

    console.log(`Replied to comment #${commentId} in ${repository}`);
    return { id: data.id, url: data.html_url };
  } catch (error) {
    console.error(
      `Error replying to comment #${commentId} in ${repository}:`,
      error
    );
    throw error;
  }
};

/**
 * Get the files changed in a pull request
 */
export const getPullRequestFiles = async (
  repository: string,
  pullNumber: number
): Promise<
  Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>
> => {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    const { data } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
    });

    return data.map((file: any) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    }));
  } catch (error) {
    console.error(
      `Error getting files for pull request #${pullNumber} in ${repository}:`,
      error
    );
    throw error;
  }
};

/**
 * Get commits in a pull request
 */
export const getPullRequestCommits = async (
  repository: string,
  pullNumber: number
): Promise<
  Array<{
    sha: string;
    message: string;
    author: string;
    date: string;
  }>
> => {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    const { data } = await octokit.pulls.listCommits({
      owner,
      repo,
      pull_number: pullNumber,
    });

    return data.map((commit: any) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author?.name || 'Unknown',
      date: commit.commit.author?.date || '',
    }));
  } catch (error) {
    console.error(
      `Error getting commits for pull request #${pullNumber} in ${repository}:`,
      error
    );
    throw error;
  }
};

/**
 * Merge a pull request
 */
export const mergePullRequest = async (
  repository: string,
  pullNumber: number,
  options: {
    commitTitle?: string;
    commitMessage?: string;
    mergeMethod?: 'merge' | 'squash' | 'rebase';
  } = {}
): Promise<{ merged: boolean; sha: string }> => {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    const { data } = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: pullNumber,
      commit_title: options.commitTitle,
      commit_message: options.commitMessage,
      merge_method: options.mergeMethod || 'merge',
    });

    console.log(`Merged pull request #${pullNumber} in ${repository}`);
    return { merged: data.merged, sha: data.sha };
  } catch (error) {
    console.error(
      `Error merging pull request #${pullNumber} in ${repository}:`,
      error
    );
    throw error;
  }
};

/**
 * Request reviewers for a pull request
 */
export const requestPullRequestReviewers = async (
  repository: string,
  pullNumber: number,
  reviewers: string[],
  teamReviewers: string[] = []
): Promise<void> => {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    await octokit.pulls.requestReviewers({
      owner,
      repo,
      pull_number: pullNumber,
      reviewers,
      team_reviewers: teamReviewers,
    });

    console.log(
      `Requested reviewers for pull request #${pullNumber} in ${repository}`
    );
  } catch (error) {
    console.error(
      `Error requesting reviewers for pull request #${pullNumber} in ${repository}:`,
      error
    );
    throw error;
  }
};

/**
 * Submit a pull request review
 */
export const submitPullRequestReview = async (
  repository: string,
  pullNumber: number,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
  body?: string,
  comments: Array<{
    path: string;
    line: number;
    body: string;
  }> = []
): Promise<{ id: number }> => {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    const { data } = await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      event,
      body,
      comments: comments.map((comment: any) => ({
        path: comment.path,
        line: comment.line,
        body: comment.body,
      })),
    });

    console.log(
      `Submitted ${event} review for pull request #${pullNumber} in ${repository}`
    );
    return { id: data.id };
  } catch (error) {
    console.error(
      `Error submitting review for pull request #${pullNumber} in ${repository}:`,
      error
    );
    throw error;
  }
};

/**
 * Get the directory structure of a repository or specific path
 */
export const getDirectoryStructure = async (
  repository: string,
  directoryPath: string = ''
): Promise<
  Array<{ name: string; path: string; type: 'file' | 'dir'; size?: number }>
> => {
  try {
    console.log(
      `Getting directory structure for ${directoryPath || '/'} in ${repository}`
    );

    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    // Set a timeout for the API request
    const contentPromise = octokit.repos.getContent({
      owner,
      repo,
      path: directoryPath,
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Directory listing timed out')), 5000);
    });

    // Race between content fetch and timeout
    const { data } = (await Promise.race([
      contentPromise,
      timeoutPromise,
    ])) as any;

    let result: Array<{
      name: string;
      path: string;
      type: 'file' | 'dir';
      size?: number;
    }> = [];

    if (Array.isArray(data)) {
      // It's a directory
      result = data.map((item: any) => ({
        name: item.name,
        path: item.path,
        type: item.type as 'file' | 'dir',
        size: item.size,
      }));

      // Sort directories first, then files
      result.sort((a, b) => {
        if (a.type === 'dir' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });
    } else if (data.type === 'file') {
      // It's a single file
      result = [
        {
          name: data.name,
          path: data.path,
          type: 'file',
          size: data.size,
        },
      ];
    }

    return result;
  } catch (error: any) {
    console.error(
      `Error getting directory structure for ${directoryPath} in ${repository}:`,
      error
    );

    if (error.status === 404) {
      return [
        {
          name: `Path not found: ${directoryPath}`,
          path: directoryPath,
          type: 'file',
        },
      ];
    }

    return [
      {
        name: 'Error retrieving directory structure',
        path: directoryPath,
        type: 'file',
      },
    ];
  }
};

/**
 * Get details of a pull request including comments
 */
export const getPullRequest = async (
  repository: string,
  pullNumber: number
): Promise<{
  title: string;
  body: string;
  state: string;
  user: string;
  comments: Array<{
    user: string;
    body: string;
    createdAt: string;
  }>;
  reviewComments: Array<{
    user: string;
    body: string;
    path: string;
    position: number | null;
    createdAt: string;
  }>;
}> => {
  try {
    const [owner, repo] = repository.split('/');
    const octokit = await getOctokitForRepo(repository);

    // Get the PR details
    const { data: pullRequest } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    // Get issue comments (general PR comments)
    const { data: issueComments } = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: pullNumber,
    });

    // Get review comments (inline code comments)
    const { data: reviewComments } = await octokit.pulls.listReviewComments({
      owner,
      repo,
      pull_number: pullNumber,
    });

    return {
      title: pullRequest.title,
      body: pullRequest.body || '',
      state: pullRequest.state,
      user: pullRequest.user?.login || 'Unknown',
      comments: issueComments.map((comment: any) => ({
        user: comment.user?.login || 'Unknown',
        body: comment.body || '',
        createdAt: comment.created_at,
      })),
      reviewComments: reviewComments.map((comment: any) => ({
        user: comment.user?.login || 'Unknown',
        body: comment.body || '',
        path: comment.path || '',
        position: comment.position === undefined ? null : comment.position,
        createdAt: comment.created_at,
      })),
    };
  } catch (error) {
    console.error(
      `Error getting pull request details for PR #${pullNumber} in ${repository}:`,
      error
    );
    throw error;
  }
};

/**
 * Search for code in a repository using GitHub's search API
 */
export const searchCode = async (
  query: string,
  repository: string,
  options: {
    fileFilter?: string;
    maxResults?: number;
  } = {}
): Promise<
  Array<{ path: string; line: number; content: string; context?: string }>
> => {
  try {
    // Build search query
    let searchQuery = `${query} repo:${repository}`;
    if (options.fileFilter) {
      searchQuery += ` filename:${options.fileFilter}`;
    }

    console.log(`Searching for "${searchQuery}"`);
    const octokit = await getOctokitForRepo(repository);

    const { data } = await octokit.search.code({
      q: searchQuery,
      per_page: Math.min(options.maxResults || 10, 30), // GitHub API limit is 30
    });

    return data.items.map((item: any) => ({
      path: item.path,
      line: 1, // GitHub search doesn't provide line numbers directly
      content: item.text_matches?.[0]?.fragment || 'No preview available',
      context: `Repository: ${item.repository.full_name}, Score: ${item.score}`,
    }));
  } catch (error: any) {
    console.error(`Error searching for "${query}" in ${repository}:`, error);

    // Handle rate limiting
    if (error.status === 403) {
      return [
        {
          path: 'rate-limit.txt',
          line: 1,
          content:
            'GitHub search API rate limit exceeded. Please try again later.',
        },
      ];
    }

    return [
      {
        path: 'search-error.txt',
        line: 1,
        content: `Search could not be completed: ${
          error.message || String(error)
        }`,
      },
    ];
  }
};

/**
 * Clear the file cache
 */
export const clearCache = (): void => {
  fileCache.clear();
  console.log('Cleared GitHub file cache');
};
