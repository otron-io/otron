import { Issue, LinearClient } from '@linear/sdk';
import { Octokit } from '@octokit/rest';
import OpenAI from 'openai';
import { env } from './env.js';
import { PRManager } from './pr-manager.js';
import { TechnicalAnalysisService } from './technical-analysis.js';
import {
  buildLinearGptSystemPrompt,
  getAvailableToolsDescription,
  buildKeywordExtractionPrompt,
  buildCodeImplementationPrompt,
} from './prompts.js';
import { z } from 'zod';

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
  private octokit: Octokit;
  private prManager: PRManager;
  private technicalAnalysis: TechnicalAnalysisService;
  private allowedRepositories: string[] = [];

  constructor(private linearClient: LinearClient) {
    this.octokit = new Octokit({
      auth: env.GITHUB_TOKEN,
    });

    this.prManager = new PRManager(linearClient);
    this.technicalAnalysis = new TechnicalAnalysisService(linearClient);

    // Parse allowed repositories from env variable
    if (env.ALLOWED_REPOSITORIES) {
      this.allowedRepositories = env.ALLOWED_REPOSITORIES.split(',').map((r) =>
        r.trim()
      );
    }
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
            'Please analyze this issue and determine the best action to take.',
        },
      ];

      // Tool use loop - continue until model stops making tool calls
      let hasMoreToolCalls = true;
      let toolCallCount = 0;
      const MAX_TOOL_CALLS = 10; // Maximum number of tool calls to prevent infinite loops

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
                name: 'performTechnicalAnalysis',
                description:
                  'Perform a technical analysis of the issue to understand the root cause and potential solutions',
                parameters: {
                  type: 'object',
                  properties: {
                    issueId: {
                      type: 'string',
                      description: 'The ID of the issue to analyze',
                    },
                  },
                  required: ['issueId'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'implementChanges',
                description:
                  'Implement code changes based on technical analysis and create pull requests',
                parameters: {
                  type: 'object',
                  properties: {
                    issueId: {
                      type: 'string',
                      description:
                        'The ID of the issue to implement changes for',
                    },
                    repositories: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                      description:
                        'List of repositories to implement changes in (owner/repo format)',
                    },
                  },
                  required: ['issueId'],
                },
              },
            },
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
                name: 'searchRelevantFiles',
                description:
                  'Search for relevant code files related to an issue',
                parameters: {
                  type: 'object',
                  properties: {
                    issueId: {
                      type: 'string',
                      description:
                        'The ID of the issue to find relevant files for',
                    },
                    repository: {
                      type: 'string',
                      description:
                        'The repository to search in (owner/repo format)',
                    },
                    keywords: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                      description: 'Optional list of keywords to search for',
                    },
                  },
                  required: ['issueId', 'repository'],
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
                if (functionName === 'performTechnicalAnalysis') {
                  await this.performTechnicalAnalysis(issue);
                  toolResponse = `Successfully performed technical analysis for issue ${issue.identifier}.`;
                } else if (functionName === 'implementChanges') {
                  await this.implementChanges(issue);
                  toolResponse = `Successfully implemented changes for issue ${issue.identifier}.`;
                } else if (functionName === 'createComment') {
                  await this.linearClient.createComment({
                    issueId: issue.id,
                    body: functionArgs.comment,
                    parentId: functionArgs.parentCommentId,
                  });
                  toolResponse = `Successfully posted comment on issue ${issue.identifier}.`;
                } else if (functionName === 'searchRelevantFiles') {
                  const result = await this.searchRelevantFiles(issue);
                  toolResponse = `Found ${result.length} relevant files for issue ${issue.identifier}.`;
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
    issueId: string,
    statusName: string
  ): Promise<void> {
    try {
      // Fetch the issue
      const issue = await this.linearClient.issue(issueId);

      // Get the issue's team
      const team = await issue.team;
      if (!team) {
        throw new Error('Could not determine the team for this issue');
      }

      // Find all workflow states for the team
      const statesResponse = await this.linearClient.workflowStates({
        filter: { team: { id: { eq: team.id } } },
      });

      // Find the state that matches the requested status name
      const state = statesResponse.nodes.find(
        (state) => state.name.toLowerCase() === statusName.toLowerCase()
      );

      if (!state) {
        throw new Error(
          `Could not find status "${statusName}" for team ${team.name}`
        );
      }

      // Update the issue with the new state
      await issue.update({
        stateId: state.id,
      });

      console.log(
        `Updated issue ${issue.identifier} status to "${statusName}"`
      );

      // Notify in the issue comments
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I've updated the status to **${statusName}**.`,
      });
    } catch (error) {
      console.error(`Error updating issue status:`, error);
      throw error;
    }
  }

  /**
   * Add a label to a Linear issue
   */
  private async addLabel(issueId: string, labelName: string): Promise<void> {
    try {
      // Fetch the issue
      const issue = await this.linearClient.issue(issueId);

      // Get the issue's team
      const team = await issue.team;
      if (!team) {
        throw new Error('Could not determine the team for this issue');
      }

      // Find all labels for the team
      const labelsResponse = await this.linearClient.issueLabels({
        filter: { team: { id: { eq: team.id } } },
      });

      // Find the label that matches the requested label name
      const label = labelsResponse.nodes.find(
        (label) => label.name.toLowerCase() === labelName.toLowerCase()
      );

      if (!label) {
        // Create the label if it doesn't exist
        const createdLabelResponse = await this.linearClient.createIssueLabel({
          name: labelName,
          teamId: team.id,
        });

        // Add the new label to the issue if created successfully
        if (createdLabelResponse && createdLabelResponse.issueLabel) {
          const issueLabelsResponse = await issue.labels();
          const currentLabels = issueLabelsResponse.nodes.map(
            (label) => label.id
          );
          // Get the actual issue label object
          const createdLabel = await createdLabelResponse.issueLabel;
          await issue.update({
            labelIds: [...currentLabels, createdLabel.id],
          });

          console.log(
            `Created and added new label "${labelName}" to issue ${issue.identifier}`
          );
        } else {
          console.log(`Failed to create label "${labelName}"`);
        }

        // Notify in the issue comments
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `I've added the label **${labelName}**.`,
        });
      } else {
        // Add the existing label to the issue
        const currentLabels = issue.labelIds || [];
        await issue.update({
          labelIds: [...currentLabels, label.id],
        });

        console.log(`Added label "${labelName}" to issue ${issue.identifier}`);
      }
    } catch (error) {
      console.error(`Error adding label:`, error);
      throw error;
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
            userName = user?.name || 'Unknown';
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
   * Perform a technical analysis of the issue
   */
  private async performTechnicalAnalysis(issue: Issue): Promise<void> {
    try {
      // 1. Identify relevant code files with repository information
      const relevantFiles = await this.searchRelevantFiles(issue);

      // Log repository distribution for debugging
      const repoDistribution = new Map<string, number>();
      for (const file of relevantFiles) {
        repoDistribution.set(
          file.repository,
          (repoDistribution.get(file.repository) || 0) + 1
        );
      }

      console.log('File distribution for technical analysis:');
      for (const [repo, count] of repoDistribution.entries()) {
        console.log(`${repo}: ${count} files`);
      }

      // 2. Generate technical analysis
      const technicalReport =
        await this.technicalAnalysis.generateTechnicalReport(
          issue,
          relevantFiles
        );

      // 3. Post technical report as a comment
      await this.technicalAnalysis.postReportToIssue(issue, technicalReport);

      // 4. Plan code changes
      await this.technicalAnalysis.planCodeChanges(
        issue,
        technicalReport,
        relevantFiles
      );
    } catch (error: unknown) {
      console.error(`Error performing technical analysis:`, error);
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I encountered an error while performing the technical analysis: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      });
    }
  }

  /**
   * Implement changes for an issue
   */
  private async implementChanges(issue: Issue): Promise<void> {
    try {
      // 1. Identify relevant code files, now with repository info
      const relevantFiles = await this.searchRelevantFiles(issue);

      // Log repository distribution for debugging
      const repoDistribution = new Map<string, number>();
      for (const file of relevantFiles) {
        repoDistribution.set(
          file.repository,
          (repoDistribution.get(file.repository) || 0) + 1
        );
      }

      console.log('Input file distribution across repositories:');
      for (const [repo, count] of repoDistribution.entries()) {
        console.log(`${repo}: ${count} files`);
      }

      // 2. Generate technical analysis if not already done
      let technicalReport: string;
      try {
        // Try to find an existing technical report in the comments
        const comments = await issue.comments({ first: 10 });
        const technicalReportComment = comments.nodes.find(
          (c) =>
            c.body.includes('Technical Root Cause Analysis') ||
            c.body.includes('Implementation Plan')
        );

        if (technicalReportComment) {
          technicalReport = technicalReportComment.body;
          console.log(
            `Using existing technical report for ${issue.identifier}`
          );
        } else {
          // Generate a new technical report
          technicalReport =
            await this.technicalAnalysis.generateTechnicalReport(
              issue,
              relevantFiles
            );

          // Log the technical report for debugging
          console.log(
            `Generated new technical report for ${issue.identifier}. ` +
              `Report identifies repositories: ${this.extractRepositoriesFromReport(
                technicalReport
              )}`
          );

          // Post the report
          await this.technicalAnalysis.postReportToIssue(
            issue,
            technicalReport
          );
        }
      } catch (error: unknown) {
        console.error(`Error getting/generating technical report:`, error);

        // Generate a new one if there was an error
        technicalReport = await this.technicalAnalysis.generateTechnicalReport(
          issue,
          relevantFiles
        );

        // Post the report
        await this.technicalAnalysis.postReportToIssue(issue, technicalReport);
      }

      // 3. Plan code changes
      const { branchName, changePlan } =
        await this.technicalAnalysis.planCodeChanges(
          issue,
          technicalReport,
          relevantFiles
        );

      // 4. Generate code changes
      const codeChanges = await this.generateCodeChanges(
        issue,
        relevantFiles,
        technicalReport,
        changePlan
      );

      // 5. Create PRs with changes
      const prs = await this.prManager.implementAndCreatePRs(
        issue,
        branchName,
        codeChanges,
        `Implements solution for ${issue.identifier}\n\n${technicalReport}`
      );

      if (prs.length === 0) {
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `I tried to implement changes but couldn't create any PRs. This might be because no valid code changes could be generated.`,
        });
      }
    } catch (error: unknown) {
      console.error(`Error implementing changes:`, error);
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I encountered an error while implementing changes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      });
    }
  }

  /**
   * Search for relevant code files based on issue content
   */
  private async searchRelevantFiles(
    issue: Issue
  ): Promise<Array<{ path: string; content: string; repository: string }>> {
    // Extract keywords from the issue
    const keywordsResponse = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'user',
          content: buildKeywordExtractionPrompt(issue),
        },
      ],
      temperature: 0.1,
      max_tokens: 100,
    });

    const keywords = keywordsResponse.choices[0].message.content || '';
    console.log(`Identified keywords for search: ${keywords}`);

    // Initialize the array for all relevant files
    const relevantFiles: Array<{
      path: string;
      content: string;
      repository: string;
    }> = [];
    const keywordList = keywords.split(',').map((k: string) => k.trim());

    // Track files per repository to ensure balanced representation
    const filesPerRepo = new Map<string, number>();
    const MAX_FILES_PER_REPO = 3; // Set a maximum per repository
    const TOTAL_MAX_FILES = 12; // Set a higher overall maximum to allow for multiple repos

    // Initialize the counter for each repository
    for (const repo of this.allowedRepositories) {
      filesPerRepo.set(repo, 0);
    }

    // First round: try to get at least one file from each repository
    for (const keyword of keywordList) {
      if (!keyword) continue;

      // Try each repository for this keyword
      for (const repoFullName of this.allowedRepositories) {
        // Skip if this repo already has its minimum representation
        if ((filesPerRepo.get(repoFullName) || 0) >= 1) continue;

        try {
          const files = await this.searchFilesInRepo(keyword, repoFullName, 2);

          for (const file of files) {
            relevantFiles.push({
              ...file,
              repository: repoFullName, // Add repository information to each file
            });

            // Update the counter for this repository
            filesPerRepo.set(
              repoFullName,
              (filesPerRepo.get(repoFullName) || 0) + 1
            );

            // Stop if we've reached the maximum for this repository
            if ((filesPerRepo.get(repoFullName) || 0) >= 1) break;
          }
        } catch (error) {
          console.error(
            `Error searching for keyword "${keyword}" in ${repoFullName}:`,
            error
          );
        }
      }
    }

    // Second round: fill up to the per-repository maximum
    for (const keyword of keywordList) {
      if (!keyword) continue;

      // Stop if we've reached the overall maximum
      if (relevantFiles.length >= TOTAL_MAX_FILES) break;

      for (const repoFullName of this.allowedRepositories) {
        // Skip if this repo already has its maximum
        if ((filesPerRepo.get(repoFullName) || 0) >= MAX_FILES_PER_REPO)
          continue;

        // Calculate how many more files we need from this repo
        const neededFiles =
          MAX_FILES_PER_REPO - (filesPerRepo.get(repoFullName) || 0);

        try {
          const files = await this.searchFilesInRepo(
            keyword,
            repoFullName,
            neededFiles
          );

          for (const file of files) {
            // Skip if we already have this file path
            if (
              relevantFiles.some(
                (f) => f.path === file.path && f.repository === repoFullName
              )
            )
              continue;

            relevantFiles.push({
              ...file,
              repository: repoFullName, // Add repository information to each file
            });

            // Update the counter for this repository
            filesPerRepo.set(
              repoFullName,
              (filesPerRepo.get(repoFullName) || 0) + 1
            );

            // Stop if we've reached the maximum for this repository
            if ((filesPerRepo.get(repoFullName) || 0) >= MAX_FILES_PER_REPO)
              break;

            // Stop if we've reached the overall maximum
            if (relevantFiles.length >= TOTAL_MAX_FILES) break;
          }

          // Break out of the repository loop if we've reached the overall maximum
          if (relevantFiles.length >= TOTAL_MAX_FILES) break;
        } catch (error) {
          console.error(
            `Error searching for keyword "${keyword}" in ${repoFullName}:`,
            error
          );
        }
      }
    }

    // Log the distribution of files
    console.log('File distribution across repositories:');
    for (const [repo, count] of filesPerRepo.entries()) {
      console.log(`${repo}: ${count} files`);
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
          repository: this.allowedRepositories[0], // Use the first repository as a fallback
        },
      ];
    }

    return relevantFiles;
  }

  /**
   * Search for files in a specific repository
   */
  private async searchFilesInRepo(
    keyword: string,
    repoFullName: string,
    limit: number
  ): Promise<Array<{ path: string; content: string }>> {
    const [owner, repo] = repoFullName.split('/');
    const results: Array<{ path: string; content: string }> = [];

    try {
      // Search for the keyword in code
      const searchResults = await this.octokit.search.code({
        q: `${keyword} in:file repo:${owner}/${repo}`,
        per_page: limit,
      });

      // For each result, get the file content
      for (const item of searchResults.data.items) {
        // Sanitize the path
        const sanitizedPath = this.sanitizePath(item.path);

        try {
          // Get file content
          const content = await this.prManager.getFileContent(
            sanitizedPath,
            repoFullName
          );

          results.push({
            path: sanitizedPath,
            content,
          });

          // Stop if we have enough files
          if (results.length >= limit) {
            break;
          }
        } catch (error) {
          console.error(`Error fetching content for ${sanitizedPath}:`, error);
        }
      }
    } catch (error) {
      console.error(
        `Error searching for keyword "${keyword}" in ${repoFullName}:`,
        error
      );
    }

    return results;
  }

  /**
   * Generate code changes based on technical analysis
   */
  private async generateCodeChanges(
    issue: Issue,
    codeFiles: Array<{ path: string; content: string; repository: string }>,
    technicalReport: string,
    changePlan: string
  ): Promise<
    Array<{
      path: string;
      content: string;
      message: string;
      repository: string;
    }>
  > {
    try {
      // Use the repository information we've already captured
      const filesWithRepoInfo = codeFiles.map((file) => {
        return {
          path: file.path,
          content: file.content,
          repository: file.repository, // Include the repository information
        };
      });

      // Add repository distribution info to the prompt
      const repoDistribution = new Map<string, number>();
      for (const file of filesWithRepoInfo) {
        repoDistribution.set(
          file.repository,
          (repoDistribution.get(file.repository) || 0) + 1
        );
      }

      const repoContext = Array.from(repoDistribution.entries())
        .map(([repo, count]) => `- ${repo}: ${count} files`)
        .join('\n');

      // Generate concrete code changes based on the technical report and plan
      const implementationResponse = await openai.chat.completions.create({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'system',
            content: buildCodeImplementationPrompt({
              issue,
              technicalReport,
              changePlan,
              filesWithRepoInfo,
              allowedRepositories: this.allowedRepositories,
              repoDistribution: repoContext, // Pass this to the prompt builder
            }),
          },
          {
            role: 'user',
            content:
              'Please generate code changes based on the technical report and plan. Be sure to carefully consider which repository each change belongs to.',
          },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      });

      const responseContent =
        implementationResponse.choices[0].message.content || '';

      // Process the diff-based response format
      try {
        console.log(
          `Processing implementation response of length ${responseContent.length}`
        );

        // Parse the diff-based format
        const changes = this.parseDiffResponse(responseContent, codeFiles);

        if (changes.length === 0) {
          throw new Error('No valid code changes were found in the response');
        }

        // Log repository distribution of changes
        const changeRepoDistribution = new Map<string, number>();
        for (const change of changes) {
          changeRepoDistribution.set(
            change.repository,
            (changeRepoDistribution.get(change.repository) || 0) + 1
          );
        }

        console.log('Change distribution across repositories:');
        for (const [repo, count] of changeRepoDistribution.entries()) {
          console.log(`${repo}: ${count} changes`);
        }

        console.log(`Successfully parsed ${changes.length} code changes`);
        return changes;
      } catch (parseError: unknown) {
        console.error('Failed to process implementation response:', parseError);

        // If we couldn't parse the response, notify in Linear and throw error
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `I generated a technical analysis but encountered an error when implementing the code changes. Please review the technical report and implement manually.`,
        });

        const errorMessage =
          parseError instanceof Error
            ? parseError.message
            : 'Unknown parsing error';

        throw new Error(
          `Could not process implementation changes: ${errorMessage}`
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

  /**
   * Parse the diff-based response format into code changes
   */
  private parseDiffResponse(
    response: string,
    originalFiles: Array<{ path: string; content: string; repository?: string }>
  ): Array<{
    path: string;
    content: string;
    message: string;
    repository: string;
  }> {
    // Split the response into change blocks
    const changeBlocks = response
      .split(/^#{2}\s+CHANGE\s+\d+/gm)
      .filter((block) => block.trim().length > 0);

    if (changeBlocks.length === 0) {
      console.log('No change blocks found in response');
      return [];
    }

    console.log(`Found ${changeBlocks.length} change blocks to process`);

    const changes: Array<{
      path: string;
      content: string;
      message: string;
      repository: string;
    }> = [];

    for (const block of changeBlocks) {
      try {
        // Extract repository, file path and description
        const repoMatch = block.match(/Repository:\s+([^\n]+)/);
        const fileMatch = block.match(/File:\s+([^\n]+)/);
        const descMatch = block.match(/Description:\s+([^\n]+)/);

        if (!repoMatch || !fileMatch) {
          console.warn('Skipping block without repository or file path');
          continue;
        }

        const repository = repoMatch[1].trim();
        const filePath = this.sanitizePath(fileMatch[1].trim());
        const message = descMatch ? descMatch[1].trim() : `Update ${filePath}`;

        // Extract the diff content
        const diffMatch = block.match(/```diff\n([\s\S]*?)```/);

        if (!diffMatch) {
          console.warn(`No diff content found for ${filePath}`);
          continue;
        }

        const diffContent = diffMatch[1];

        // Find the original file content, respecting repository context
        // First try to find an exact match by path and repository
        let originalFile = originalFiles.find(
          (f) => f.path === filePath && f.repository === repository
        );

        // If not found, fall back to just matching by path
        if (!originalFile) {
          originalFile = originalFiles.find((f) => f.path === filePath);
        }

        const originalContent = originalFile ? originalFile.content : '';

        // Apply the diff to get the new content
        const newContent = this.applyDiff(originalContent, diffContent);

        // Validate if the repository exists in the allowed list
        if (!this.allowedRepositories.includes(repository)) {
          console.warn(
            `Specified repository "${repository}" is not in the allowed list. Checking for similar repositories...`
          );

          // Try to find a similar repository name (handle typos, etc)
          const similarRepo = this.allowedRepositories.find(
            (r) =>
              r
                .toLowerCase()
                .includes(repository.toLowerCase().split('/')[1]) ||
              repository.toLowerCase().includes(r.toLowerCase().split('/')[1])
          );

          if (similarRepo) {
            console.log(
              `Using similar repository "${similarRepo}" instead of "${repository}"`
            );
            changes.push({
              path: filePath,
              content: newContent,
              message,
              repository: similarRepo,
            });
          } else {
            console.warn(
              `Skipping change for invalid repository: ${repository}`
            );
          }
          continue;
        }

        changes.push({
          path: filePath,
          content: newContent,
          message,
          repository,
        });
      } catch (error) {
        console.error('Error processing change block:', error);
        // Continue with other blocks
      }
    }

    return changes;
  }

  /**
   * Apply a diff to original content to get the new content
   */
  private applyDiff(originalContent: string, diffContent: string): string {
    // Split content into lines
    const lines = originalContent.split('\n');

    // Process each line of the diff
    const diffLines = diffContent.split('\n');
    let lineIndex = 0;
    const newLines: string[] = [];

    // A simple tracking system to find context matches
    let contextLines: string[] = [];
    let addedLines: string[] = [];
    let removedLines: string[] = [];
    let processingChange = false;

    for (const line of diffLines) {
      // Skip comment lines in the diff
      if (line.trim().startsWith('//') || line.trim() === '') {
        continue;
      }

      if (line.startsWith('+') && !line.startsWith('++')) {
        // Added line
        addedLines.push(line.substring(1));
        processingChange = true;
      } else if (line.startsWith('-') && !line.startsWith('--')) {
        // Removed line
        removedLines.push(line.substring(1));
        processingChange = true;
      } else if (!line.startsWith('+') && !line.startsWith('-')) {
        // Context line

        // If we were processing a change and now hit context, apply the change
        if (processingChange) {
          // Find matching context in the original file
          const contextMatch = this.findContextMatch(
            lines,
            contextLines,
            lineIndex
          );

          if (contextMatch >= 0) {
            // Apply the change at the matched position
            lineIndex = contextMatch;

            // Remove the specified lines
            if (removedLines.length > 0) {
              lines.splice(lineIndex, removedLines.length);
            }

            // Add the new lines
            if (addedLines.length > 0) {
              lines.splice(lineIndex, 0, ...addedLines);
              lineIndex += addedLines.length;
            }

            // Reset for next change
            contextLines = [];
            addedLines = [];
            removedLines = [];
          }

          processingChange = false;
        }

        // Store context line for matching
        contextLines.push(line.trim());
      }
    }

    // Apply any final change
    if (processingChange && contextLines.length > 0) {
      const contextMatch = this.findContextMatch(
        lines,
        contextLines,
        lineIndex
      );

      if (contextMatch >= 0) {
        lineIndex = contextMatch;

        // Remove the specified lines
        if (removedLines.length > 0) {
          lines.splice(lineIndex, removedLines.length);
        }

        // Add the new lines
        if (addedLines.length > 0) {
          lines.splice(lineIndex, 0, ...addedLines);
        }
      }
    }

    // Handle special case: entirely new file
    if (originalContent === '' && addedLines.length > 0) {
      return addedLines.join('\n');
    }

    return lines.join('\n');
  }

  /**
   * Find the position in the file where the context matches
   */
  private findContextMatch(
    fileLines: string[],
    contextLines: string[],
    startIndex: number
  ): number {
    // If no context lines, return current position
    if (contextLines.length === 0) {
      return startIndex;
    }

    // Try to find the context starting from the current position
    for (let i = startIndex; i < fileLines.length; i++) {
      let matched = true;

      for (let j = 0; j < contextLines.length; j++) {
        if (
          i + j >= fileLines.length ||
          fileLines[i + j].trim() !== contextLines[j]
        ) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return i;
      }
    }

    // If not found from current position, search from the beginning
    if (startIndex > 0) {
      for (let i = 0; i < startIndex; i++) {
        let matched = true;

        for (let j = 0; j < contextLines.length; j++) {
          if (
            i + j >= fileLines.length ||
            fileLines[i + j].trim() !== contextLines[j]
          ) {
            matched = false;
            break;
          }
        }

        if (matched) {
          return i;
        }
      }
    }

    // Not found, return -1
    return -1;
  }

  /**
   * Sanitizes a file path to ensure it's correctly formatted
   */
  private sanitizePath(path: string): string {
    // Remove leading slashes
    return path.replace(/^\/+/, '');
  }

  /**
   * Update the priority of a Linear issue
   */
  private async updateIssuePriority(
    issueId: string,
    priority: number
  ): Promise<void> {
    try {
      // Validate priority value (Linear uses 1-4)
      if (priority < 1 || priority > 4) {
        throw new Error('Priority must be between 1 and 4');
      }

      // Fetch the issue
      const issue = await this.linearClient.issue(issueId);

      // Update the issue with the new priority
      await issue.update({
        priority,
      });

      // Map priority number to text for better readability
      const priorityText = {
        1: 'Urgent',
        2: 'High',
        3: 'Medium',
        4: 'Low',
      }[priority];

      console.log(
        `Updated issue ${issue.identifier} priority to "${priorityText}" (${priority})`
      );

      // Notify in the issue comments
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I've updated the priority to **${priorityText}**.`,
      });
    } catch (error) {
      console.error(`Error updating issue priority:`, error);
      throw error;
    }
  }

  /**
   * Extract repository mentions from a technical report
   * This helps debug which repositories are being identified during analysis
   */
  private extractRepositoriesFromReport(report: string): string {
    const repoMentions: Set<string> = new Set();

    // Match patterns like "repository: owner/repo" or "in the owner/repo repository"
    const repoPatterns = [
      /(?:repository|repo):\s*([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/gi,
      /in\s+the\s+([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)\s+(?:repository|repo)/gi,
      /([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)\s+(?:repository|repo)/gi,
      /file\s+in\s+([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/gi,
    ];

    for (const pattern of repoPatterns) {
      let match;
      while ((match = pattern.exec(report)) !== null) {
        repoMentions.add(match[1]);
      }
    }

    return Array.from(repoMentions).join(', ') || 'none explicitly mentioned';
  }
}
