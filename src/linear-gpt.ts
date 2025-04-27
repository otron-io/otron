import { Issue, LinearClient } from '@linear/sdk';
import OpenAI from 'openai';
import { env } from './env.js';
import { LocalRepositoryManager } from './repository-manager.js';
import {
  buildLinearGptSystemPrompt,
  getAvailableToolsDescription,
} from './prompts.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

interface NotificationContext {
  issue: Issue;
  notificationType?: string;
  commentId?: string;
  appUserId?: string;
}

export class LinearGPT {
  private allowedRepositories: string[] = [];
  private localRepoManager: LocalRepositoryManager;

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

    // Pass the allowed repositories to the LocalRepositoryManager
    this.localRepoManager = new LocalRepositoryManager(
      this.allowedRepositories
    );
  }

  /**
   * Process a notification directly with the AI model
   */
  async processNotification(context: NotificationContext): Promise<void> {
    try {
      const { issue, notificationType, commentId, appUserId } = context;

      // Get full issue context for the model
      const issueContext = await this.getIssueContext(issue, commentId);

      // Setup the system tools the model can use
      const availableTools = getAvailableToolsDescription();

      // Create conversation history
      const messages: Array<OpenAI.Chat.ChatCompletionMessageParam> = [
        {
          role: 'system',
          content: buildLinearGptSystemPrompt({
            notificationType,
            commentId,
            issueContext,
            availableTools,
            allowedRepositories: this.allowedRepositories,
          }),
        },
        {
          role: 'user',
          content:
            'If you have been assigned to this issue, please gather all necessary context and take the appropriate actions. If you are responding to a comment, respond or follow the instructions given.',
        },
      ];

      // Tool use loop - continue until model stops making tool calls
      let hasMoreToolCalls = true;
      let toolCallCount = 0;
      const MAX_TOOL_CALLS = 50; // Maximum number of tool calls to prevent infinite loops

      while (hasMoreToolCalls && toolCallCount < MAX_TOOL_CALLS) {
        // Use OpenAI's client
        const response = await openai.chat.completions.create({
          model: 'gpt-4.1',
          messages,
          temperature: 0.2,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          tools: [
            {
              type: 'function',
              function: {
                name: 'createComment',
                description: 'Create a comment on a Linear issue',
                parameters: {
                  type: 'object',
                  properties: {
                    issueId: {
                      type: 'string',
                      description: 'The ID of the issue to comment on',
                    },
                    comment: {
                      type: 'string',
                      description: 'The comment text to post',
                    },
                    parentCommentId: {
                      type: 'string',
                      description:
                        'Optional parent comment ID if this is a reply',
                    },
                  },
                  required: ['issueId', 'comment'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'searchCodeFiles',
                description:
                  'Search for relevant code files related to keywords',
                parameters: {
                  type: 'object',
                  properties: {
                    repository: {
                      type: 'string',
                      description:
                        'Repository to search in (owner/repo format)',
                    },
                    query: {
                      type: 'string',
                      description: 'Search query/keywords',
                    },
                  },
                  required: ['repository', 'query'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'getDirectoryStructure',
                description:
                  'Get the directory structure of a repository or specific path',
                parameters: {
                  type: 'object',
                  properties: {
                    repository: {
                      type: 'string',
                      description: 'Repository to explore (owner/repo format)',
                    },
                    path: {
                      type: 'string',
                      description:
                        'Path within the repository to explore (optional)',
                    },
                  },
                  required: ['repository'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'getFileContent',
                description:
                  'Get the content of a specific file from a repository',
                parameters: {
                  type: 'object',
                  properties: {
                    repository: {
                      type: 'string',
                      description:
                        'Repository containing the file (owner/repo format)',
                    },
                    path: {
                      type: 'string',
                      description: 'Path to the file within the repository',
                    },
                  },
                  required: ['repository', 'path'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'updateIssueStatus',
                description: 'Update the status of an issue in Linear',
                parameters: {
                  type: 'object',
                  properties: {
                    issueId: {
                      type: 'string',
                      description: 'The ID of the issue to update',
                    },
                    status: {
                      type: 'string',
                      description:
                        'The new status name (e.g., "Todo", "In Progress", "Done", "Backlog")',
                    },
                  },
                  required: ['issueId', 'status'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'addLabel',
                description: 'Add a label to an issue in Linear',
                parameters: {
                  type: 'object',
                  properties: {
                    issueId: {
                      type: 'string',
                      description: 'The ID of the issue to update',
                    },
                    label: {
                      type: 'string',
                      description: 'The name of the label to add',
                    },
                  },
                  required: ['issueId', 'label'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'removeLabel',
                description: 'Remove a label from an issue in Linear',
                parameters: {
                  type: 'object',
                  properties: {
                    issueId: {
                      type: 'string',
                      description: 'The ID of the issue to update',
                    },
                    label: {
                      type: 'string',
                      description: 'The name of the label to remove',
                    },
                  },
                  required: ['issueId', 'label'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'assignIssue',
                description: 'Assign an issue to a team member in Linear',
                parameters: {
                  type: 'object',
                  properties: {
                    issueId: {
                      type: 'string',
                      description: 'The ID of the issue to assign',
                    },
                    assigneeEmail: {
                      type: 'string',
                      description:
                        'The email of the user to assign the issue to',
                    },
                  },
                  required: ['issueId', 'assigneeEmail'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'createIssue',
                description: 'Create a new issue in Linear',
                parameters: {
                  type: 'object',
                  properties: {
                    teamId: {
                      type: 'string',
                      description: 'The ID of the team to create the issue in',
                    },
                    title: {
                      type: 'string',
                      description: 'The title of the issue',
                    },
                    description: {
                      type: 'string',
                      description: 'The description of the issue',
                    },
                    status: {
                      type: 'string',
                      description:
                        'The status name for the new issue (e.g., "Todo", "In Progress")',
                    },
                    priority: {
                      type: 'integer',
                      description:
                        'The priority of the issue (1=Urgent, 2=High, 3=Medium, 4=Low)',
                    },
                    parentIssueId: {
                      type: 'string',
                      description:
                        'Optional ID of a parent issue (for sub-issues)',
                    },
                  },
                  required: ['teamId', 'title', 'description'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'addIssueAttachment',
                description: 'Add a URL attachment to an issue in Linear',
                parameters: {
                  type: 'object',
                  properties: {
                    issueId: {
                      type: 'string',
                      description:
                        'The ID of the issue to add the attachment to',
                    },
                    url: {
                      type: 'string',
                      description: 'The URL to attach',
                    },
                    title: {
                      type: 'string',
                      description: 'A title for the attachment',
                    },
                  },
                  required: ['issueId', 'url', 'title'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'updateIssuePriority',
                description: 'Update the priority of an issue in Linear',
                parameters: {
                  type: 'object',
                  properties: {
                    issueId: {
                      type: 'string',
                      description: 'The ID of the issue to update',
                    },
                    priority: {
                      type: 'integer',
                      description:
                        'The priority level (1=Urgent, 2=High, 3=Medium, 4=Low)',
                    },
                  },
                  required: ['issueId', 'priority'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'createPullRequest',
                description: 'Create a pull request for code changes',
                parameters: {
                  type: 'object',
                  properties: {
                    repository: {
                      type: 'string',
                      description: 'Repository in owner/repo format',
                    },
                    title: {
                      type: 'string',
                      description: 'Title for the pull request',
                    },
                    description: {
                      type: 'string',
                      description: 'Description/body for the pull request',
                    },
                    branch: {
                      type: 'string',
                      description: 'Branch name for the changes',
                    },
                    baseBranch: {
                      type: 'string',
                      description:
                        'Base branch to create PR against (usually main)',
                    },
                    changes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          path: {
                            type: 'string',
                            description: 'Path to the file to modify',
                          },
                          content: {
                            type: 'string',
                            description: 'New content for the file',
                          },
                        },
                        required: ['path', 'content'],
                      },
                      description: 'File changes to include in the PR',
                    },
                  },
                  required: [
                    'repository',
                    'title',
                    'description',
                    'branch',
                    'changes',
                  ],
                },
              },
            },
          ],
        });

        // Extract the model's response text
        const responseMessage = response.choices[0].message;
        const responseText = responseMessage.content || '';

        // Check if there's a tool call in the response
        if (
          responseMessage.tool_calls &&
          responseMessage.tool_calls.length > 0
        ) {
          // Add the model's response to conversation history
          messages.push(
            responseMessage as OpenAI.Chat.ChatCompletionMessageParam
          );

          // Increment tool call count
          toolCallCount += responseMessage.tool_calls.length;

          // Process each tool call
          for (const toolCall of responseMessage.tool_calls) {
            if (toolCall.type === 'function') {
              const functionName = toolCall.function.name;
              const functionArgs = JSON.parse(toolCall.function.arguments);
              let toolResponse = '';

              // Execute the function based on its name
              try {
                if (functionName === 'createComment') {
                  await this.linearClient.createComment({
                    issueId: issue.id,
                    body: functionArgs.comment,
                    parentId: functionArgs.parentCommentId,
                  });
                  toolResponse = `Successfully posted comment on issue ${issue.identifier}.`;
                } else if (functionName === 'searchCodeFiles') {
                  const results = await this.localRepoManager.searchCode(
                    functionArgs.query,
                    functionArgs.repository
                  );

                  // Prepare a formatted response with a summary
                  let formattedResults = `Found ${results.length} relevant files for query "${functionArgs.query}" in ${functionArgs.repository}:\n\n`;

                  // Add each file with path and content, limited to avoid token issues
                  const MAX_RESULTS_TO_SHOW = 5;
                  for (
                    let i = 0;
                    i < Math.min(results.length, MAX_RESULTS_TO_SHOW);
                    i++
                  ) {
                    const result = results[i];
                    formattedResults += `File: ${result.path}\nLine ${result.line}: ${result.content}\n\n`;
                  }

                  // Add note if we truncated results
                  if (results.length > MAX_RESULTS_TO_SHOW) {
                    formattedResults += `... and ${
                      results.length - MAX_RESULTS_TO_SHOW
                    } more matches (not shown to conserve space)`;
                  }

                  // Set the tool response
                  toolResponse = formattedResults;
                } else if (functionName === 'getDirectoryStructure') {
                  const directoryStructure =
                    await this.localRepoManager.getDirectoryStructure(
                      functionArgs.repository,
                      functionArgs.path
                    );

                  // Format the directory structure as a string
                  let formattedStructure = `Directory structure for ${
                    functionArgs.path || 'root'
                  } in ${functionArgs.repository}:\n\n`;

                  // Add each file/directory to the response
                  directoryStructure.forEach((item) => {
                    const icon = item.type === 'dir' ? '📁' : '📄';
                    const size = item.size
                      ? ` (${Math.round(item.size / 1024)}KB)`
                      : '';
                    formattedStructure += `${icon} ${item.path}${size}\n`;
                  });

                  toolResponse = formattedStructure;
                } else if (functionName === 'getFileContent') {
                  const content = await this.localRepoManager.getFileContent(
                    functionArgs.path,
                    functionArgs.repository
                  );
                  toolResponse = `Retrieved content for ${
                    functionArgs.path
                  } in ${functionArgs.repository}:
${
  content.length > 5000
    ? content.substring(0, 5000) + '\n... (content truncated due to size)'
    : content
}`;
                } else if (functionName === 'updateIssueStatus') {
                  await this.updateIssueStatus(
                    functionArgs.issueId,
                    functionArgs.status
                  );
                  toolResponse = `Successfully updated status of issue ${functionArgs.issueId} to "${functionArgs.status}".`;
                } else if (functionName === 'addLabel') {
                  await this.addLabel(functionArgs.issueId, functionArgs.label);
                  toolResponse = `Successfully added label "${functionArgs.label}" to issue ${functionArgs.issueId}.`;
                } else if (functionName === 'removeLabel') {
                  await this.removeLabel(
                    functionArgs.issueId,
                    functionArgs.label
                  );
                  toolResponse = `Successfully removed label "${functionArgs.label}" from issue ${functionArgs.issueId}.`;
                } else if (functionName === 'assignIssue') {
                  await this.assignIssue(
                    functionArgs.issueId,
                    functionArgs.assigneeEmail
                  );
                  toolResponse = `Successfully assigned issue ${functionArgs.issueId} to ${functionArgs.assigneeEmail}.`;
                } else if (functionName === 'createIssue') {
                  await this.createIssue(
                    functionArgs.teamId,
                    functionArgs.title,
                    functionArgs.description,
                    functionArgs.status,
                    functionArgs.priority,
                    functionArgs.parentIssueId
                  );
                  toolResponse = `Successfully created new issue "${functionArgs.title}".`;
                } else if (functionName === 'addIssueAttachment') {
                  await this.addIssueAttachment(
                    functionArgs.issueId,
                    functionArgs.url,
                    functionArgs.title
                  );
                  toolResponse = `Successfully added attachment "${functionArgs.title}" to issue ${functionArgs.issueId}.`;
                } else if (functionName === 'updateIssuePriority') {
                  await this.updateIssuePriority(
                    functionArgs.issueId,
                    functionArgs.priority
                  );
                  toolResponse = `Successfully updated priority of issue ${functionArgs.issueId} to ${functionArgs.priority}.`;
                } else if (functionName === 'createPullRequest') {
                  // Create a branch
                  await this.localRepoManager.createBranch(
                    functionArgs.branch,
                    functionArgs.repository,
                    functionArgs.baseBranch || 'main'
                  );

                  // Apply each change
                  for (const change of functionArgs.changes) {
                    await this.localRepoManager.createOrUpdateFile(
                      change.path,
                      change.content,
                      `Update ${change.path} for PR`,
                      functionArgs.repository,
                      functionArgs.branch
                    );
                  }

                  // Create pull request
                  const pullRequest =
                    await this.localRepoManager.createPullRequest(
                      functionArgs.title,
                      functionArgs.description,
                      functionArgs.branch,
                      functionArgs.baseBranch || 'main',
                      functionArgs.repository
                    );

                  toolResponse = `Successfully created pull request: ${pullRequest.url}`;
                } else {
                  toolResponse = `Unknown function: ${functionName}`;
                }
              } catch (error) {
                toolResponse = `Error executing ${functionName}: ${
                  error instanceof Error ? error.message : 'Unknown error'
                }`;
              }

              // Add tool response to conversation
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: toolResponse,
              } as OpenAI.Chat.ChatCompletionToolMessageParam);
            }
          }
        } else {
          // No tool calls, exit the loop
          hasMoreToolCalls = false;

          // If there's a text response, post it as a comment
          if (responseText) {
            await this.linearClient.createComment({
              issueId: issue.id,
              body: responseText,
              parentId: commentId,
            });
          }
        }
      }

      // Check if we hit the tool call limit
      if (toolCallCount >= MAX_TOOL_CALLS) {
        console.warn(
          `Hit maximum tool call limit (${MAX_TOOL_CALLS}) for issue ${issue.identifier}. Stopping execution.`
        );
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `I've reached my maximum number of operations (${MAX_TOOL_CALLS}) for this request. I'll need to stop here. Please create a new request if you need me to continue working on this issue.`,
          parentId: commentId,
        });
      }
    } catch (error: unknown) {
      console.error(`Error in LinearGPT processing:`, error);
      throw error;
    }
  }

  /**
   * Update the status of a Linear issue
   */
  private async updateIssueStatus(
    issueIdOrIdentifier: string,
    statusName: string
  ): Promise<void> {
    try {
      // Get all workflow states for the issue's team
      const issue = await this.linearClient.issue(issueIdOrIdentifier);
      if (!issue) {
        console.error(`Issue ${issueIdOrIdentifier} not found`);
        return;
      }

      const team = await issue.team;
      if (!team) {
        console.error(`Team not found for issue ${issueIdOrIdentifier}`);
        return;
      }

      const states = await this.linearClient.workflowStates({
        filter: {
          team: {
            id: { eq: team.id },
          },
        },
      });

      // Find the state with the matching name
      const state = states.nodes.find(
        (s) => s.name.toLowerCase() === statusName.toLowerCase()
      );

      if (!state) {
        console.error(
          `Status "${statusName}" not found for team ${
            team.name
          }. Available states: ${states.nodes.map((s) => s.name).join(', ')}`
        );
        return;
      }

      // Update the issue with the new state
      await issue.update({ stateId: state.id });

      console.log(
        `Updated issue ${issueIdOrIdentifier} status to ${statusName}`
      );
    } catch (error: unknown) {
      console.error(
        `Error updating status for issue ${issueIdOrIdentifier}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Add a label to a Linear issue
   */
  private async addLabel(issueId: string, labelName: string): Promise<void> {
    try {
      // Find the label by name
      const labelsResponse = await this.linearClient.issueLabels();
      const label = labelsResponse.nodes.find((l: any) => l.name === labelName);

      if (!label) {
        console.error(`Label "${labelName}" not found`);
        return;
      }

      // Add the label to the issue
      await this.linearClient.issueAddLabel(issueId, label.id);
      console.log(`Added label "${labelName}" to issue ${issueId}`);
    } catch (error: unknown) {
      console.error(
        `Error adding label "${labelName}" to issue ${issueId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Remove a label from a Linear issue
   */
  private async removeLabel(issueId: string, labelName: string): Promise<void> {
    try {
      // Fetch the issue
      const issue = await this.linearClient.issue(issueId);

      // Get current labels for the issue
      const issueLabelsResponse = await issue.labels();

      // Find the label that matches the requested label name
      const label = issueLabelsResponse.nodes.find(
        (label) => label.name.toLowerCase() === labelName.toLowerCase()
      );

      if (!label) {
        console.log(
          `Label "${labelName}" not found on issue ${issue.identifier}`
        );
        return;
      }

      // Remove the label from the issue
      const currentLabels = issue.labelIds || [];
      const updatedLabels = currentLabels.filter((id) => id !== label.id);
      await issue.update({
        labelIds: updatedLabels,
      });

      console.log(
        `Removed label "${labelName}" from issue ${issue.identifier}`
      );

      // Notify in the issue comments
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I've removed the label **${labelName}**.`,
      });
    } catch (error) {
      console.error(`Error removing label:`, error);
      throw error;
    }
  }

  /**
   * Assign a Linear issue to a team member
   */
  private async assignIssue(
    issueId: string,
    assigneeEmail: string
  ): Promise<void> {
    try {
      // Fetch the issue
      const issue = await this.linearClient.issue(issueId);

      // Get the issue's team
      const team = await issue.team;
      if (!team) {
        throw new Error('Could not determine the team for this issue');
      }

      // Get team members
      const teamMembersResponse = await team.members();

      // Find the team member that matches the requested email
      let foundMember = null;
      let foundUserName = assigneeEmail;

      // Get all users in the organization
      const usersResponse = await this.linearClient.users();
      const users = usersResponse.nodes;

      // Find the user by email
      const targetUser = users.find((user) => user.email === assigneeEmail);

      if (targetUser) {
        // Find the team membership for this user
        foundMember = teamMembersResponse.nodes.find(
          (member) => member.id === targetUser.id
        );
        foundUserName = targetUser.name || assigneeEmail;
      }

      if (!foundMember) {
        throw new Error(
          `Could not find team member with email "${assigneeEmail}"`
        );
      }

      // Update the issue with the new assignee
      await issue.update({
        assigneeId: foundMember.id,
      });

      console.log(`Assigned issue ${issue.identifier} to ${foundUserName}`);

      // Notify in the issue comments
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I've assigned this issue to **${foundUserName}**.`,
      });
    } catch (error) {
      console.error(`Error assigning issue:`, error);
      throw error;
    }
  }

  /**
   * Create a new Linear issue
   */
  private async createIssue(
    teamId: string,
    title: string,
    description: string,
    status?: string,
    priority?: number,
    parentIssueId?: string
  ): Promise<void> {
    try {
      // Get the team
      const team = await this.linearClient.team(teamId);

      // Prepare creation parameters
      const createParams: {
        title: string;
        description: string;
        priority?: number;
        parentId?: string;
      } = {
        title,
        description,
      };

      // Add priority if specified
      if (priority !== undefined) {
        createParams.priority = priority;
      }

      // Add parent issue if specified
      if (parentIssueId) {
        createParams.parentId = parentIssueId;
      }

      // Create the issue
      const issueCreateInput = {
        ...createParams,
        teamId: team.id,
      };

      // Use the Linear SDK to create the issue
      const issueResponse = await this.linearClient.createIssue(
        issueCreateInput
      );

      // Check if issue was created successfully
      if (issueResponse && issueResponse.issue) {
        // Get the actual issue object
        const newIssueObj = await issueResponse.issue;
        console.log(`Created new issue ${newIssueObj.identifier}: ${title}`);

        // Update state if specified
        if (status) {
          // Find all workflow states for the team
          const statesResponse = await this.linearClient.workflowStates({
            filter: { team: { id: { eq: team.id } } },
          });

          // Find the state that matches the requested status name
          const state = statesResponse.nodes.find(
            (state) => state.name.toLowerCase() === status.toLowerCase()
          );

          if (state) {
            await newIssueObj.update({
              stateId: state.id,
            });

            console.log(
              `Set new issue ${newIssueObj.identifier} status to "${status}"`
            );
          }
        }

        // If this was created from another issue, add a comment linking back
        if (parentIssueId) {
          const parentIssue = await this.linearClient.issue(parentIssueId);

          await this.linearClient.createComment({
            issueId: parentIssue.id,
            body: `I've created a subtask: ${newIssueObj.identifier} - ${title}`,
          });
        }
      } else {
        console.log(`Failed to create issue "${title}"`);
      }
    } catch (error) {
      console.error(`Error creating issue:`, error);
      throw error;
    }
  }

  /**
   * Add a URL attachment to a Linear issue
   */
  private async addIssueAttachment(
    issueId: string,
    url: string,
    title: string
  ): Promise<void> {
    try {
      // Fetch the issue to ensure it exists
      const issue = await this.linearClient.issue(issueId);

      // Create the attachment
      const response = await this.linearClient.createAttachment({
        issueId: issue.id,
        url,
        title,
      });

      console.log(`Added attachment "${title}" to issue ${issue.identifier}`);

      // Notify in the issue comments
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I've attached [${title}](${url}).`,
      });
    } catch (error) {
      console.error(`Error adding attachment:`, error);
      throw error;
    }
  }

  /**
   * Get the context for an issue including comments
   */
  private async getIssueContext(
    issue: Issue,
    commentId?: string
  ): Promise<string> {
    let context = `ISSUE ${issue.identifier}: ${issue.title}\n`;
    context += `DESCRIPTION: ${
      issue.description || 'No description provided'
    }\n\n`;

    // Add comments
    const comments = await issue.comments({ first: 10 });
    if (comments.nodes.length > 0) {
      context += 'RECENT COMMENTS:\n';

      for (const comment of comments.nodes) {
        // If this is the triggering comment, highlight it
        const isTriggering = commentId && comment.id === commentId;
        const prefix = isTriggering ? '► ' : '';

        // Add user info if available
        let userName = 'Unknown';
        if (comment.user) {
          try {
            const user = await comment.user;
            userName = user ? user.name || 'Unknown' : 'Unknown';
          } catch (e) {
            console.error('Error getting user name:', e);
          }
        }

        context += `${prefix}${userName}: ${comment.body}\n\n`;
      }
    }

    // Add labels if any
    const labels = await issue.labels();
    if (labels.nodes.length > 0) {
      const labelNames = labels.nodes.map((l) => l.name).join(', ');
      context += `LABELS: ${labelNames}\n`;
    }

    return context;
  }

  /**
   * Update the priority of a Linear issue
   */
  private async updateIssuePriority(
    issueIdOrIdentifier: string,
    priority: number
  ): Promise<void> {
    try {
      // Get the issue
      const issue = await this.linearClient.issue(issueIdOrIdentifier);
      if (!issue) {
        console.error(`Issue ${issueIdOrIdentifier} not found`);
        return;
      }

      // Update the issue with the new priority
      await issue.update({ priority });

      console.log(
        `Updated issue ${issueIdOrIdentifier} priority to ${priority}`
      );
    } catch (error: unknown) {
      console.error(
        `Error updating priority for issue ${issueIdOrIdentifier}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
