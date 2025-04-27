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
import path from 'path';
import { GitHubAppService } from './github-app.js';

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
  private githubAppService: GitHubAppService | null = null;

  constructor(private linearClient: LinearClient) {
    // Set up GitHub client
    if (env.GITHUB_TOKEN) {
      // Legacy mode: use PAT
      this.octokit = new Octokit({
        auth: env.GITHUB_TOKEN,
      });
    } else if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
      // GitHub App mode: initialize the service
      this.githubAppService = GitHubAppService.getInstance();
      // Initialize with a temporary Octokit that will be replaced per-repo
      this.octokit = new Octokit();
    } else {
      throw new Error(
        'No GitHub authentication credentials provided. Set either GITHUB_TOKEN or GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.'
      );
    }

    this.prManager = new PRManager(linearClient);
    this.technicalAnalysis = new TechnicalAnalysisService(linearClient);

    // Parse allowed repositories from env variable
    if (env.ALLOWED_REPOSITORIES) {
      this.allowedRepositories = env.ALLOWED_REPOSITORIES.split(',').map((r) =>
        r.trim()
      );
    }
  }

  // Add method to get appropriate octokit for a repo
  private async getOctokitForRepo(repository: string): Promise<Octokit> {
    if (this.githubAppService) {
      // Using GitHub App authentication
      return this.githubAppService.getOctokitForRepo(repository);
    }
    // Using PAT authentication (already initialized)
    return this.octokit;
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
      console.log(`Repository distribution for ${issue.identifier}:`);
      for (const [repo, count] of repoDistribution.entries()) {
        console.log(`- ${repo}: ${count} files`);
      }

      // 2. Check for stack trace - this provides valuable context
      const hasStackTrace = this.containsStackTrace(issue.description || '');
      if (hasStackTrace) {
        console.log(`Stack trace detected in issue ${issue.identifier}`);
      }

      // 3. Generate or get technical report from existing comments
      let technicalReport = await this.findTechnicalReportInComments(issue);

      if (!technicalReport) {
        console.log(`Generating technical report for ${issue.identifier}`);
        technicalReport = await this.generateTechnicalReport(issue);

        // Add the technical report as a comment
        await this.linearClient.createComment({
          issueId: issue.id,
          body: `## Technical Analysis Report\n\n${technicalReport}`,
        });
      }

      // 4. Plan code changes using enhanced analysis
      console.log(`Planning code changes for ${issue.identifier}`);
      const changePlan = await this.planCodeChanges(issue, technicalReport);

      // Add the change plan as a comment
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `## Implementation Plan\n\n${changePlan}`,
      });

      // 5. Generate code changes based on technical report and change plan
      console.log(`Generating code changes for ${issue.identifier}`);
      const changes = await this.generateCodeChanges(
        issue.identifier,
        technicalReport,
        changePlan.implementationPlan
      );

      // Validate changes
      if (!changes || changes.length === 0) {
        console.log(`No changes generated for ${issue.identifier}`);
        await this.linearClient.createComment({
          issueId: issue.id,
          body: "I couldn't generate any code changes. The issue may be too complex or might require more context.",
        });
        return;
      }

      // 6. Check if changes are in multiple repositories - this is a warning sign
      const affectedRepositories = new Set(
        changes.map((change) => change.repository)
      );

      if (affectedRepositories.size > 1) {
        console.log(
          `Warning: Changes span multiple repositories: ${Array.from(
            affectedRepositories
          ).join(', ')}`
        );

        await this.linearClient.createComment({
          issueId: issue.id,
          body: `⚠️ The changes I'm about to implement span multiple repositories (${Array.from(
            affectedRepositories
          ).join(', ')}). Please review carefully to ensure this is intended.`,
        });
      }

      // Group changes by repository
      const changesByRepo = new Map<
        string,
        Array<{ path: string; content: string }>
      >();

      for (const change of changes) {
        if (!changesByRepo.has(change.repository)) {
          changesByRepo.set(change.repository, []);
        }

        changesByRepo.get(change.repository)!.push({
          path: change.path,
          content: change.content,
        });
      }

      // 7. Create PRs for each repository
      for (const [repository, repoChanges] of changesByRepo.entries()) {
        const repoName = repository.split('/')[1];

        const repositoryChanges = changes.filter(
          (change) => change.repository === repository
        );

        if (repositoryChanges.length > 0) {
          await this.linearClient.createComment({
            issueId: issue.id,
            body: `Working on implementing changes in the repository ${repository}. This might take a few minutes...`,
          });

          try {
            const branchName =
              `fix/${issue.identifier.toLowerCase()}-${Date.now()}`.replace(
                /[^a-zA-Z0-9-_]/g,
                '-'
              );

            const pullRequest = await this.createPullRequest(
              issue,
              repository,
              branchName,
              repositoryChanges,
              `Fix ${issue.identifier}: ${issue.title}\n\n${changePlan}`
            );

            // Add PR link as attachment
            await this.linearClient.createAttachment({
              issueId: issue.id,
              title: `PR: ${repoName}`,
              url: pullRequest.url,
            });

            await this.updateIssueStatus(issue.identifier, 'In Review');
          } catch (error: unknown) {
            console.error(`Error creating PR for ${repository}:`, error);
            await this.linearClient.createComment({
              issueId: issue.id,
              body: `❌ Error creating PR for repository ${repository}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        } else {
          await this.linearClient.createComment({
            issueId: issue.id,
            body: `⚠️ No changes were made in repository ${repository}`,
          });
        }
      }
    } catch (error: unknown) {
      console.error(
        `Error implementing changes for ${issue.identifier}:`,
        error
      );
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I encountered an error while implementing changes: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      });
    }
  }

  /**
   * Search for relevant files based on keywords from an issue
   */
  private async searchRelevantFiles(
    issue: Issue
  ): Promise<Array<{ path: string; repository: string; content?: string }>> {
    const results: Array<{
      path: string;
      repository: string;
      content?: string;
    }> = [];

    // Extract keywords from issue title and description
    const keywords = this.extractKeywords(
      issue.title + ' ' + (issue.description || '')
    );
    if (keywords.length === 0) {
      return results;
    }

    // Extract repository names from issue description
    const repositories = this.extractRepositoriesFromReport(
      issue.description || ''
    );
    const repoNames =
      repositories === 'none explicitly mentioned'
        ? this.allowedRepositories
        : repositories.split(',').map((r) => r.trim());

    for (const repo of repoNames) {
      if (!this.allowedRepositories.includes(repo)) {
        continue;
      }

      const [owner, name] = repo.split('/');

      for (const keyword of keywords) {
        try {
          // Get the octokit instance for this repository
          const octokit = await this.getOctokitForRepo(repo);

          // Search for files containing the keyword
          const searchResponse = await octokit.rest.search.code({
            q: `repo:${repo} ${keyword}`,
            per_page: 10,
          });

          // Add results, avoiding duplicates
          for (const item of searchResponse.data.items) {
            if (
              !results.some(
                (r) => r.path === item.path && r.repository === repo
              )
            ) {
              results.push({
                path: item.path,
                repository: repo,
              });
            }
          }
        } catch (error: unknown) {
          console.error(
            `Error searching for ${keyword} in ${repo}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    return results;
  }

  /**
   * Extract meaningful keywords from text for file searching
   */
  private extractKeywords(text: string): string[] {
    // Remove common words and keep only meaningful terms
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 3 &&
          ![
            'the',
            'and',
            'that',
            'have',
            'for',
            'not',
            'with',
            'you',
            'this',
            'but',
            'his',
            'from',
            'they',
            'say',
            'her',
            'she',
            'will',
            'one',
            'all',
            'would',
            'there',
            'their',
            'what',
            'out',
            'about',
            'who',
            'get',
            'which',
            'when',
            'make',
            'can',
            'like',
            'time',
            'just',
            'him',
            'know',
            'take',
            'people',
            'into',
            'year',
            'your',
            'good',
            'some',
            'could',
            'them',
            'see',
            'other',
            'than',
            'then',
            'now',
            'look',
            'only',
            'come',
            'its',
            'over',
            'think',
            'also',
            'back',
            'after',
            'use',
            'two',
            'how',
            'our',
            'work',
            'first',
            'well',
            'way',
            'even',
            'new',
            'want',
            'because',
            'any',
            'these',
            'give',
            'day',
            'most',
            'user',
            'error',
            'bug',
            'issue',
            'problem',
            'fails',
            'feature',
          ].includes(word)
      );

    // Prioritize technical terms (camelCase or snake_case)
    const technicalTerms = words.filter(
      (word) =>
        /[A-Z]/.test(word) || // camelCase
        word.includes('_') || // snake_case
        /^[a-z]+\d+$/.test(word) // Words with numbers
    );

    // Combine technical terms with other meaningful words
    const uniqueWords = [...new Set([...technicalTerms, ...words])];

    // Return top keywords, prioritizing technical terms
    return uniqueWords.slice(0, 10);
  }

  /**
   * Execute a technical analysis with enhanced code context
   */
  async executeTechnicalAnalysis(issue: Issue): Promise<void> {
    try {
      // Update status to indicate we're working on the analysis
      await this.updateIssueStatus(issue.identifier, 'In Progress');
      await this.linearClient.createComment({
        issueId: issue.id,
        body: "🔍 I'm analyzing this issue to provide a technical report...",
      });

      // Search for relevant files
      const relevantFiles = await this.searchRelevantFiles(issue);
      if (relevantFiles.length === 0) {
        await this.linearClient.createComment({
          issueId: issue.id,
          body: "❓ I couldn't find relevant files to analyze based on the issue description. Please provide more specific information about the problem or mention which repositories contain the relevant code.",
        });
        await this.updateIssueStatus(issue.identifier, 'Todo');
        return;
      }

      // Load content for all files
      const filesWithContent = await this.loadFileContents(relevantFiles);

      // Check if the issue contains a stack trace
      const hasStackTrace = this.containsStackTrace(issue.description || '');

      // Build file context for the prompt
      const fileContext = filesWithContent
        .map(
          (file) =>
            `## ${file.repository}/${file.path}\n\`\`\`\n${file.content}\n\`\`\``
        )
        .join('\n\n');

      // Build list of relevant file paths for reference
      const relevantFilePaths = filesWithContent
        .map((file) => `${file.repository}/${file.path}`)
        .join('\n');

      // Generate technical analysis
      const technicalAnalysisPrompt = await this.buildTechnicalAnalysisPrompt(
        issue,
        fileContext,
        hasStackTrace,
        relevantFilePaths
      );

      // Use the AI model to generate the technical report
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: technicalAnalysisPrompt,
          },
        ],
        temperature: 0.3,
      });

      const technicalReport = response.choices[0].message.content || '';

      // Post the technical report as a comment
      await this.linearClient.createComment({
        issueId: issue.id,
        body: technicalReport,
      });

      // Update issue status
      await this.updateIssueStatus(issue.identifier, 'Todo');

      // Add label to indicate analysis is complete
      await this.addLabel(issue.id, 'technical-analysis');
    } catch (error: unknown) {
      console.error(`Error executing technical analysis:`, error);
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I encountered an error while performing the technical analysis: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      });
      await this.updateIssueStatus(issue.identifier, 'Todo');
    }
  }

  /**
   * Check if the text contains a stack trace
   */
  private containsStackTrace(text: string): boolean {
    const stackTracePatterns = [
      /at\s+[\w$.]+\s+\(.*:\d+:\d+\)/i, // JavaScript/TypeScript stack trace
      /Error:.*\n\s+at\s+/i, // Error followed by stack trace
      /File ".*", line \d+, in \w+/i, // Python-like stack trace
      /Exception in thread .*java\.\w+\.\w+/i, // Java exception
      /Traceback \(most recent call last\):/i, // Python traceback
    ];

    return stackTracePatterns.some((pattern) => pattern.test(text));
  }

  /**
   * Load the content of files from GitHub
   */
  private async loadFileContents(
    files: Array<{ path: string; repository: string; content?: string }>
  ): Promise<Array<{ path: string; repository: string; content: string }>> {
    const result: Array<{ path: string; repository: string; content: string }> =
      [];

    for (const file of files) {
      // Skip files that already have content
      if (file.content) {
        result.push(
          file as { path: string; repository: string; content: string }
        );
        continue;
      }

      try {
        const [owner, repo] = file.repository.split('/');
        // Get the octokit instance for this repository
        const octokit = await this.getOctokitForRepo(file.repository);

        const response = await octokit.repos.getContent({
          owner,
          repo,
          path: file.path,
        });

        // Handle file content
        if ('content' in response.data && 'encoding' in response.data) {
          let content = '';
          if (response.data.encoding === 'base64') {
            content = Buffer.from(response.data.content, 'base64').toString(
              'utf-8'
            );
          } else {
            content = response.data.content;
          }

          result.push({
            path: file.path,
            repository: file.repository,
            content,
          });
        }
      } catch (error: unknown) {
        console.error(
          `Error loading content for ${file.repository}/${file.path}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return result;
  }

  /**
   * Build a prompt for technical analysis
   */
  private async buildTechnicalAnalysisPrompt(
    issue: Issue,
    fileContext: string,
    hasStackTrace: boolean,
    relevantFilePaths: string
  ): Promise<string> {
    const issueContext = `
# Issue Details
ID: ${issue.identifier}
Title: ${issue.title}
Description:
${issue.description || 'No description provided'}
`;

    let additionalContext = '';

    // Add stack trace notice if detected
    if (hasStackTrace) {
      additionalContext +=
        '## Stack Trace Analysis\nThe issue description appears to contain a stack trace. Please analyze it to identify the root cause of the error.\n\n';
    }

    // Add repo and file information
    additionalContext += `## Relevant Files\nThese files were identified as potentially relevant to the issue:\n${relevantFilePaths}\n\n`;

    return `# Technical Analysis Request

${issueContext}

${additionalContext}

## Codebase Files
${fileContext}

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
   * Extract repositories mentioned in a report string
   */
  private extractRepositoriesFromReport(report: string): string {
    if (!report) {
      return 'none explicitly mentioned';
    }

    // Patterns to match repository mentions
    const repoPatterns = [
      // Format: "Repository: owner/repo"
      /repository\s*:\s*([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/gi,
      // Format: "In owner/repo"
      /\bin\s+([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/gi,
      // Format: "owner/repo repository"
      /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\s+repository\b/gi,
      // Format: "owner/repo repo"
      /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\s+repo\b/gi,
      // Format: "repo: owner/repo"
      /\brepo\s*:\s*([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/gi,
      // Format: bare "owner/repo"
      /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/g,
    ];

    const repositories = new Set<string>();

    // Extract repositories using each pattern
    for (const pattern of repoPatterns) {
      let match;
      while ((match = pattern.exec(report)) !== null) {
        const repo = match[1];
        if (this.allowedRepositories.includes(repo)) {
          repositories.add(repo);
        }
      }
    }

    return repositories.size > 0
      ? Array.from(repositories).join(', ')
      : 'none explicitly mentioned';
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

  /**
   * Implement changes for an issue
   */
  private async implementChanges(issue: Issue): Promise<void> {
    try {
      // Execute the technical analysis first
      await this.performTechnicalAnalysis(issue);

      console.log(`Implemented changes for issue ${issue.identifier}`);
    } catch (error: unknown) {
      console.error(
        `Error implementing changes for issue ${issue.identifier}:`,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Find an existing technical report in the issue comments
   */
  private async findTechnicalReportInComments(
    issue: Issue
  ): Promise<string | null> {
    try {
      // Get comments for the issue
      const comments = await issue.comments();

      // Look for a comment that contains a technical report
      for (const comment of comments.nodes) {
        if (comment.body.includes('## Technical Analysis Report')) {
          // Extract the report content (everything after the header)
          const reportContent = comment.body.split(
            '## Technical Analysis Report\n\n'
          )[1];
          if (reportContent) {
            return reportContent;
          }
        }
      }

      // No technical report found
      return null;
    } catch (error) {
      console.error(
        `Error finding technical report for issue ${issue.identifier}:`,
        error
      );
      return null;
    }
  }

  /**
   * Generate a technical report for an issue
   */
  private async generateTechnicalReport(issue: Issue): Promise<string> {
    try {
      // Search for relevant files
      const relevantFiles = await this.searchRelevantFiles(issue);

      // Load the content for the files
      const filesWithContent = await this.loadFileContents(relevantFiles);

      // Use the technical analysis service to generate a report
      const report = await this.technicalAnalysis.generateTechnicalReport(
        issue,
        filesWithContent
      );

      return report;
    } catch (error: unknown) {
      console.error(
        `Error generating technical report for issue ${issue.identifier}:`,
        error instanceof Error ? error.message : String(error)
      );
      return 'Failed to generate technical report due to an error.';
    }
  }

  /**
   * Plan code changes based on a technical report
   */
  private async planCodeChanges(
    issue: Issue,
    technicalReport: string
  ): Promise<any> {
    try {
      // Search for relevant files
      const relevantFiles = await this.searchRelevantFiles(issue);

      // Load file contents
      const filesWithContent = await this.loadFileContents(relevantFiles);

      // Use technical analysis service to plan changes
      return this.technicalAnalysis.planCodeChanges(
        issue,
        technicalReport,
        filesWithContent
      );
    } catch (error: unknown) {
      console.error(
        `Error planning code changes for issue ${issue.identifier}:`,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Generate code changes based on technical report and implementation plan
   */
  private async generateCodeChanges(
    issueId: string,
    technicalReport: string,
    implementationPlan: string
  ): Promise<Array<{ path: string; content: string; repository: string }>> {
    try {
      // Get the issue object
      const issue = await this.linearClient.issue(issueId);
      if (!issue) {
        throw new Error(`Issue ${issueId} not found`);
      }

      // Search for relevant files
      const relevantFiles = await this.searchRelevantFiles(issue);
      const filesWithContent = await this.loadFileContents(relevantFiles);

      // Call the AI model to generate code changes
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'system',
            content: buildCodeImplementationPrompt({
              issue,
              technicalReport,
              changePlan: implementationPlan,
              filesWithRepoInfo: filesWithContent,
              allowedRepositories: this.allowedRepositories,
            }),
          },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });

      // Parse the response to get code changes
      const responseText = response.choices[0].message.content;
      if (!responseText) {
        return [];
      }

      const parsedResponse = JSON.parse(responseText);
      const changes = parsedResponse.changes || [];

      // Validate each change has required fields
      return changes.filter(
        (change: any) =>
          change.path &&
          change.content &&
          change.repository &&
          this.allowedRepositories.includes(change.repository)
      );
    } catch (error: unknown) {
      console.error(
        `Error generating code changes for issue ${issueId}:`,
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  /**
   * Create a pull request with code changes for an issue
   */
  private async createPullRequest(
    issue: Issue,
    repository: string,
    branchName: string,
    changes: Array<{ path: string; content: string }>,
    commitMessage: string
  ): Promise<{ url: string; number: number }> {
    try {
      // Get default branch for repository
      const defaultBranch = await this.prManager.getDefaultBranch(repository);

      // Create a new branch for the changes
      await this.prManager.createBranch(branchName, repository, defaultBranch);

      // Apply each change to the repository
      for (const change of changes) {
        await this.prManager.createOrUpdateFile(
          change.path,
          change.content,
          `Update ${change.path} for ${issue.identifier}`,
          repository,
          branchName
        );
      }

      // Create pull request
      const pullRequest = await this.prManager.createPullRequest(
        `Fix ${issue.identifier}: ${issue.title}`,
        commitMessage,
        branchName,
        defaultBranch,
        repository
      );

      return pullRequest;
    } catch (error: unknown) {
      console.error(
        `Error creating pull request for issue ${issue.identifier}:`,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
}
