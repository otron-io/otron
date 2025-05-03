import { Issue, LinearClient } from '@linear/sdk';
import { env } from './env.js';
import {
  buildLinearGptSystemPrompt,
  getAvailableToolsDescription,
} from './prompts.js';
import { memoryManager, MEMORY_EXPIRY } from './tools/memory-manager.js';
import { LinearManager } from './tools/linear-manager.js';
import { ModelAPI } from './utils/model-api.js';
import { RepositoryUtils } from './utils/repo-utils.js';
import { getToolDefinitions } from './tools/index.js';
import { Redis } from '@upstash/redis';

// Initialize Redis client for direct use in this file
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

interface NotificationContext {
  issue: Issue;
  notificationType?: string;
  commentId?: string;
  appUserId?: string;
}

export class Otron {
  private allowedRepositories: string[] = [];
  private linearManager: LinearManager;
  private repoUtils: RepositoryUtils;
  private modelAPI: ModelAPI;
  private _currentIssueId: string | null = null;

  constructor(private linearClient: LinearClient) {
    // Set up GitHub client - only GitHub App authentication is supported
    if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
    } else {
      throw new Error(
        'GitHub App authentication is required. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.'
      );
    }

    // Parse allowed repositories from env variable
    if (env.ALLOWED_REPOSITORIES) {
      this.allowedRepositories = env.ALLOWED_REPOSITORIES.split(',').map((r) =>
        r.trim()
      );
    }

    // Initialize managers
    this.linearManager = new LinearManager(this.linearClient);
    this.repoUtils = new RepositoryUtils(this.allowedRepositories);
    this.modelAPI = new ModelAPI();
  }

  /**
   * Process a notification directly with the AI model
   */
  async processNotification(context: NotificationContext): Promise<void> {
    try {
      const { issue, notificationType, commentId, appUserId } = context;

      // Store the current issue ID for use by other methods
      this._currentIssueId = issue.id;

      // Get full issue context for the model
      const issueContext = await this.linearManager.getIssueContext(
        issue,
        commentId
      );

      // Get previous conversations and actions from memory
      const previousConversations =
        await memoryManager.getPreviousConversations(issue.id);
      const issueHistory = await memoryManager.getIssueHistory(issue.id);

      // Get related issues and repository knowledge
      const relatedIssues = await memoryManager.getRelatedIssues(
        issue.id,
        this.linearClient
      );

      // If we have repository information from previous actions, get knowledge
      let repositoryKnowledge = '';
      try {
        const repoUsage = await redis.zrange(
          `memory:issue:${issue.id}:repositories`,
          0,
          0,
          {
            rev: true,
          }
        );
        if (repoUsage && repoUsage.length > 0) {
          const repoName = repoUsage[0] as string;
          repositoryKnowledge = await memoryManager.getRepositoryKnowledge(
            repoName
          );
        }
      } catch (error) {
        console.error(`Error getting repository usage:`, error);
      }

      // Setup the system tools the model can use
      const availableTools = getAvailableToolsDescription();

      // Create system message with memory context
      const systemMessage = buildLinearGptSystemPrompt({
        notificationType,
        commentId,
        issueContext:
          issueContext +
          previousConversations +
          issueHistory +
          relatedIssues +
          repositoryKnowledge,
        availableTools,
        allowedRepositories: this.allowedRepositories,
      }) as string;

      // Define all the tools Claude can use
      const tools = getToolDefinitions();

      // Initialize message array with the user message - correct format for Anthropic API
      let messages: any[] = [
        {
          role: 'user',
          content:
            'If you have been assigned to this issue, please gather all necessary context and take the appropriate actions. If you are responding to a comment, respond or follow the instructions given.',
        },
      ];

      // Store original assistant responses with thinking blocks for future messages
      let lastAssistantMessage: any = null;

      // Tool use loop - continue until model stops making tool calls
      let hasMoreToolCalls = true;
      let toolCallCount = 0;
      const MAX_TOOL_CALLS = 50; // Maximum number of tool calls to prevent infinite loops

      while (hasMoreToolCalls && toolCallCount < MAX_TOOL_CALLS) {
        // Process with Claude API
        const processResult = await this.modelAPI.processWithTools(
          systemMessage,
          messages,
          tools
        );

        const finalResponse = processResult.response;
        const toolUseBlocks = processResult.toolCalls;
        hasMoreToolCalls = processResult.hasMoreToolCalls;

        // Store this response for future messages
        lastAssistantMessage = {
          role: 'assistant',
          content: finalResponse,
        };

        // Store in memory system for future context
        await memoryManager.storeMemory(
          issue.id,
          'conversation',
          lastAssistantMessage
        );

        // Add to conversation history
        messages.push(lastAssistantMessage);

        // Process tool calls if any
        if (toolUseBlocks.length > 0) {
          // Increment tool call count
          toolCallCount += toolUseBlocks.length;

          // Process each tool call
          for (const toolBlock of toolUseBlocks) {
            const toolId = toolBlock.id;
            const toolName = toolBlock.name;
            const toolInput = toolBlock.input;
            let toolResponse = '';
            let toolSuccess = false;

            // Execute the function based on its name
            try {
              if (toolName === 'createComment') {
                await this.linearClient.createComment({
                  issueId: issue.id,
                  body: toolInput.comment,
                  parentId: toolInput.parentCommentId,
                });
                toolResponse = `Successfully posted comment on issue ${issue.identifier}.`;
                toolSuccess = true;
              } else if (toolName === 'editFile') {
                toolResponse = await this.repoUtils.editFile(
                  toolInput.repository,
                  toolInput.path,
                  toolInput.branch,
                  toolInput.commitMessage,
                  toolInput.edits,
                  this._currentIssueId,
                  toolInput.createBranchIfNeeded,
                  toolInput.baseBranch
                );
                toolSuccess = true;
              } else if (toolName === 'replaceInFile') {
                toolResponse = await this.repoUtils.replaceInFile(
                  toolInput.repository,
                  toolInput.path,
                  toolInput.branch,
                  toolInput.commitMessage,
                  toolInput.replacements,
                  this._currentIssueId,
                  toolInput.createBranchIfNeeded,
                  toolInput.baseBranch
                );
                toolSuccess = true;
              } else if (toolName === 'searchCodeFiles') {
                // Use the code-search API endpoint directly instead of the repository manager
                // Ensure the base URL includes the protocol
                const baseUrl = env.VERCEL_URL.startsWith('http')
                  ? env.VERCEL_URL
                  : `https://${env.VERCEL_URL}`;
                const searchUrl = new URL('/api/code-search', baseUrl);

                // Add search parameters
                searchUrl.searchParams.append(
                  'repository',
                  toolInput.repository
                );
                searchUrl.searchParams.append('query', toolInput.query);
                if (toolInput.fileFilter) {
                  searchUrl.searchParams.append(
                    'fileFilter',
                    toolInput.fileFilter
                  );
                }
                if (toolInput.maxResults) {
                  searchUrl.searchParams.append(
                    'limit',
                    toolInput.maxResults.toString()
                  );
                }

                // Make the API request
                try {
                  const response = await fetch(searchUrl.toString(), {
                    headers: {
                      'X-Internal-Token': env.INTERNAL_API_TOKEN,
                    },
                  });

                  if (!response.ok) {
                    throw new Error(
                      `Search API returned status ${response.status}`
                    );
                  }

                  const searchData = await response.json();
                  const results = searchData.results || [];

                  // Store search terms for future semantic understanding
                  const searchTerms: string[] = toolInput.query
                    .toLowerCase()
                    .split(/\s+/)
                    .filter((term: string) => term.length > 3)
                    .slice(0, 5);

                  // Store these search terms for future knowledge retrieval
                  for (const term of searchTerms) {
                    await redis.zincrby(
                      `memory:issue:${issue.id}:search_terms`,
                      1,
                      term
                    );
                    await redis.expire(
                      `memory:issue:${issue.id}:search_terms`,
                      MEMORY_EXPIRY
                    );
                  }

                  // Prepare a formatted response with a summary and context information
                  let formattedResults = `Found ${results.length} relevant files for query "${toolInput.query}" in ${toolInput.repository}:\n\n`;

                  // Add each file with path, content, and context if available
                  for (let i = 0; i < results.length; i++) {
                    const result = results[i];
                    formattedResults += `File: ${result.path}\n`;
                    formattedResults += `Line ${result.startLine}: ${
                      result.content.split('\n')[0]
                    }\n`;

                    // Include context information if available
                    formattedResults += `Context: Language: ${result.language}, Type: ${result.type}`;
                    if (result.name) {
                      formattedResults += `, Name: ${result.name}`;
                    }
                    formattedResults += `, Lines: ${result.startLine}-${result.endLine}`;
                    formattedResults += `, Score: ${(
                      result.score * 100
                    ).toFixed(2)}%\n\n`;
                    formattedResults += `${result.content}\n\n`;
                  }

                  // Set the tool response
                  toolResponse = formattedResults;
                  toolSuccess = results.length > 0;

                  // If we found code, store the connection between this issue and these files
                  if (results.length > 0) {
                    for (const result of results) {
                      await redis.sadd(
                        `memory:issue:file:${issue.id}`,
                        `${toolInput.repository}:${result.path}`
                      );
                      await redis.sadd(
                        `memory:file:issue:${toolInput.repository}:${result.path}`,
                        issue.id
                      );

                      // Store expiry for these sets
                      await redis.expire(
                        `memory:issue:file:${issue.id}`,
                        MEMORY_EXPIRY
                      );
                      await redis.expire(
                        `memory:file:issue:${toolInput.repository}:${result.path}`,
                        MEMORY_EXPIRY
                      );
                    }
                  }
                } catch (error) {
                  toolResponse = `Error searching code: ${
                    error instanceof Error ? error.message : String(error)
                  }`;
                  toolSuccess = false;
                }
              } else if (toolName === 'getDirectoryStructure') {
                const directoryStructure = await this.repoUtils
                  .getLocalRepoManager()
                  .getDirectoryStructure(toolInput.repository, toolInput.path);

                // Format the directory structure as a string
                let formattedStructure = `Directory structure for ${
                  toolInput.path || 'root'
                } in ${toolInput.repository}:\n\n`;

                // Add each file/directory to the response
                directoryStructure.forEach((item: any) => {
                  const icon = item.type === 'dir' ? '📁' : '📄';
                  const size = item.size
                    ? ` (${Math.round(item.size / 1024)}KB)`
                    : '';
                  formattedStructure += `${icon} ${item.path}${size}\n`;
                });

                toolResponse = formattedStructure;
                toolSuccess = true;
              } else if (toolName === 'getFileContent') {
                const content = await this.repoUtils
                  .getLocalRepoManager()
                  .getFileContent(
                    toolInput.path,
                    toolInput.repository,
                    toolInput.startLine || 1,
                    toolInput.maxLines || 200,
                    toolInput.branch
                  );
                toolResponse = `Retrieved content for ${toolInput.path} in ${
                  toolInput.repository
                }${
                  toolInput.branch ? ` (branch: ${toolInput.branch})` : ''
                }:\n${content}`;
                toolSuccess = true;
              } else if (toolName === 'getPullRequest') {
                const pullRequest = await this.repoUtils
                  .getLocalRepoManager()
                  .getPullRequest(toolInput.repository, toolInput.pullNumber);
                toolResponse = `Pull request details for ${toolInput.repository}#${toolInput.pullNumber}\n\n`;
                toolResponse += `Title: ${pullRequest.title}\n`;
                toolResponse += `State: ${pullRequest.state}\n`;
                toolResponse += `Author: ${pullRequest.user}\n`;
                toolResponse += `Description: ${pullRequest.body}\n\n`;

                if (pullRequest.comments.length > 0) {
                  toolResponse += `Comments:\n`;
                  pullRequest.comments.forEach((comment) => {
                    toolResponse += `- User: ${comment.user}\n  ${comment.body}\n  Created at: ${comment.createdAt}\n\n`;
                  });
                } else {
                  toolResponse += `No comments found.\n\n`;
                }

                if (pullRequest.reviewComments.length > 0) {
                  toolResponse += `Review Comments:\n`;
                  pullRequest.reviewComments.forEach((comment) => {
                    toolResponse += `- User: ${comment.user}\n  File: ${
                      comment.path
                    }${
                      comment.position ? ` (Line: ${comment.position})` : ''
                    }\n  ${comment.body}\n  Created at: ${
                      comment.createdAt
                    }\n\n`;
                  });
                } else {
                  toolResponse += `No review comments found.\n`;
                }

                toolSuccess = true;
              } else if (toolName === 'updateIssueStatus') {
                await this.linearManager.updateIssueStatus(
                  toolInput.issueId,
                  toolInput.status
                );
                toolResponse = `Successfully updated status of issue ${toolInput.issueId} to "${toolInput.status}".`;
                toolSuccess = true;
              } else if (toolName === 'addLabel') {
                await this.linearManager.addLabel(
                  toolInput.issueId,
                  toolInput.label
                );
                toolResponse = `Successfully added label "${toolInput.label}" to issue ${toolInput.issueId}.`;
                toolSuccess = true;
              } else if (toolName === 'removeLabel') {
                await this.linearManager.removeLabel(
                  toolInput.issueId,
                  toolInput.label
                );
                toolResponse = `Successfully removed label "${toolInput.label}" from issue ${toolInput.issueId}.`;
                toolSuccess = true;
              } else if (toolName === 'assignIssue') {
                await this.linearManager.assignIssue(
                  toolInput.issueId,
                  toolInput.assigneeEmail
                );
                toolResponse = `Successfully assigned issue ${toolInput.issueId} to ${toolInput.assigneeEmail}.`;
                toolSuccess = true;
              } else if (toolName === 'createIssue') {
                await this.linearManager.createIssue(
                  toolInput.teamId,
                  toolInput.title,
                  toolInput.description,
                  toolInput.status,
                  toolInput.priority,
                  toolInput.parentIssueId
                );
                toolResponse = `Successfully created new issue "${toolInput.title}".`;
                toolSuccess = true;
              } else if (toolName === 'addIssueAttachment') {
                await this.linearManager.addIssueAttachment(
                  toolInput.issueId,
                  toolInput.url,
                  toolInput.title
                );
                toolResponse = `Successfully added attachment "${toolInput.title}" to issue ${toolInput.issueId}.`;
                toolSuccess = true;
              } else if (toolName === 'updateIssuePriority') {
                await this.linearManager.updateIssuePriority(
                  toolInput.issueId,
                  toolInput.priority
                );
                toolResponse = `Successfully updated priority of issue ${toolInput.issueId} to ${toolInput.priority}.`;
                toolSuccess = true;
              } else if (toolName === 'createPullRequest') {
                // Check if branch is protected
                const branchCheck = this.repoUtils.isProtectedBranch(
                  toolInput.branch
                );
                if (branchCheck.isProtected) {
                  toolResponse = branchCheck.errorMessage as string;
                  toolSuccess = false;
                } else {
                  try {
                    // First check if the branch exists
                    try {
                      await this.repoUtils
                        .getLocalRepoManager()
                        .getFileContent(
                          'README.md',
                          toolInput.repository,
                          1,
                          1,
                          toolInput.branch
                        );
                      console.log(
                        `Branch ${toolInput.branch} already exists, skipping creation`
                      );
                    } catch (error: any) {
                      // If file not found in the branch, branch probably doesn't exist - create it
                      if (
                        error.message &&
                        error.message.includes('not found')
                      ) {
                        // Create branch
                        await this.repoUtils
                          .getLocalRepoManager()
                          .createBranch(
                            toolInput.branch,
                            toolInput.repository,
                            toolInput.baseBranch || 'main'
                          );
                        console.log(
                          `Created new branch ${toolInput.branch} in ${toolInput.repository}`
                        );
                      } else {
                        // For other errors, log but continue
                        console.warn(
                          `Warning when checking branch existence: ${error.message}`
                        );
                      }
                    }

                    // Apply each change
                    for (const change of toolInput.changes) {
                      await this.repoUtils
                        .getLocalRepoManager()
                        .createOrUpdateFile(
                          change.path,
                          change.content,
                          `Update ${change.path} for PR`,
                          toolInput.repository,
                          toolInput.branch
                        );
                    }

                    // Create pull request
                    const pullRequest = await this.repoUtils
                      .getLocalRepoManager()
                      .createPullRequest(
                        toolInput.title,
                        toolInput.description,
                        toolInput.branch,
                        toolInput.baseBranch || 'main',
                        toolInput.repository
                      );

                    toolResponse = `Successfully created pull request: ${pullRequest.url}`;
                    toolSuccess = true;
                  } catch (error: any) {
                    toolResponse = `Error creating pull request: ${error.message}`;
                    toolSuccess = false;
                  }
                }
              } else if (toolName === 'createBranchWithChanges') {
                // Check if branch is protected
                const branchCheck = this.repoUtils.isProtectedBranch(
                  toolInput.branch
                );
                if (branchCheck.isProtected) {
                  toolResponse = branchCheck.errorMessage as string;
                  toolSuccess = false;
                } else {
                  // Create branch only if skipBranchCreation is not true
                  if (!toolInput.skipBranchCreation) {
                    try {
                      await this.repoUtils
                        .getLocalRepoManager()
                        .createBranch(
                          toolInput.branch,
                          toolInput.repository,
                          toolInput.baseBranch || 'main'
                        );
                      console.log(
                        `Created new branch ${toolInput.branch} in ${toolInput.repository}`
                      );
                    } catch (error: any) {
                      // Branch might already exist, which is fine for this operation
                      console.log(
                        `Note: Branch ${toolInput.branch} may already exist: ${error.message}`
                      );
                    }
                  } else {
                    console.log(
                      `Using existing branch ${toolInput.branch} in ${toolInput.repository}`
                    );
                  }

                  // Apply each change with the specified commit message
                  let filesChanged = 0;
                  for (const change of toolInput.changes) {
                    await this.repoUtils
                      .getLocalRepoManager()
                      .createOrUpdateFile(
                        change.path,
                        change.content,
                        toolInput.commitMessage || `Update ${change.path}`,
                        toolInput.repository,
                        toolInput.branch
                      );
                    filesChanged++;
                  }

                  const branchAction = toolInput.skipBranchCreation
                    ? 'existing'
                    : 'new or existing';
                  toolResponse = `Successfully committed ${filesChanged} file${
                    filesChanged !== 1 ? 's' : ''
                  } to ${branchAction} branch ${toolInput.branch} in ${
                    toolInput.repository
                  }`;
                  toolSuccess = true;

                  // Store relationship between issue and branch
                  await memoryManager.storeRelationship(
                    'issue:branch',
                    issue.id,
                    `${toolInput.repository}:${toolInput.branch}`
                  );
                }
              } else if (toolName === 'setPointEstimate') {
                await this.linearManager.setPointEstimate(
                  toolInput.issueId,
                  toolInput.estimate
                );
                toolResponse = `Successfully set point estimate for issue ${toolInput.issueId} to ${toolInput.estimate} points.`;
                toolSuccess = true;
              } else if (toolName === 'endResponse') {
                // This tool explicitly signals the end of the model's response
                toolResponse = toolInput.summary
                  ? `Response ended with summary: ${toolInput.summary}`
                  : 'Response complete.';
                toolSuccess = true;
                hasMoreToolCalls = false; // Signal end of tool calls loop
              } else {
                toolResponse = `Unknown function: ${toolName}`;
              }

              // Track tool usage in memory system
              await memoryManager.trackToolUsage(toolName, toolSuccess, {
                issueId: issue.id,
                input: toolInput,
                response: toolResponse,
              });

              // Store relevant relationships
              if (toolName === 'getFileContent' && toolSuccess) {
                await memoryManager.storeRelationship(
                  'issue:file',
                  issue.id,
                  `${toolInput.repository}:${toolInput.path}`
                );
              } else if (toolName === 'createPullRequest' && toolSuccess) {
                await memoryManager.storeRelationship(
                  'issue:pr',
                  issue.id,
                  toolResponse.split(' ').pop() || ''
                );
              }

              // Track repository usage for this issue
              if (
                toolName === 'searchCodeFiles' ||
                toolName === 'getFileContent' ||
                toolName === 'getDirectoryStructure'
              ) {
                if (toolInput.repository) {
                  // Keep track of which repositories are relevant to this issue
                  await redis.zincrby(
                    `memory:issue:${issue.id}:repositories`,
                    1,
                    toolInput.repository
                  );
                  await redis.expire(
                    `memory:issue:${issue.id}:repositories`,
                    MEMORY_EXPIRY
                  );

                  // Track file access for repository knowledge building
                  if (toolName === 'getFileContent' && toolInput.path) {
                    await redis.zincrby(
                      `memory:repository:${toolInput.repository}:files`,
                      1,
                      toolInput.path
                    );
                    await redis.expire(
                      `memory:repository:${toolInput.repository}:files`,
                      MEMORY_EXPIRY
                    );

                    // Create bidirectional mapping for issues and files
                    await redis.sadd(
                      `memory:issue:file:${issue.id}`,
                      `${toolInput.repository}:${toolInput.path}`
                    );
                    await redis.sadd(
                      `memory:file:issue:${toolInput.repository}:${toolInput.path}`,
                      issue.id
                    );

                    // Store expiry for these sets
                    await redis.expire(
                      `memory:issue:file:${issue.id}`,
                      MEMORY_EXPIRY
                    );
                    await redis.expire(
                      `memory:file:issue:${toolInput.repository}:${toolInput.path}`,
                      MEMORY_EXPIRY
                    );

                    // Extract potential topics from the file path
                    if (toolInput.path) {
                      try {
                        const pathParts = toolInput.path.split('/');
                        const fileName = pathParts[pathParts.length - 1];
                        const topics = fileName
                          .split(/[_.-]/)
                          .filter((t: string) => t.length > 3);

                        // Store any meaningful topics as code knowledge
                        for (const topic of topics) {
                          await memoryManager.storeCodeKnowledge(
                            toolInput.repository,
                            toolInput.path,
                            topic
                          );
                        }
                      } catch (error) {
                        console.error(
                          'Error processing file path for topics:',
                          error
                        );
                      }
                    }
                  }
                }
              }
            } catch (error) {
              toolResponse = `Error executing ${toolName}: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`;

              // Track failed tool usage
              await memoryManager.trackToolUsage(toolName, false, {
                issueId: issue.id,
                input: toolInput,
                response: toolResponse,
              });
            }

            // Add tool response to conversation
            messages.push(
              this.modelAPI.formatToolResultMessage(toolId, toolResponse)
            );

            // Log tool result
            console.log(`\n[Tool Result] For tool: ${toolName}`);
            console.log(
              `Response: ${toolResponse.substring(0, 500)}${
                toolResponse.length > 500 ? '...(truncated)' : ''
              }`
            );
          }
        } else {
          // No tool calls, exit the loop
          hasMoreToolCalls = false;

          // If there's a text response, post it as a comment
          const textBlocks = finalResponse.filter(
            (block: any) => block && block.type === 'text'
          );

          // Final response from the model, we will not do anything with it for now except log it
          if (textBlocks.length > 0) {
            const textContent = textBlocks
              .map((block: any) => block.text || '')
              .join('\n');
            // await this.linearClient.createComment({
            //   issueId: issue.id,
            //   body: textContent,
            //   parentId: commentId,
            // });

            console.log('Final response from the model:', textContent);
          }
        }
      }

      // Check if we hit the tool call limit
      if (toolCallCount >= MAX_TOOL_CALLS) {
        console.warn(
          `Hit maximum tool call limit (${MAX_TOOL_CALLS}) for issue ${issue.identifier}. Stopping execution.`
        );
      }
    } catch (error) {
      console.error(`Error processing notification:`, error);
    }
  }

  // Helper method to get the current issue ID
  getCurrentIssueId(): string | null {
    return this._currentIssueId;
  }
}
