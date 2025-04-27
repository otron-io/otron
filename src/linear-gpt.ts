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
    } else {
      // If no specific repositories are defined, use the repo from env
      this.allowedRepositories = [`${env.REPO_OWNER}/${env.REPO_NAME}`];
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

      while (hasMoreToolCalls) {
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
      // 1. Identify relevant code files
      const relevantFiles = await this.searchRelevantFiles(issue);

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
      // 1. Identify relevant code files
      const relevantFiles = await this.searchRelevantFiles(issue);

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
        } else {
          // Generate a new technical report
          technicalReport =
            await this.technicalAnalysis.generateTechnicalReport(
              issue,
              relevantFiles
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
  ): Promise<Array<{ path: string; content: string }>> {
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

    const relevantFiles: Array<{ path: string; content: string }> = [];
    const keywordList = keywords.split(',').map((k: string) => k.trim());

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
   * Generate code changes based on technical analysis
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
      repository: string;
    }>
  > {
    try {
      // Add repository info to each file path - require the model to determine which repository
      const filesWithRepoInfo = codeFiles.map((file) => {
        return {
          path: file.path,
          content: file.content,
          // No default repository is set here
        };
      });

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
            }),
          },
          {
            role: 'user',
            content:
              'Please generate code changes based on the technical report and plan.',
          },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      });

      const implementationJson =
        implementationResponse.choices[0].message.content || '';

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
              change.message.length > 0 &&
              typeof change.repository === 'string' &&
              change.repository.length > 0;

            if (!isValid) {
              console.warn(
                `Skipping invalid change for path: ${
                  change.path || 'unknown'
                } - repository must be specified`
              );
            }

            return isValid;
          })
          .map((change) => {
            // Sanitize the path to ensure it doesn't start with a slash
            // Ensure repository is always defined
            return {
              path: this.sanitizePath(change.path),
              content: change.content,
              message: change.message,
              repository: change.repository as string, // Force it to be a string since we filtered out undefined
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
}
