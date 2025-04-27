import { LinearClient } from '@linear/sdk';
import { Octokit } from '@octokit/rest';
import { env } from './env.js';
import { GitHubAppService } from './github-app.js';

export class PRManager {
  private octokit: Octokit;
  private githubAppService: GitHubAppService | null = null;

  constructor(private linearClient: LinearClient) {
    if (env.GITHUB_TOKEN) {
      // Legacy mode: use PAT
      this.octokit = new Octokit({
        auth: env.GITHUB_TOKEN,
      });
    } else if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
      // GitHub App mode: initialize the service
      this.githubAppService = GitHubAppService.getInstance();
      // Initialize with a temporary Octokit that will be replaced per-repo
      this.octokit = new Octokit();
    } else {
      throw new Error(
        'No GitHub authentication credentials provided. Set either GITHUB_TOKEN or GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.'
      );
    }
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
   * Retrieve the default branch name for a repository
   */
  async getDefaultBranch(repository: string): Promise<string> {
    const [owner, repo] = repository.split('/');

    const octokit = await this.getOctokitForRepo(repository);
    const { data } = await octokit.repos.get({
      owner,
      repo,
    });

    return data.default_branch;
  }

  /**
   * Create a new branch in a repository
   */
  async createBranch(
    branchName: string,
    repository: string,
    baseBranch?: string
  ): Promise<void> {
    const [owner, repo] = repository.split('/');
    const baseRef = baseBranch || env.REPO_BASE_BRANCH || 'main';

    // Get the SHA of the base branch
    const octokit = await this.getOctokitForRepo(repository);
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseRef}`,
    });

    const sha = refData.object.sha;

    // Create the new branch
    try {
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha,
      });
      console.log(`Created branch ${branchName} in ${repository}`);
    } catch (error: any) {
      // If branch already exists, get its current SHA
      if (error.status === 422) {
        console.log(`Branch ${branchName} already exists in ${repository}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Get the content of a file from a repository
   */
  async getFileContent(path: string, repository: string): Promise<string> {
    const [owner, repo] = repository.split('/');

    try {
      const octokit = await this.getOctokitForRepo(repository);
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      if ('content' in data && 'encoding' in data) {
        // It's a file
        if (data.encoding === 'base64') {
          return Buffer.from(data.content, 'base64').toString('utf-8');
        }
        return data.content;
      }

      throw new Error(`Not a file: ${path}`);
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error(`File not found: ${path}`);
      }
      throw error;
    }
  }

  /**
   * Create or update a file in a repository
   */
  async createOrUpdateFile(
    path: string,
    content: string,
    message: string,
    repository: string,
    branch: string
  ): Promise<void> {
    const [owner, repo] = repository.split('/');

    let sha: string | undefined;

    const octokit = await this.getOctokitForRepo(repository);

    // Check if file already exists to get its SHA
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });

      if ('sha' in data) {
        sha = data.sha;
      }
    } catch (error: any) {
      // File doesn't exist, which is fine for creation
      if (error.status !== 404) {
        throw error;
      }
    }

    // Create or update the file
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  /**
   * Create a pull request in a repository
   */
  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
    repository: string
  ): Promise<{ url: string; number: number }> {
    const [owner, repo] = repository.split('/');

    const octokit = await this.getOctokitForRepo(repository);
    const { data } = await octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });

    return {
      url: data.html_url,
      number: data.number,
    };
  }

  /**
   * Get files in a specific directory of a repository
   */
  async getDirectoryContents(
    path: string,
    repository: string
  ): Promise<Array<{ path: string; type: string; name: string }>> {
    const [owner, repo] = repository.split('/');

    const octokit = await this.getOctokitForRepo(repository);
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    if (!Array.isArray(data)) {
      throw new Error(`Not a directory: ${path}`);
    }

    return data.map((item) => ({
      path: item.path,
      type: item.type,
      name: item.name,
    }));
  }

  /**
   * Search for files in a repository matching a query
   */
  async searchCode(
    query: string,
    repository: string
  ): Promise<Array<{ path: string; repository: string }>> {
    const octokit = await this.getOctokitForRepo(repository);
    const { data } = await octokit.rest.search.code({
      q: `repo:${repository} ${query}`,
    });

    return data.items.map((item) => ({
      path: item.path,
      repository,
    }));
  }
}
