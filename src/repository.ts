import { Octokit } from '@octokit/rest';
import type { components } from '@octokit/openapi-types';

interface RepositoryConfig {
  owner: string;
  repo: string;
  baseBranch: string;
}

type FileContent = components['schemas']['content-file'];
type DirectoryContent = components['schemas']['content-directory'];
type ContentItem = components['schemas']['content-directory'][number];

export class CodeRepositoryService {
  private octokit: Octokit;
  private config: RepositoryConfig;

  constructor(githubToken: string, config: RepositoryConfig) {
    this.octokit = new Octokit({ auth: githubToken });
    this.config = config;
  }

  /**
   * Fetches the content of a file from the repository
   */
  async getFileContent(
    filePath: string,
    branch = this.config.baseBranch
  ): Promise<{ content: string; sha: string }> {
    try {
      const response = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path: filePath,
        ref: branch,
      });

      // Handle the response which is a single file
      if (!Array.isArray(response.data) && response.data.type === 'file') {
        const fileData = response.data as FileContent;
        const content = Buffer.from(fileData.content, 'base64').toString();
        return {
          content,
          sha: fileData.sha,
        };
      }
      throw new Error('Not a file or file not found');
    } catch (error) {
      console.error(`Error getting file content for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Lists files in a directory
   */
  async listFiles(
    directoryPath: string,
    branch = this.config.baseBranch
  ): Promise<string[]> {
    try {
      const response = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path: directoryPath,
        ref: branch,
      });

      if (Array.isArray(response.data)) {
        const dirContent = response.data as ContentItem[];
        return dirContent
          .filter((item) => item.type === 'file')
          .map((file) => file.path);
      }
      throw new Error('Not a directory or directory not found');
    } catch (error) {
      console.error(`Error listing files in ${directoryPath}:`, error);
      throw error;
    }
  }

  /**
   * Creates a new branch from the base branch
   */
  async createBranch(branchName: string): Promise<void> {
    try {
      // Get the reference to the base branch
      const baseRef = await this.octokit.git.getRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `heads/${this.config.baseBranch}`,
      });

      // Create a new branch from the base branch
      await this.octokit.git.createRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `refs/heads/${branchName}`,
        sha: baseRef.data.object.sha,
      });
    } catch (error) {
      console.error(`Error creating branch ${branchName}:`, error);
      throw error;
    }
  }

  /**
   * Creates or updates a file in the repository
   */
  async createOrUpdateFile(
    filePath: string,
    content: string,
    message: string,
    branch: string,
    sha?: string
  ): Promise<{ sha: string }> {
    try {
      const contentEncoded = Buffer.from(content).toString('base64');

      const response = await this.octokit.repos.createOrUpdateFileContents({
        owner: this.config.owner,
        repo: this.config.repo,
        path: filePath,
        message,
        content: contentEncoded,
        branch,
        sha, // Required when updating a file
      });

      return {
        sha: response.data.content?.sha || '',
      };
    } catch (error) {
      console.error(`Error updating file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Creates a pull request
   */
  async createPullRequest(
    headBranch: string,
    title: string,
    body: string
  ): Promise<{ number: number; url: string }> {
    try {
      const response = await this.octokit.pulls.create({
        owner: this.config.owner,
        repo: this.config.repo,
        title,
        body,
        head: headBranch,
        base: this.config.baseBranch,
      });

      return {
        number: response.data.number,
        url: response.data.html_url,
      };
    } catch (error) {
      console.error(`Error creating PR from branch ${headBranch}:`, error);
      throw error;
    }
  }

  /**
   * Searches code in the repository
   */
  async searchCode(query: string): Promise<
    Array<{
      path: string;
      url: string;
      content?: string;
    }>
  > {
    try {
      const searchQuery = `repo:${this.config.owner}/${this.config.repo} ${query}`;
      const response = await this.octokit.search.code({
        q: searchQuery,
      });

      return response.data.items.map((item) => ({
        path: item.path,
        url: item.html_url,
      }));
    } catch (error) {
      console.error(`Error searching code for query ${query}:`, error);
      throw error;
    }
  }
}
