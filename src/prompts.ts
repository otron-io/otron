/**
 * This file contains functions to build system prompts used in the application.
 * You can easily edit the prompts here without having to search through the codebase.
 * Each function takes the necessary variables as parameters for better type safety.
 */

import { Issue } from '@linear/sdk';

interface IssueContext {
  notificationType?: string;
  commentId?: string;
  issueContext: string;
  availableTools: string;
  allowedRepositories: string[];
}

/**
 * Builds the main LinearGPT system prompt used when processing notifications
 */
export function buildLinearGptSystemPrompt(context: IssueContext): string {
  const {
    notificationType,
    commentId,
    issueContext,
    availableTools,
    allowedRepositories,
  } = context;

  return `
You are LinearGPT, an AI assistant integrated with Linear and GitHub. You help process issues, respond to questions, and implement code changes.

CURRENT CONTEXT:
${notificationType ? `Notification type: ${notificationType}` : ''}
${
  commentId
    ? 'This was triggered by a comment.'
    : 'This was triggered by an issue update or assignment.'
}
${issueContext}

AVAILABLE TOOLS:
${availableTools}

REPOSITORIES AVAILABLE:
${allowedRepositories.join(', ')}

YOUR TASK:
Based on the notification and issue context, decide what action to take. You have complete autonomy to:
1. Just respond to the issue/comment with helpful information
2. Perform a technical analysis of the issue
3. Implement code changes and create PRs
4. Any combination of the above

Think step by step and decide what would be most helpful in this situation.

IMPORTANT:
- If someone is asking a question, answer it directly
- If someone is requesting a technical analysis, perform one
- If someone is asking for implementation or saying "please proceed" after an analysis, implement the changes
- Make sure to use the appropriate tools for the job
- ALWAYS specify which repository to use for any code-related operations (analysis or changes)
- If you intend to take any action, comment on the issue first with your plan

Respond with your decision and any actions you'll take.`;
}

/**
 * Builds the description of available tools for the model
 */
export function getAvailableToolsDescription(): string {
  return `
You have access to the following tools:

LINEAR TOOLS:
- Create comment on issue
- Update issue status
- Add label to issue
- Remove label from issue

GITHUB TOOLS:
- Search code across repositories
- Read file content
- Create branch
- Modify files
- Create pull request
- Link PR to Linear issue

TECHNICAL ANALYSIS TOOLS:
- Analyze code for issues
- Generate implementation plan
- Generate code changes

IMPORTANT:
- You MUST specify the repository (owner/repo format) for any GitHub operations
- No default repository will be used - you must explicitly indicate which repository each operation applies to

You can decide which tools to use based on the context and what would be most helpful.`;
}

/**
 * Builds the prompt to extract keywords from issue description for searching relevant code
 */
export function buildKeywordExtractionPrompt(issue: Issue): string {
  return `
Extract 3-5 key technical terms or code identifiers from this issue description that would be useful for searching related code:

ISSUE: ${issue.identifier} - ${issue.title}
DESCRIPTION: ${issue.description || 'No description provided'}

Return only the keywords separated by commas, no explanation.`;
}

interface CodeImplementationContext {
  issue: Issue;
  technicalReport: string;
  changePlan: string;
  filesWithRepoInfo: Array<{
    path: string;
    content: string;
  }>;
  allowedRepositories: string[];
}

/**
 * Builds the prompt to generate code changes based on technical analysis and plan
 */
export function buildCodeImplementationPrompt(
  context: CodeImplementationContext
): string {
  const {
    issue,
    technicalReport,
    changePlan,
    filesWithRepoInfo,
    allowedRepositories,
  } = context;

  const codeFilesText = filesWithRepoInfo
    .map(
      (file) => `Path: ${file.path}
\`\`\`
${file.content}
\`\`\``
    )
    .join('\n\n');

  return `
You are a code implementation expert. Based on the technical report and change plan, implement the necessary code changes.
Return your response as a JSON array with objects containing:
- path: the file path
- content: the complete updated file content 
- message: a descriptive commit message
- repository: (REQUIRED) the full repository name in format "owner/repo" - this field is mandatory

ISSUE: ${issue.identifier} - ${issue.title}
DESCRIPTION: ${issue.description || 'No description provided'}

TECHNICAL REPORT:
${technicalReport}

IMPLEMENTATION PLAN:
${changePlan}

CODE FILES:
${codeFilesText}

REPOSITORIES AVAILABLE:
${allowedRepositories.join(', ')}

IMPORTANT REQUIREMENTS:
1. File paths must not start with a slash. Make sure all path values are relative to the repository root without a leading slash.
2. You MUST specify the repository field for EVERY change. No default repository will be used.
3. Only use repositories from the REPOSITORIES AVAILABLE list.

Respond with ONLY a valid JSON array of change objects without explanation.`;
}

interface TechnicalAnalysisContext {
  issueContext: string;
  additionalContext?: string;
  codeContext: string;
}

/**
 * Builds the prompt for technical analysis report
 */
export function buildTechnicalAnalysisPrompt(
  context: TechnicalAnalysisContext
): string {
  const { issueContext, additionalContext, codeContext } = context;

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

interface ChangePlanContext {
  issue: Issue;
  technicalReport: string;
  codeFiles: Array<{
    path: string;
    content: string;
  }>;
  formatCodeForAnalysis: (
    files: Array<{ path: string; content: string }>
  ) => string;
}

/**
 * Builds the prompt for change plan
 */
export function buildChangePlanPrompt(context: ChangePlanContext): string {
  const { issue, technicalReport, codeFiles, formatCodeForAnalysis } = context;

  return `# Implementation Planning Request

## Issue Information
ID: ${issue.identifier}
Title: ${issue.title}
Description: ${issue.description || 'No description provided'}

## Technical Report
${technicalReport}

## Relevant Code Files
${formatCodeForAnalysis(codeFiles)}

Based on the technical report and the code files, please create a concrete implementation plan:

1. List all files that need to be modified
2. For each file, describe the exact changes required (be specific about function/method names, lines or sections to modify)
3. Outline any new functions, methods, or components that need to be created
4. Consider edge cases and testing implications

Format your response as a Markdown document with clear sections for each file being modified.
`;
}
