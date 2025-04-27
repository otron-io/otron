import { Issue, LinearClient, User } from '@linear/sdk';
import OpenAI from 'openai';
import { env } from './env.js';
import { Octokit } from '@octokit/rest';
import { PRManager } from './pr-manager.js';
import { CodeAnalyzer } from './code-analysis.js';
import { GitHubAppService } from './github-app.js';
import { LocalRepositoryManager } from './repository-manager.js';
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
  private octokit: Octokit;
  private prManager: PRManager;
  private codeAnalyzer: CodeAnalyzer;
  private localRepoManager: LocalRepositoryManager;
  private allowedRepositories: string[] = [];
  private githubAppService: GitHubAppService | null = null;

  constructor(private linearClient: LinearClient) {
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

    this.prManager = new PRManager(linearClient);
    this.localRepoManager = new LocalRepositoryManager(linearClient);

    // Parse allowed repositories from env variable
    if (env.ALLOWED_REPOSITORIES) {
      this.allowedRepositories = env.ALLOWED_REPOSITORIES.split(',').map((r) =>
        r.trim()
      );
    }

    // Initialize the code analyzer
    this.codeAnalyzer = new CodeAnalyzer(
      this.getOctokitForRepo.bind(this),
      this.prManager,
      this.localRepoManager,
      this.allowedRepositories
    );
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
   * Generate a technical analysis report for an issue using enhanced code analysis
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

    // Use enhanced analysis to build a deeper understanding of the code
    const enhancedAnalysis = await this.performEnhancedAnalysis(
      issue,
      codeFiles
    );

    // Format code files for analysis, including repository information
    const codeContext = this.formatCodeForAnalysis(
      enhancedAnalysis.relevantFiles
    );

    // Prepare enhanced technical context based on the analysis
    const enhancedContext = this.prepareEnhancedContext(enhancedAnalysis);

    // Provide clear context about repository relevance
    const repoContext = `
# Repository Information

The code spans across multiple repositories. Here's the distribution of files:
${repoDistributionText}

Important instructions:
1. Focus on identifying precisely which repositories ACTUALLY contain the code relevant to the issue.
2. DO NOT suggest changes in repositories just for the sake of distribution or balance.
3. Changes should ONLY be made in repositories that genuinely need modification to address the issue.
4. Pay careful attention to the programming language and framework of each file to ensure changes are made in the correct repository.
5. If the issue only requires changes in a single repository, only recommend changes in that repository.
6. Identify the primary repository where the core issue exists, and only suggest additional repository changes if they're absolutely necessary.
`;

    const fullAdditionalContext = [
      additionalContext,
      repoContext,
      enhancedContext,
    ]
      .filter(Boolean)
      .join('\n\n');

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
   * Perform enhanced code analysis to build a deeper understanding of the codebase
   */
  private async performEnhancedAnalysis(
    issue: Issue,
    initialFiles: Array<{ path: string; content: string; repository?: string }>
  ) {
    // Ensure repository information is present
    const filesWithRepo = initialFiles.map((file) => {
      if (!file.repository && this.allowedRepositories.length > 0) {
        // If no repository specified, use the first allowed repository as a fallback
        return { ...file, repository: this.allowedRepositories[0] };
      }
      return file;
    });

    // Extract potential stack traces from the issue description
    const stackTraces = this.extractStackTraces(issue.description || '');
    let stackTraceFiles: Array<{
      path: string;
      content: string;
      repository: string;
      lineNumber: number;
    }> = [];

    if (stackTraces.length > 0) {
      for (const trace of stackTraces) {
        const files = await this.codeAnalyzer.parseStackTrace(trace);
        stackTraceFiles.push(...files);
      }
    }

    // Convert stack trace files to regular files but preserve their line numbers for context
    const stackTraceFilesConverted = stackTraceFiles.map((file) => ({
      path: file.path,
      content: this.highlightErrorLine(file.content, file.lineNumber),
      repository: file.repository,
    }));

    // Combine initial files with stack trace files
    const allInitialFiles = [...filesWithRepo, ...stackTraceFilesConverted];

    // Filter out any files that don't have a repository specified
    const filesWithDefinedRepo = allInitialFiles.filter(
      (file): file is { path: string; content: string; repository: string } =>
        typeof file.repository === 'string'
    );

    // Perform progressive analysis to find more relevant files and understand relationships
    const analysis = await this.codeAnalyzer.progressiveAnalysis(
      issue,
      filesWithDefinedRepo
    );

    // For key repositories, get the codebase structure for additional context
    const codebaseStructures: Record<string, string> = {};
    for (const repo of this.allowedRepositories) {
      codebaseStructures[repo] = await this.codeAnalyzer.getCodebaseStructure(
        repo
      );
    }

    return {
      ...analysis,
      codebaseStructures,
      stackTraceFiles,
    };
  }

  /**
   * Prepare enhanced context for the AI based on advanced code analysis
   */
  private prepareEnhancedContext(analysis: {
    relevantFiles: Array<{ path: string; content: string; repository: string }>;
    bugHypothesis: string;
    callGraph: Map<string, string[]>;
    functionDetails: Map<string, string>;
    dataFlowPaths: Map<string, string[]>;
    relatedCommits: Array<{ sha: string; message: string; url: string }>;
    codebaseStructures: Record<string, string>;
    stackTraceFiles: Array<{
      path: string;
      content: string;
      repository: string;
      lineNumber: number;
    }>;
  }): string {
    let context = `# Enhanced Code Analysis\n\n`;

    // Add bug hypothesis if available
    if (analysis.bugHypothesis) {
      context += `## Bug Hypothesis\n${analysis.bugHypothesis}\n\n`;
    }

    // Add function call relationships
    context += `## Function Call Relationships\n`;
    if (analysis.callGraph.size > 0) {
      context += `The following function relationships were detected:\n\n`;

      // Convert call graph to a more readable format
      const callGraphEntries = Array.from(analysis.callGraph.entries())
        .filter(([_, calls]) => calls.length > 0) // Only show functions with calls
        .slice(0, 10); // Limit to top 10 for brevity

      for (const [func, calls] of callGraphEntries) {
        const [repo, filePath, funcName] = func.split(/:|#/);
        context += `- \`${funcName}\` in \`${filePath}\` calls: ${calls.join(
          ', '
        )}\n`;
      }
      context += `\n`;
    } else {
      context += `No clear function relationships detected.\n\n`;
    }

    // Add data flow information
    context += `## Data Flow Analysis\n`;
    if (analysis.dataFlowPaths.size > 0) {
      context += `The following data elements appear in multiple places:\n\n`;

      for (const [
        dataElement,
        references,
      ] of analysis.dataFlowPaths.entries()) {
        if (references.length > 1) {
          // Only show elements with multiple references
          context += `- \`${dataElement}\` is referenced in:\n`;
          for (const ref of references.slice(0, 5)) {
            // Limit to top 5 for brevity
            context += `  - ${ref}\n`;
          }
          if (references.length > 5) {
            context += `  - ... and ${references.length - 5} more locations\n`;
          }
        }
      }
      context += `\n`;
    } else {
      context += `No clear data flow patterns detected.\n\n`;
    }

    // Add related commits if available
    if (analysis.relatedCommits.length > 0) {
      context += `## Similar Bug Fixes in History\n`;
      context += `These past commits may be relevant to this issue:\n\n`;

      for (const commit of analysis.relatedCommits.slice(0, 5)) {
        // Limit to top 5
        context += `- "${
          commit.message.split('\n')[0]
        }" (${commit.sha.substring(0, 7)})\n`;
      }
      context += `\n`;
    }

    // Add stack trace information if available
    if (analysis.stackTraceFiles.length > 0) {
      context += `## Error Locations\n`;
      context += `These files contain lines mentioned in error stack traces:\n\n`;

      for (const file of analysis.stackTraceFiles) {
        context += `- ${file.repository}:${file.path}:${file.lineNumber}\n`;
      }
      context += `\n`;
    }

    // Add repository structure summaries
    context += `## Repository Structures\n`;
    for (const [repo, structure] of Object.entries(
      analysis.codebaseStructures
    )) {
      context += `### ${repo}\n`;
      context += `${structure.split('\n').slice(0, 10).join('\n')}\n`;
      if (structure.split('\n').length > 10) {
        context += `... (structure truncated)\n`;
      }
      context += `\n`;
    }

    return context;
  }

  /**
   * Extract stack traces from text
   */
  private extractStackTraces(text: string): string[] {
    const traces: string[] = [];

    // Common stack trace patterns
    const patterns = [
      // JavaScript/TypeScript stack traces
      /Error:[\s\S]*?(?:at\s+[\w.<>]+\s+\((?:[^()]+):(\d+):(\d+)\)[\s\S]*?){2,}/g,
      // Python tracebacks
      /Traceback \(most recent call last\):[\s\S]*?File "([^"]+)", line (\d+)[\s\S]*?(?:File "([^"]+)", line (\d+)[\s\S]*?)*\w+Error:/g,
      // Java stack traces
      /Exception in thread "[\w-]+" [\w.]+Exception:[\s\S]*?at [\w.]+\([\w.]+\.java:(\d+)\)[\s\S]*?(?:at [\w.]+\([\w.]+\.java:(\d+)\)[\s\S]*?)*/g,
      // Ruby stack traces
      /[\w:]+Error.*?:.*?(?:\n\s+from\s+([^:]+):(\d+):in `[^']+'[\s\S]*?){2,}/g,
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        traces.push(...matches);
      }
    }

    return traces;
  }

  /**
   * Highlight an error line in a file for better context
   */
  private highlightErrorLine(content: string, lineNumber: number): string {
    const lines = content.split('\n');
    if (lineNumber > 0 && lineNumber <= lines.length) {
      // Add a comment indicating this is an error line
      lines[lineNumber - 1] = lines[lineNumber - 1] + ' // <-- ERROR LINE';
    }
    return lines.join('\n');
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
# Repository Information

The code spans across multiple repositories. Here's the distribution of files:
${repoContext}

Important instructions:
1. Focus only on the repositories that ACTUALLY need to be modified to fix the issue.
2. DO NOT suggest changes in repositories just for the sake of distribution or balance.
3. If the issue only requires changes in a single repository, only plan changes in that repository.
4. Pay careful attention to the programming language and framework of each file to ensure changes are planned in the correct repository.
5. Always specify the exact repository where each change should be made.
6. Identify the primary repository where the core issue exists, and only suggest additional repository changes if they're absolutely necessary.
`;

    // Enhance code files with dependency information
    const filesWithRepo = codeFiles.map((file) => {
      if (!file.repository && this.allowedRepositories.length > 0) {
        return { ...file, repository: this.allowedRepositories[0] };
      }
      return file;
    });

    // Trace dependencies to understand related code
    const filesWithDependencies = await this.codeAnalyzer.traceCodeDependencies(
      filesWithRepo.filter((f) => f.repository) as Array<{
        path: string;
        content: string;
        repository: string;
      }>,
      1
    );

    // Build call graph for better understanding of code relationships
    const { callGraph } = await this.codeAnalyzer.buildFunctionCallGraph(
      filesWithDependencies
    );

    // Create a simple visualization of the call graph for the model
    let callGraphContext = '## Function Call Graph\n';

    const callGraphEntries = Array.from(callGraph.entries())
      .filter(([_, calls]) => calls.length > 0)
      .slice(0, 15); // Limit to top 15 for readability

    for (const [func, calls] of callGraphEntries) {
      const [repo, filePath, funcName] = func.split(/:|#/);
      callGraphContext += `- Function \`${funcName}\` in \`${filePath}\` calls: ${calls.join(
        ', '
      )}\n`;
    }

    // Generate a change plan based on the report and enhanced context
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: buildChangePlanPrompt({
            issue,
            technicalReport,
            codeFiles: filesWithDependencies,
            formatCodeForAnalysis: this.formatCodeForAnalysis,
          }),
        },
        {
          role: 'user',
          content: changePlanContext + '\n\n' + callGraphContext,
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
