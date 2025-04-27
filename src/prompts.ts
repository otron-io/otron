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
You are Marvin, an AI assistant integrated with Linear and GitHub. You help process issues, respond to questions, and implement code changes.

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
- If you are assigned to an issue, it is likely for you to implement the changes
- If someone is asking a question, answer it research and provide an answer in your final response, or add a new comment if the response is long
- If someone is requesting a technical analysis, perform one
- If someone is asking for implementation or saying "please proceed" after an analysis, implement the changes
- Make sure to use the appropriate tools for the job
- ALWAYS specify which repository to use for any code-related operations (analysis or changes)`;
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
    repository?: string;
  }>;
  allowedRepositories: string[];
  repoDistribution?: string; // Distribution of files across repositories
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
    repoDistribution,
  } = context;

  // Limit file content size to avoid generating too large responses
  const codeFilesText = filesWithRepoInfo
    .map((file) => {
      // Truncate very large files to a reasonable size
      const maxContentLength = 5000; // Reduced size for better handling
      let fileContent = file.content;
      let truncationNote = '';

      if (fileContent.length > maxContentLength) {
        fileContent = fileContent.substring(0, maxContentLength);
        truncationNote = `\n[File truncated due to size. Original length: ${file.content.length} characters]`;
      }

      // Include repository information if available
      const repoInfo = file.repository
        ? `Repository: ${file.repository}\n`
        : '';

      return `${repoInfo}Path: ${file.path}
\`\`\`
${fileContent}${truncationNote}
\`\`\``;
    })
    .join('\n\n');

  return `
You are a code implementation expert. Based on the technical report and change plan, implement the necessary code changes.

ISSUE: ${issue.identifier} - ${issue.title}
DESCRIPTION: ${issue.description || 'No description provided'}

TECHNICAL REPORT:
${technicalReport}

IMPLEMENTATION PLAN:
${changePlan}

FILE DISTRIBUTION ACROSS REPOSITORIES:
${repoDistribution || 'No repository distribution information available'}

CODE FILES:
${codeFilesText}

REPOSITORIES AVAILABLE:
${allowedRepositories.join(', ')}

# CHANGE SPECIFICATION FORMAT

Instead of returning a large JSON object with entire file contents, return a series of change specifications in the following format:

## CHANGE 1
Repository: [owner/repo]
File: [path/to/file.ext]
Description: [brief description of change]

\`\`\`diff
// Use diff format to show only the changed lines
// Use + for added lines and - for removed lines
// Include a few lines of context before and after changes
// Example:
  function someFunction() {
-   const oldValue = 'old';
+   const newValue = 'new';
    return something;
  }
\`\`\`

## CHANGE 2
Repository: [owner/repo]
File: [path/to/another/file.ext]
Description: [brief description of change]

\`\`\`diff
// Another change in diff format
\`\`\`

# IMPORTANT REQUIREMENTS:
1. File paths must not start with a slash. Make sure all paths are relative to the repository root.
2. ACCURACY OVER DISTRIBUTION: Only make changes in repositories that ACTUALLY contain the code that needs to be modified.
3. DO NOT distribute changes across repositories just for the sake of balance - focus on the correct repositories.
4. Each change must be in the repository that actually contains the file. DO NOT mix up repositories.
5. Pay careful attention to programming language and framework - frontend code belongs in frontend repos, backend code in backend repos.
6. If the issue only requires changes in one repository, only make changes in that repository.
7. Use diff format to show only the changes, not entire files.
8. Include sufficient context around changes (a few lines before/after).
9. For each change, include a brief description explaining what the change does.
10. If a file is entirely new, use a diff that adds the whole file.

Before submitting your response, carefully review which repository each change belongs to. Changes must be implemented in the repository where the code actually exists.

RESPOND WITH ONLY THE CHANGE SPECIFICATIONS AS DESCRIBED ABOVE.
`;
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

/**
 * Builds an enhanced prompt for technical analysis with advanced code understanding
 */
export function buildEnhancedAnalysisPrompt(
  context: TechnicalAnalysisContext
): string {
  const { issueContext, additionalContext, codeContext } = context;

  return `# Enhanced Technical Analysis Request

## Issue Information
${issueContext}

${additionalContext ? `## Additional Context\n${additionalContext}\n` : ''}

## Codebase Files
${codeContext}

You are a senior developer with expertise in identifying and fixing bugs in complex codebases.
Your task is to perform a comprehensive analysis of this issue, focusing on the following:

1. Root cause identification
   - Analyze potential failure points in the code
   - Identify race conditions, edge cases, or error handling issues
   - Consider data flow and state management problems
   - Look for dependency problems or version conflicts

2. Code dependency analysis
   - Examine how different components interact
   - Identify interface mismatches or incorrect assumptions between components
   - Map the full data flow relevant to this issue

3. Bug isolation
   - Determine the exact file and line numbers most likely containing the bug
   - Identify when/how the bug is triggered and exact conditions
   - Evaluate potential side effects of any fix

4. Comprehensive solution design
   - Describe a detailed, implementation-ready fix
   - Consider maintainability, performance and security implications
   - Propose unit tests to verify the fix and prevent regression

Focus on precision - be specific about exact files, functions, and lines of code.
Consider all provided context, especially dependency information, call graphs, and historical context.

Format your response as Markdown with the following structure:

## Technical Analysis Summary

[Concise, high-level summary of the issue and your findings]

## Root Cause Identification

### Primary Issue
[Detailed description of the core problem]

### Relevant Code Paths
[Key functions/methods involved with file paths and line numbers]

## Dependency Analysis

### Component Interactions
[How different parts of the code interact to cause this issue]

### Data Flow
[How data moves through the system, where it's transformed, and where errors occur]

## Bug Location

### Specific Files and Lines
[Exact location(s) of the issue with line numbers]

### Triggering Conditions
[When and how the bug manifests]

## Solution Design

### Implementation Plan
[Step-by-step changes needed with exact code modifications]

### Testing Strategy
[How to verify the fix works as intended]
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
