import { openai } from '@ai-sdk/openai';
import { Issue, LinearClient, User } from '@linear/sdk';
import { generateText } from 'ai';
import { env } from './env.js';

// Initialize Claude model (using OpenAI interface for now, will replace with Claude when added)
const model = openai('gpt-4.1');

interface CodeFile {
  path: string;
  content: string;
}

export class TechnicalAnalysisService {
  constructor(private linearClient: LinearClient) {}

  /**
   * Generate a technical analysis report for an issue
   */
  async generateTechnicalReport(
    issue: Issue,
    codeFiles: CodeFile[],
    additionalContext?: string
  ): Promise<string> {
    // Get issue details and context
    const issueContext = await this.getIssueContext(issue);

    // Format code files for analysis
    const codeContext = this.formatCodeForAnalysis(codeFiles);

    // Generate the technical report using the AI model
    const { text } = await generateText({
      model,
      prompt: this.buildTechnicalReportPrompt(
        issueContext,
        codeContext,
        additionalContext || ''
      ),
      temperature: 0.2,
      maxTokens: 2000,
    });

    return text;
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
    codeFiles: CodeFile[]
  ): Promise<{
    filesToModify: string[];
    changePlan: string;
    branchName: string;
  }> {
    // Generate a change plan based on the report
    const { text } = await generateText({
      model,
      prompt: this.buildChangePlanPrompt(issue, technicalReport, codeFiles),
      temperature: 0.2,
      maxTokens: 1500,
    });

    // Parse the files to modify from the plan
    const filesToModify = this.extractFilesToModify(text);

    // Generate a branch name for the changes
    const branchName = this.generateBranchName(issue);

    return {
      filesToModify,
      changePlan: text,
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
  private formatCodeForAnalysis(codeFiles: CodeFile[]): string {
    return codeFiles
      .map((file) => `File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n`)
      .join('\n\n');
  }

  /**
   * Build the prompt for generating a technical report
   */
  private buildTechnicalReportPrompt(
    issueContext: string,
    codeContext: string,
    additionalContext: string
  ): string {
    return `# Technical Analysis Request

## Issue Information
${issueContext}

${additionalContext ? `## Additional Context\n${additionalContext}\n` : ''}

## Codebase Files
${codeContext}

Please analyze the provided code snippets in relation to the described issue and provide a comprehensive technical report with:

1. A high-level summary of the issue
2. The root cause analysis 
3. Specific problematic code patterns
4. Recommended fixes with code examples
5. Implementation plan with specific file changes needed

Format your response as Markdown with the following structure:

## Summary

[Non-technical very short summary grounded in the code]

## Technical Root Cause Analysis

### Core Issues Identified
1. [Issue 1]
2. [Issue 2]

### Problematic Code Pattern
\`\`\`
[Code Snippet]
\`\`\`

### Recommended Fixes
1. [Fix 1]
2. [Fix 2]

## Implementation Plan
1. [Step 1 with file path]
2. [Step 2 with file path]
`;
  }

  /**
   * Build prompt for generating a concrete change plan
   */
  private buildChangePlanPrompt(
    issue: Issue,
    technicalReport: string,
    codeFiles: CodeFile[]
  ): string {
    return `# Implementation Planning Request

## Issue Information
ID: ${issue.identifier}
Title: ${issue.title}
Description: ${issue.description || 'No description provided'}

## Technical Report
${technicalReport}

## Relevant Code Files
${this.formatCodeForAnalysis(codeFiles)}

Based on the technical report and the code files, please create a concrete implementation plan:

1. List all files that need to be modified
2. For each file, describe the exact changes required (be specific about function/method names, lines or sections to modify)
3. Outline any new functions, methods, or components that need to be created
4. Consider edge cases and testing implications

Format your response as a Markdown document with clear sections for each file being modified.
`;
  }

  /**
   * Extract files to modify from the change plan
   */
  private extractFilesToModify(changePlan: string): string[] {
    // Simple regex to extract file paths from markdown headings
    const fileMatches = changePlan.match(/##\s+([a-zA-Z0-9_\-\.\/]+)/g);
    if (!fileMatches) return [];

    return fileMatches.map((match) => {
      const filePath = match.replace(/##\s+/, '').trim();
      return filePath;
    });
  }

  /**
   * Generate a branch name based on the issue
   */
  private generateBranchName(issue: Issue): string {
    const sanitizedTitle = issue.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return `fix/${issue.identifier.toLowerCase()}-${sanitizedTitle}`.substring(
      0,
      60
    );
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
