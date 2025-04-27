import { openai } from '@ai-sdk/openai';
import { Issue, LinearClient } from '@linear/sdk';
import { generateText } from 'ai';
import { Octokit } from '@octokit/rest';
import { env } from './env.js';
import { TechnicalAnalysisService } from './technical-analysis.js';
import { PRManager } from './pr-manager.js';

// Initialize the model
const model = openai('gpt-4');

export class DeveloperAgent {
  private technicalAnalysis: TechnicalAnalysisService;
  private prManager: PRManager;
  private octokit: Octokit;
  private allowedRepositories: string[] = [];
  private defaultRepo: { owner: string; repo: string };

  constructor(private linearClient: LinearClient) {
    this.technicalAnalysis = new TechnicalAnalysisService(linearClient);
    this.prManager = new PRManager(linearClient);
    this.octokit = new Octokit({
      auth: env.GITHUB_TOKEN,
    });

    // Parse allowed repositories from env variable
    if (env.ALLOWED_REPOSITORIES) {
      this.allowedRepositories = env.ALLOWED_REPOSITORIES.split(',').map((r) =>
        r.trim()
      );
    } else {
      // If no specific repositories are defined, use the default one
      this.allowedRepositories = [`${env.REPO_OWNER}/${env.REPO_NAME}`];
    }

    this.defaultRepo = {
      owner: env.REPO_OWNER,
      repo: env.REPO_NAME,
    };
  }

  /**
   * Main entry point to process an issue
   */
  async processIssue(issue: Issue): Promise<void> {
    try {
      console.log(`Processing issue: ${issue.identifier} - ${issue.title}`);

      // Add a comment to let the team know the agent is working on it
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I'm analyzing this issue and will provide a technical assessment shortly. 🔍`,
      });

      // 1. Identify relevant code files
      const relevantFiles = await this.identifyRelevantFiles(issue);

      // 2. Generate technical analysis
      const technicalReport =
        await this.technicalAnalysis.generateTechnicalReport(
          issue,
          relevantFiles
        );

      // 3. Post technical report as a comment
      await this.technicalAnalysis.postReportToIssue(issue, technicalReport);

      // 4. Plan code changes
      const { branchName, changePlan } =
        await this.technicalAnalysis.planCodeChanges(
          issue,
          technicalReport,
          relevantFiles
        );

      // 5. Determine if we should implement the changes
      const shouldImplement = await this.shouldImplementChanges(
        issue,
        technicalReport
      );

      if (shouldImplement) {
        // 6. Generate implementation changes
        const codeChanges = await this.generateCodeChanges(
          issue,
          relevantFiles,
          technicalReport,
          changePlan
        );

        // 7. Create PRs with changes across multiple repositories
        const prs = await this.prManager.implementAndCreatePRs(
          issue,
          branchName,
          codeChanges,
          `Implements solution for ${issue.identifier}\n\n${technicalReport}`
        );

        if (prs.length > 0) {
          const repoList = prs.map((pr) => pr.repoFullName).join(', ');
          console.log(
            `Created PRs in repositories: ${repoList} for issue ${issue.identifier}`
          );
        } else {
          console.log(`No PRs were created for issue ${issue.identifier}`);

          // Add a comment explaining that no changes could be made
          await this.linearClient.createComment({
            issueId: issue.id,
            body: `I've analyzed the issue but was unable to create pull requests. This might be because no valid code changes could be generated. Please review the technical analysis above.`,
          });
        }
      } else {
        // Just post the technical report without implementation
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `I've provided a technical analysis above, but I won't be implementing these changes automatically. Please review and let me know if you'd like me to proceed with implementation.`,
        });
      }
    } catch (error: any) {
      console.error(`Error processing issue ${issue.identifier}:`, error);

      // Notify about the failure
      try {
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `I encountered an error while processing this issue: \`${
            error.message || 'Unknown error'
          }\`\n\nPlease check the logs for more details.`,
        });
      } catch (e) {
        console.error(`Failed to post error comment:`, e);
      }
    }
  }

  /**
   * Process an issue and force implementation regardless of complexity assessment
   */
  async processIssueWithImplementation(issue: Issue): Promise<void> {
    try {
      console.log(
        `Processing issue with forced implementation: ${issue.identifier} - ${issue.title}`
      );

      // Add a comment to let the team know the agent is working on it
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I'm analyzing this issue and will implement changes as requested. 🔍`,
      });

      // 1. Identify relevant code files
      const relevantFiles = await this.identifyRelevantFiles(issue);

      // 2. Generate technical analysis
      const technicalReport =
        await this.technicalAnalysis.generateTechnicalReport(
          issue,
          relevantFiles
        );

      // 3. Post technical report as a comment
      await this.technicalAnalysis.postReportToIssue(issue, technicalReport);

      // 4. Plan code changes
      const { branchName, changePlan } =
        await this.technicalAnalysis.planCodeChanges(
          issue,
          technicalReport,
          relevantFiles
        );

      // 5. Generate implementation changes (skip the shouldImplement check)
      const codeChanges = await this.generateCodeChanges(
        issue,
        relevantFiles,
        technicalReport,
        changePlan
      );

      // 6. Create PRs with changes across multiple repositories
      const prs = await this.prManager.implementAndCreatePRs(
        issue,
        branchName,
        codeChanges,
        `Implements solution for ${issue.identifier}\n\n${technicalReport}`
      );

      if (prs.length > 0) {
        const repoList = prs.map((pr) => pr.repoFullName).join(', ');
        console.log(
          `Created PRs in repositories: ${repoList} for issue ${issue.identifier}`
        );
      } else {
        console.log(`No PRs were created for issue ${issue.identifier}`);

        // Add a comment explaining that no changes could be made
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `I've tried to implement the changes but was unable to create pull requests. This might be because no valid code changes could be generated. Please review the technical analysis above.`,
        });
      }
    } catch (error: any) {
      console.error(`Error processing issue ${issue.identifier}:`, error);

      // Notify about the failure
      try {
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `I encountered an error while implementing changes: \`${
            error.message || 'Unknown error'
          }\`\n\nPlease check the logs for more details.`,
        });
      } catch (e) {
        console.error(`Failed to post error comment:`, e);
      }
    }
  }

  /**
   * Sanitizes file paths to ensure they're correctly formatted
   */
  private sanitizePath(path: string): string {
    // Remove leading slashes
    return path.replace(/^\/+/, '');
  }

  /**
   * Identify relevant code files for the issue
   */
  private async identifyRelevantFiles(issue: Issue): Promise<
    Array<{
      path: string;
      content: string;
    }>
  > {
    // Extract keywords from the issue
    const { text: keywords } = await generateText({
      model,
      prompt: `
Extract 3-5 key technical terms or code identifiers from this issue description that would be useful for searching related code:

ISSUE: ${issue.identifier} - ${issue.title}
DESCRIPTION: ${issue.description || 'No description provided'}

Return only the keywords separated by commas, no explanation.`,
      temperature: 0.1,
      maxTokens: 100,
    });

    console.log(`Identified keywords for search: ${keywords}`);

    const relevantFiles: Array<{ path: string; content: string }> = [];
    const keywordList = keywords.split(',').map((k) => k.trim());

    // Search for each keyword in allowed repositories
    for (const repoFullName of this.allowedRepositories) {
      const [owner, repo] = repoFullName.split('/');

      for (const keyword of keywordList) {
        if (!keyword) continue;

        try {
          // Search for the keyword in code
          const searchResults = await this.octokit.search.code({
            q: `${keyword} in:file repo:${owner}/${repo}`,
            per_page: 5,
          });

          // For each result, get the file content
          for (const item of searchResults.data.items) {
            // Sanitize the path
            const sanitizedPath = this.sanitizePath(item.path);

            // Skip if we already have this file
            if (relevantFiles.some((f) => f.path === sanitizedPath)) {
              continue;
            }

            try {
              // Get file content
              const content = await this.prManager.getFileContent(
                sanitizedPath,
                undefined,
                repoFullName
              );

              relevantFiles.push({
                path: sanitizedPath,
                content,
              });

              // Limit the number of files we process
              if (relevantFiles.length >= 10) {
                break;
              }
            } catch (error) {
              console.error(
                `Error fetching content for ${sanitizedPath}:`,
                error
              );
            }
          }

          // Don't continue searching if we have enough files
          if (relevantFiles.length >= 10) {
            break;
          }
        } catch (error) {
          console.error(`Error searching for keyword "${keyword}":`, error);
        }
      }

      // Don't search in more repos if we have enough files
      if (relevantFiles.length >= 10) {
        break;
      }
    }

    // If we couldn't find any files, provide a helpful message
    if (relevantFiles.length === 0) {
      console.log(`No relevant files found for issue ${issue.identifier}`);

      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I couldn't find any relevant code files based on the issue description. Please provide more specific technical details or tag relevant files/components.`,
      });

      // Return a placeholder to avoid breaking the flow
      return [
        {
          path: 'README.md',
          content: 'No relevant files found',
        },
      ];
    }

    return relevantFiles;
  }

  /**
   * Decide whether the agent should implement changes automatically
   */
  private async shouldImplementChanges(
    issue: Issue,
    analysis: string
  ): Promise<boolean> {
    // Get issue labels
    const labels = await issue.labels();
    const labelNames = labels.nodes.map((l) => l.name.toLowerCase());

    // If there's a label explicitly requesting implementation
    if (
      labelNames.includes('agent:implement') ||
      labelNames.includes('bot:implement')
    ) {
      return true;
    }

    // If there's a label explicitly blocking implementation
    if (
      labelNames.includes('agent:analysis-only') ||
      labelNames.includes('bot:no-implement')
    ) {
      return false;
    }

    // Check issue complexity
    const { text: complexityAssessment } = await generateText({
      model,
      prompt: `
Based on this technical analysis, assess if the required changes are simple enough for autonomous implementation.
Consider factors like:
- Number of files that need changing
- Complexity of logic changes
- Risk of breaking existing functionality
- Need for new tests

ANALYSIS:
${analysis}

Answer with ONLY "yes" if the changes are simple and safe for automated implementation, or "no" if human review is needed first.`,
      temperature: 0.1,
      maxTokens: 10,
    });

    return complexityAssessment.toLowerCase().trim() === 'yes';
  }

  /**
   * Generate code changes for implementation
   */
  private async generateCodeChanges(
    issue: Issue,
    codeFiles: Array<{ path: string; content: string }>,
    technicalReport: string,
    changePlan: string
  ): Promise<
    Array<{
      path: string;
      content: string;
      message: string;
      repository?: string;
    }>
  > {
    try {
      // Add repository info to each file path
      const filesWithRepoInfo = codeFiles.map((file) => {
        // Try to find which repository this file belongs to
        for (const repoName of this.allowedRepositories) {
          // Check if we included this file path as a result of searching in this repo
          return {
            path: file.path,
            content: file.content,
            repository: repoName,
          };
        }
        return {
          path: file.path,
          content: file.content,
          repository: `${this.defaultRepo.owner}/${this.defaultRepo.repo}`,
        };
      });

      // Generate concrete code changes based on the technical report and plan
      const { text: implementationJson } = await generateText({
        model,
        prompt: `
You are a code implementation expert. Based on the technical report and change plan, implement the necessary code changes.
Return your response as a JSON array with objects containing:
- path: the file path
- content: the complete updated file content 
- message: a descriptive commit message
- repository: (optional) the full repository name in format "owner/repo" if this change is for a specific repository

ISSUE: ${issue.identifier} - ${issue.title}
DESCRIPTION: ${issue.description || 'No description provided'}

TECHNICAL REPORT:
${technicalReport}

IMPLEMENTATION PLAN:
${changePlan}

CODE FILES:
${filesWithRepoInfo
  .map(
    (file) => `Path: ${file.path} (Repository: ${file.repository || 'default'})
\`\`\`
${file.content}
\`\`\``
  )
  .join('\n\n')}

REPOSITORIES AVAILABLE:
${this.allowedRepositories.join(', ')}

IMPORTANT: File paths must not start with a slash. Make sure all path values are relative to the repository root without a leading slash.

Respond with ONLY a valid JSON array of change objects without explanation.`,
        temperature: 0.2,
        maxTokens: 4000,
      });

      // Parse the JSON response, handling common formatting issues
      try {
        let parsedJson = implementationJson.trim();

        // Remove any markdown code block markers if present
        parsedJson = parsedJson
          .replace(/^```(json)?/, '')
          .replace(/```$/, '')
          .trim();

        // Try to parse the JSON
        const changes = JSON.parse(parsedJson) as Array<{
          path: string;
          content: string;
          message: string;
          repository?: string;
        }>;

        // Log successful parsing
        console.log(`Successfully parsed ${changes.length} code changes`);

        // Validate each change has the required fields and sanitize paths
        const validChanges = changes
          .filter((change) => {
            const isValid =
              typeof change.path === 'string' &&
              change.path.length > 0 &&
              typeof change.content === 'string' &&
              change.content.length > 0 &&
              typeof change.message === 'string' &&
              change.message.length > 0;

            if (!isValid) {
              console.warn(
                `Skipping invalid change for path: ${change.path || 'unknown'}`
              );
            }

            return isValid;
          })
          .map((change) => {
            // Sanitize the path to ensure it doesn't start with a slash
            return {
              ...change,
              path: this.sanitizePath(change.path),
            };
          });

        if (validChanges.length === 0) {
          throw new Error('No valid code changes were generated');
        }

        return validChanges;
      } catch (parseError: unknown) {
        console.error('Failed to parse implementation JSON:', parseError);

        // If we couldn't parse the JSON, notify in Linear and throw error
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `I generated a technical analysis but encountered an error when implementing the code changes. Please review the technical report and implement manually.`,
        });

        const errorMessage =
          parseError instanceof Error
            ? parseError.message
            : 'Unknown parsing error';

        throw new Error(
          `Could not parse implementation changes: ${errorMessage}`
        );
      }
    } catch (error: any) {
      console.error('Failed to generate implementation changes:', error);
      throw new Error(
        `Could not generate implementation changes: ${
          error.message || 'Unknown error'
        }`
      );
    }
  }
}
