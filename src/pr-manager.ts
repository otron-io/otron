import { openai } from '@ai-sdk/openai';
import { Issue, LinearClient } from '@linear/sdk';
import { generateText } from 'ai';
import { Octokit } from '@octokit/rest';
import { env } from './env.js';

interface CodeChange {
  path: string;
  content: string;
  message: string;
  repository?: string; // New field to specify which repository this change belongs to
}

interface Repository {
  owner: string;
  repo: string;
  baseBranch: string;
}

export class PRManager {
  private octokit: Octokit;
  private repositories: Map<string, Repository> = new Map();
  private defaultRepo: Repository;

  constructor(
    private linearClient: LinearClient,
    defaultOwner: string = env.REPO_OWNER,
    defaultRepo: string = env.REPO_NAME,
    defaultBaseBranch: string = env.REPO_BASE_BRANCH
  ) {
    // Initialize GitHub client
    this.octokit = new Octokit({
      auth: env.GITHUB_TOKEN,
    });

    // Set up default repository
    this.defaultRepo = {
      owner: defaultOwner,
      repo: defaultRepo,
      baseBranch: defaultBaseBranch,
    };

    // Add default repository to the map
    this.repositories.set(`${defaultOwner}/${defaultRepo}`, this.defaultRepo);

    // Parse allowed repositories
    if (env.ALLOWED_REPOSITORIES) {
      const allowedRepos = env.ALLOWED_REPOSITORIES.split(',').map((r) =>
        r.trim()
      );

      for (const repoFullName of allowedRepos) {
        // Skip if already added or if format is invalid
        if (
          this.repositories.has(repoFullName) ||
          !repoFullName.includes('/')
        ) {
          continue;
        }

        const [owner, repo] = repoFullName.split('/');
        this.repositories.set(repoFullName, {
          owner,
          repo,
          baseBranch: 'main', // Default to 'main' for other repositories
        });
      }
    }
  }

  /**
   * Gets repository info, defaulting to the primary repository if not found
   */
  private getRepoInfo(repoFullName?: string): Repository {
    if (!repoFullName) {
      return this.defaultRepo;
    }

    return this.repositories.get(repoFullName) || this.defaultRepo;
  }

  /**
   * Fetches a file's content from the specified repository
   */
  async getFileContent(
    path: string,
    branch?: string,
    repoFullName?: string
  ): Promise<string> {
    const repo = this.getRepoInfo(repoFullName);
    const branchToUse = branch || repo.baseBranch;

    try {
      // Sanitize the path before using it with GitHub API
      const sanitizedPath = this.sanitizePath(path);
      console.log(
        `Getting file content for ${sanitizedPath} from ${branchToUse} in ${repo.owner}/${repo.repo}`
      );

      const response = await this.octokit.repos.getContent({
        owner: repo.owner,
        repo: repo.repo,
        path: sanitizedPath,
        ref: branchToUse,
      });

      // The response content is base64 encoded
      if ('content' in response.data && !Array.isArray(response.data)) {
        const content = Buffer.from(response.data.content, 'base64').toString();
        return content;
      } else {
        throw new Error(`${sanitizedPath} is a directory or not a file`);
      }
    } catch (error) {
      console.error(
        `Error fetching file: ${path} from ${repo.owner}/${repo.repo}`,
        error
      );
      throw error;
    }
  }

  /**
   * Creates a new branch for implementing changes
   */
  async createBranch(branchName: string, repoFullName?: string): Promise<void> {
    const repo = this.getRepoInfo(repoFullName);

    try {
      // Get the SHA of the latest commit on the base branch
      const refResponse = await this.octokit.git.getRef({
        owner: repo.owner,
        repo: repo.repo,
        ref: `heads/${repo.baseBranch}`,
      });

      const sha = refResponse.data.object.sha;

      // Create the new branch
      await this.octokit.git.createRef({
        owner: repo.owner,
        repo: repo.repo,
        ref: `refs/heads/${branchName}`,
        sha,
      });

      console.log(
        `Created branch: ${branchName} from ${repo.baseBranch} in ${repo.owner}/${repo.repo}`
      );
    } catch (error) {
      console.error(
        `Error creating branch: ${branchName} in ${repo.owner}/${repo.repo}`,
        error
      );
      throw error;
    }
  }

  /**
   * Organizes changes by repository
   */
  private organizeChangesByRepo(
    changes: CodeChange[]
  ): Map<string, CodeChange[]> {
    const changesByRepo = new Map<string, CodeChange[]>();

    for (const change of changes) {
      // Determine which repository this change belongs to
      const repoKey =
        change.repository ||
        `${this.defaultRepo.owner}/${this.defaultRepo.repo}`;

      // Skip if it's for a repository we don't have access to
      if (!this.repositories.has(repoKey)) {
        console.warn(`Skipping change for unauthorized repository: ${repoKey}`);
        continue;
      }

      // Add to the map
      if (!changesByRepo.has(repoKey)) {
        changesByRepo.set(repoKey, []);
      }

      changesByRepo.get(repoKey)!.push(change);
    }

    return changesByRepo;
  }

  /**
   * Sanitizes a file path to ensure it's valid for GitHub API
   * Removes leading slashes and normalizes path separators
   */
  private sanitizePath(path: string): string {
    // Remove leading slashes
    let sanitizedPath = path.replace(/^\/+/, '');

    // Replace backslashes with forward slashes (for Windows paths)
    sanitizedPath = sanitizedPath.replace(/\\/g, '/');

    return sanitizedPath;
  }

  /**
   * Implements code changes in a specific repository
   */
  private async implementChangesInRepo(
    repoFullName: string,
    branchName: string,
    changes: CodeChange[]
  ): Promise<void> {
    const repo = this.getRepoInfo(repoFullName);

    try {
      // Implement each change as a separate commit
      for (const change of changes) {
        // Sanitize the file path to ensure it's valid for GitHub API
        const sanitizedPath = this.sanitizePath(change.path);
        console.log(
          `Processing file: ${sanitizedPath} (original: ${change.path})`
        );

        // Get the current file (if it exists) to get its SHA
        let fileSha: string | undefined;
        try {
          const fileResponse = await this.octokit.repos.getContent({
            owner: repo.owner,
            repo: repo.repo,
            path: sanitizedPath,
            ref: branchName,
          });

          if ('sha' in fileResponse.data && !Array.isArray(fileResponse.data)) {
            fileSha = fileResponse.data.sha;
          }
        } catch (error) {
          // File doesn't exist yet, that's okay for new files
          console.log(
            `Creating new file: ${sanitizedPath} in ${repo.owner}/${repo.repo}`
          );
        }

        // Update or create the file
        await this.octokit.repos.createOrUpdateFileContents({
          owner: repo.owner,
          repo: repo.repo,
          path: sanitizedPath,
          message: change.message,
          content: Buffer.from(change.content).toString('base64'),
          branch: branchName,
          sha: fileSha, // Only needed for updates, not for new files
        });
      }

      console.log(
        `Pushed ${changes.length} file changes to branch: ${branchName} in ${repo.owner}/${repo.repo}`
      );
    } catch (error) {
      console.error(
        `Error implementing changes to branch: ${branchName} in ${repo.owner}/${repo.repo}`,
        error
      );
      throw error;
    }
  }

  /**
   * Implements changes across multiple repositories
   */
  async implementChanges(
    branchName: string,
    changes: CodeChange[]
  ): Promise<void> {
    // Organize changes by repository
    const changesByRepo = this.organizeChangesByRepo(changes);

    // Implement changes in each repository
    for (const [repoFullName, repoChanges] of changesByRepo.entries()) {
      // Create branch in this repository
      await this.createBranch(branchName, repoFullName);

      // Implement the changes
      await this.implementChangesInRepo(repoFullName, branchName, repoChanges);
    }
  }

  /**
   * Creates a pull request in a specific repository
   */
  private async createPRInRepo(
    issue: Issue,
    repoFullName: string,
    branchName: string,
    description: string
  ): Promise<{ url: string; number: number; repoFullName: string }> {
    const repo = this.getRepoInfo(repoFullName);

    try {
      // Create PR title from issue
      const prTitle = `[${issue.identifier}] ${issue.title}`;

      // Create the PR
      const response = await this.octokit.pulls.create({
        owner: repo.owner,
        repo: repo.repo,
        title: prTitle,
        body: description,
        head: branchName,
        base: repo.baseBranch,
      });

      console.log(
        `Created PR: ${prTitle} from ${branchName} to ${repo.baseBranch} in ${repo.owner}/${repo.repo}`
      );

      return {
        url: response.data.html_url,
        number: response.data.number,
        repoFullName,
      };
    } catch (error) {
      console.error(
        `Error creating PR from branch: ${branchName} in ${repo.owner}/${repo.repo}`,
        error
      );
      throw error;
    }
  }

  /**
   * Creates pull requests across multiple repositories
   */
  async createPullRequests(
    issue: Issue,
    branchName: string,
    description: string,
    repoNames: string[]
  ): Promise<Array<{ url: string; number: number; repoFullName: string }>> {
    const results: Array<{
      url: string;
      number: number;
      repoFullName: string;
    }> = [];

    // Create PRs in each repository
    for (const repoName of repoNames) {
      // Skip repositories we don't have access to
      if (!this.repositories.has(repoName)) {
        console.warn(
          `Skipping PR creation for unauthorized repository: ${repoName}`
        );
        continue;
      }

      try {
        const pr = await this.createPRInRepo(
          issue,
          repoName,
          branchName,
          description
        );
        results.push(pr);
      } catch (error) {
        console.error(`Failed to create PR in ${repoName}:`, error);
        // Continue to the next repository rather than failing completely
      }
    }

    return results;
  }

  /**
   * Updates the Linear issue with the PR information
   */
  async linkPullRequestsToIssue(
    issue: Issue,
    prs: Array<{ url: string; number: number; repoFullName: string }>
  ): Promise<void> {
    try {
      if (prs.length === 0) {
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `I tried to create pull requests but was unable to do so. Please check the logs for more details.`,
        });
        return;
      }

      // Build a message with all PRs
      let message =
        prs.length === 1
          ? `I've created a pull request with the proposed solution:\n\n`
          : `I've created ${prs.length} pull requests with the proposed solutions:\n\n`;

      // Add each PR to the message
      for (const pr of prs) {
        message += `- [${pr.repoFullName} PR #${pr.number}](${pr.url})\n`;
      }

      message += `\nPlease review the changes and provide feedback.`;

      // Add the comment to the issue
      await this.linearClient.createComment({
        issueId: issue.id,
        body: message,
      });

      // Update issue status if needed (assuming "In Review" state exists)
      const states = await this.linearClient.workflowStates();
      const inReviewState = states.nodes.find((s) =>
        s.name.toLowerCase().includes('review')
      );

      if (inReviewState) {
        await issue.update({ stateId: inReviewState.id });
      }

      console.log(`Linked ${prs.length} PRs to issue ${issue.identifier}`);
    } catch (error) {
      console.error(`Error linking PRs to issue ${issue.identifier}:`, error);
      throw error;
    }
  }

  /**
   * End-to-end process to implement changes and create PRs in multiple repositories
   */
  async implementAndCreatePRs(
    issue: Issue,
    branchName: string,
    changes: CodeChange[],
    description: string
  ): Promise<Array<{ url: string; number: number; repoFullName: string }>> {
    // Get all repositories that have changes
    const changesByRepo = this.organizeChangesByRepo(changes);
    const repoNames = Array.from(changesByRepo.keys());

    if (repoNames.length === 0) {
      console.warn('No changes to implement in any repository');
      return [];
    }

    // Implement all changes
    await this.implementChanges(branchName, changes);

    // Create PRs in each repository with changes
    const prs = await this.createPullRequests(
      issue,
      branchName,
      description,
      repoNames
    );

    // Link the PRs to the Linear issue
    await this.linkPullRequestsToIssue(issue, prs);

    return prs;
  }

  /**
   * Legacy method for backward compatibility
   */
  async implementAndCreatePR(
    issue: Issue,
    branchName: string,
    changes: CodeChange[],
    description: string
  ): Promise<{ url: string; number: number }> {
    const prs = await this.implementAndCreatePRs(
      issue,
      branchName,
      changes,
      description
    );

    // Return first PR or mock response if none created
    if (prs.length > 0) {
      const { url, number } = prs[0];
      return { url, number };
    }

    return {
      url: `https://github.com/${this.defaultRepo.owner}/${this.defaultRepo.repo}/pull/0`,
      number: 0,
    };
  }
}
