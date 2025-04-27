import { Issue, LinearClient, User } from '@linear/sdk';
import OpenAI from 'openai';
import { env } from './env.js';
import {
  buildTechnicalAnalysisPrompt,
  buildChangePlanPrompt,
} from './prompts.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

interface CodeFile {
  path: string;
  content: string;
  repository?: string;
}

export class TechnicalAnalysisService {
  constructor(private linearClient: LinearClient) {}

  /**
   * Generate a technical analysis report for an issue
   */
  async generateTechnicalReport(
    issue: Issue,
    codeFiles: Array<{ path: string; content: string; repository?: string }>,
    additionalContext?: string
  ): Promise<string> {
    // Get issue details and context
    const issueContext = await this.getIssueContext(issue);

    // Calculate repository distribution
    const repoDistribution = new Map<string, number>();
    for (const file of codeFiles) {
      if (file.repository) {
        repoDistribution.set(
          file.repository,
          (repoDistribution.get(file.repository) || 0) + 1
        );
      }
    }

    // Generate repository distribution text
    const repoDistributionText = Array.from(repoDistribution.entries())
      .map(([repo, count]) => `- ${repo}: ${count} files`)
      .join('\n');

    // Format code files for analysis, including repository information
    const codeContext = this.formatCodeForAnalysis(codeFiles);

    // Provide clear context about repository relevance
    const repoContext = `
# Repository Information

The code spans across multiple repositories. Here's the distribution of files:
${repoDistributionText}

Important instructions:
1. Consider ALL repositories equally when analyzing the issue.
2. Identify which repositories contain the relevant code and which repositories will need changes.
3. Clearly specify which repository each file belongs to and where changes need to be made.
4. Do not bias your analysis toward any particular repository - evaluate all repositories based on their technical relevance to the issue.
5. In your implementation plan, ensure you address changes needed in ALL relevant repositories, not just the one with the most files.
`;

    const fullAdditionalContext = additionalContext
      ? `${additionalContext}\n\n${repoContext}`
      : repoContext;

    // Generate the technical report using the AI model
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'system',
            content: buildTechnicalAnalysisPrompt({
              issueContext,
              additionalContext: fullAdditionalContext,
              codeContext,
            }),
          },
        ],
        temperature: 0.3, // Slightly more creative
      });

      const report = response.choices[0].message.content || '';
      return report;
    } catch (error) {
      console.error('Error generating technical report:', error);
      throw new Error('Failed to generate technical analysis report');
    }
  }

  /**
   * Post the technical report as a comment on the Linear issue
   */
  async postReportToIssue(issue: Issue, report: string): Promise<void> {
    try {
      await this.linearClient.createComment({
        issueId: issue.id,
        body: report,
      });

      console.log(`Posted technical report to issue ${issue.identifier}`);
    } catch (error) {
      console.error(
        `Failed to post report to issue ${issue.identifier}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Determine required code changes based on the technical report
   */
  async planCodeChanges(
    issue: Issue,
    technicalReport: string,
    codeFiles: Array<{ path: string; content: string; repository?: string }>
  ): Promise<{
    filesToModify: string[];
    changePlan: string;
    branchName: string;
  }> {
    // Add repository distribution information to provide context
    const repoDistribution = new Map<string, number>();
    for (const file of codeFiles) {
      if (file.repository) {
        repoDistribution.set(
          file.repository,
          (repoDistribution.get(file.repository) || 0) + 1
        );
      }
    }

    // Generate repository context
    const repoContext = Array.from(repoDistribution.entries())
      .map(([repo, count]) => `- ${repo}: ${count} files`)
      .join('\n');

    // Add this context to the prompt
    const changePlanContext = `
# Repository Distribution
${repoContext}

Please consider changes across ALL relevant repositories, not just the one with the most files.
Specify clearly which repository each change belongs to.
`;

    // Generate a change plan based on the report
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: buildChangePlanPrompt({
            issue,
            technicalReport,
            codeFiles,
            formatCodeForAnalysis: this.formatCodeForAnalysis,
          }),
        },
        {
          role: 'user',
          content: changePlanContext,
        },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const changePlan = response.choices[0].message.content || '';

    // Parse the files to modify from the plan
    const filesToModify = this.extractFilesToModify(changePlan);

    // Generate a branch name for the changes
    const branchName = this.generateBranchName(issue);

    return {
      filesToModify,
      changePlan,
      branchName,
    };
  }

  /**
   * Get detailed context about an issue
   */
  private async getIssueContext(issue: Issue): Promise<string> {
    // Get team
    const team = await issue.team;

    // Get comments
    const comments = await issue.comments({ first: 5 });
    const commentData = comments.nodes.map(async (c) => {
      let userName = 'Unknown';
      if (c.user) {
        // Properly handle user object by resolving the LinearFetch promise
        const userObj = await c.user;
        userName = userObj ? await this.getUserName(userObj) : 'Unknown';
      }
      return `${userName}: ${c.body}`;
    });

    // Resolve all the promises in the map
    const resolvedComments = await Promise.all(commentData);
    const commentText = resolvedComments.join('\n\n');

    // Get associated labels
    const labels = await issue.labels();
    const labelNames = labels.nodes.map((l) => l.name).join(', ');

    // Get state name safely
    const state = await issue.state;
    const stateName = state ? await this.getStateName(state) : 'Unknown';

    // Build context
    let context = `Issue: ${issue.identifier} - ${issue.title}
Team: ${team ? team.name : 'Unknown'}
Priority: ${this.getPriorityText(issue.priority)}
State: ${stateName}
Labels: ${labelNames || 'None'}
Description: ${issue.description || 'No description provided'}
`;

    // Add comments if any
    if (commentText) {
      context += `\nRecent comments:\n${commentText}`;
    }

    return context;
  }

  /**
   * Helper method to safely get a user's name
   */
  private async getUserName(user: any): Promise<string> {
    try {
      // Try to safely access the name property
      if (typeof user === 'object' && user !== null) {
        // If it's a promise, resolve it first
        if (user.then && typeof user.then === 'function') {
          const resolvedUser = await user;
          return (resolvedUser && resolvedUser.name) || 'Unknown';
        }
        // Direct access if not a promise
        return user.name || 'Unknown';
      }
      return 'Unknown';
    } catch (error) {
      console.error('Error getting user name:', error);
      return 'Unknown';
    }
  }

  /**
   * Helper method to safely get a state's name
   */
  private async getStateName(state: any): Promise<string> {
    try {
      // Try to safely access the name property
      if (typeof state === 'object' && state !== null) {
        // If it's a promise, resolve it first
        if (state.then && typeof state.then === 'function') {
          const resolvedState = await state;
          return (resolvedState && resolvedState.name) || 'Unknown';
        }
        // Direct access if not a promise
        return state.name || 'Unknown';
      }
      return 'Unknown';
    } catch (error) {
      console.error('Error getting state name:', error);
      return 'Unknown';
    }
  }

  /**
   * Format code files for analysis
   */
  public formatCodeForAnalysis(
    codeFiles: Array<{ path: string; content: string; repository?: string }>
  ): string {
    return codeFiles
      .map((file) => {
        const repoInfo = file.repository
          ? `Repository: ${file.repository}\n`
          : '';
        return `${repoInfo}File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n`;
      })
      .join('\n\n');
  }

  /**
   * Extract files to modify from the change plan
   */
  private extractFilesToModify(changePlan: string): string[] {
    // Simple regex to extract file paths mentioned in the plan
    const fileRegex =
      /(?:file|modify|update|create|in|at):\s*`?([^`\s]+\.(?:ts|js|tsx|jsx|md|json|yaml|yml|html|css|scss))`?/gi;
    const matches = [...changePlan.matchAll(fileRegex)];

    // Extract unique file paths
    const filePaths = new Set<string>();
    matches.forEach((match) => {
      if (match[1]) {
        filePaths.add(match[1]);
      }
    });

    return Array.from(filePaths);
  }

  /**
   * Generate a branch name for the changes
   */
  private generateBranchName(issue: Issue): string {
    // Generate a branch name based on issue ID and title
    const sanitizedTitle = issue.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 30);

    return `fix/${issue.identifier.toLowerCase()}-${sanitizedTitle}`;
  }

  /**
   * Helper function to get a readable priority text
   */
  private getPriorityText(priority: number | null): string {
    switch (priority) {
      case 0:
        return 'No Priority';
      case 1:
        return 'Urgent';
      case 2:
        return 'High';
      case 3:
        return 'Medium';
      case 4:
        return 'Low';
      default:
        return 'Unknown';
    }
  }
}
