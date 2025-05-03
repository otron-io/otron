import { Issue, LinearClient } from '@linear/sdk';
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';
import { LocalRepositoryManager } from './repository-manager.js';
import {
  buildLinearGptSystemPrompt,
  getAvailableToolsDescription,
} from './prompts.js';
import { Redis } from '@upstash/redis';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Memory system constants
const MEMORY_EXPIRY = 60 * 60 * 24 * 90; // 90 days in seconds
const MAX_MEMORIES_PER_ISSUE = 20; // Maximum number of memory entries per issue
const MAX_MEMORY_ENTRIES_TO_INCLUDE = 5; // Maximum number of memory entries to include in a prompt

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: env.CLAUDE_API_KEY,
});

interface NotificationContext {
  issue: Issue;
  notificationType?: string;
  commentId?: string;
  appUserId?: string;
}

export class Otron {
  private allowedRepositories: string[] = [];
  private localRepoManager: LocalRepositoryManager;
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

    // Pass the allowed repositories to the LocalRepositoryManager
    this.localRepoManager = new LocalRepositoryManager(
      this.allowedRepositories
    );
  }

  /**
   * Store a memory entry for an issue in Redis
   */
  private async storeMemory(
    issueId: string,
    memoryType: 'conversation' | 'action' | 'context',
    data: any
  ): Promise<void> {
    try {
      // Create a memory entry with timestamp and data
      const memoryEntry = {
        timestamp: Date.now(),
        type: memoryType,
        data,
      };

      // Store in Redis list, newest first
      await redis.lpush(
        `memory:issue:${issueId}:${memoryType}`,
        JSON.stringify(memoryEntry)
      );

      // Trim the list to prevent unlimited growth
      await redis.ltrim(
        `memory:issue:${issueId}:${memoryType}`,
        0,
        MAX_MEMORIES_PER_ISSUE - 1
      );

      // Set expiration for the key
      await redis.expire(
        `memory:issue:${issueId}:${memoryType}`,
        MEMORY_EXPIRY
      );

      console.log(`Stored ${memoryType} memory for issue ${issueId}`);
    } catch (error) {
      console.error(`Error storing memory for issue ${issueId}:`, error);
    }
  }

  /**
   * Retrieve memory entries for an issue from Redis
   */
  private async retrieveMemories(
    issueId: string,
    memoryType: 'conversation' | 'action' | 'context',
    limit: number = MAX_MEMORY_ENTRIES_TO_INCLUDE
  ): Promise<any[]> {
    try {
      const memories = await redis.lrange(
        `memory:issue:${issueId}:${memoryType}`,
        0,
        limit - 1
      );

      return memories.map((item) => {
        // Check if item is already an object
        if (typeof item === 'object' && item !== null) {
          return item;
        }

        // Otherwise try to parse it as JSON
        try {
          return JSON.parse(item);
        } catch (error) {
          console.error(`Error parsing memory item: ${error}`);
          return {
            timestamp: Date.now(),
            type: memoryType,
            data: { error: 'Failed to parse memory data' },
          };
        }
      });
    } catch (error) {
      console.error(`Error retrieving memories for issue ${issueId}:`, error);
      return [];
    }
  }

  /**
   * Store tool usage statistics
   */
  private async trackToolUsage(
    toolName: string,
    success: boolean,
    context: {
      issueId: string;
      input: any;
      response: string;
    }
  ): Promise<void> {
    try {
      // Increment tool usage counters
      await redis.hincrby(`memory:tools:${toolName}:stats`, 'attempts', 1);
      if (success) {
        await redis.hincrby(`memory:tools:${toolName}:stats`, 'successes', 1);
      }

      // Store context for this specific tool usage
      await this.storeMemory(context.issueId, 'action', {
        tool: toolName,
        input: context.input,
        response: context.response,
        success,
      });
    } catch (error) {
      console.error(`Error tracking tool usage for ${toolName}:`, error);
    }
  }

  /**
   * Add relationships to the memory system
   */
  private async storeRelationship(
    relationshipType: string,
    entity1: string,
    entity2: string
  ): Promise<void> {
    try {
      // Store bidirectional relationships
      await redis.sadd(`memory:${relationshipType}:${entity1}`, entity2);
      await redis.expire(
        `memory:${relationshipType}:${entity1}`,
        MEMORY_EXPIRY
      );
    } catch (error) {
      console.error(`Error storing relationship ${relationshipType}:`, error);
    }
  }

  /**
   * Retrieve previous conversations for context augmentation
   */
  private async getPreviousConversations(issueId: string): Promise<string> {
    const memories = await this.retrieveMemories(issueId, 'conversation');

    if (memories.length === 0) {
      return '';
    }

    let contextString = '\n\nPREVIOUS CONVERSATIONS:\n';

    // Format each memory entry into a readable format for the context
    memories.forEach((memory, index) => {
      const timestamp = new Date(memory.timestamp).toISOString();
      contextString += `[${timestamp}] `;

      if (memory.data.role === 'assistant') {
        contextString += `Assistant: `;
        // Extract text blocks from the assistant's message
        const textBlocks = memory.data.content
          .filter((block: any) => block && block.type === 'text')
          .map((block: any) => block.text || '')
          .join('\n');
        contextString += `${textBlocks}\n`;
      } else if (memory.data.role === 'user') {
        contextString += `User: ${memory.data.content}\n`;
      }
    });

    return contextString;
  }

  /**
   * Get issue history and related activity
   */
  private async getIssueHistory(issueId: string): Promise<string> {
    const actions = await this.retrieveMemories(issueId, 'action');

    if (actions.length === 0) {
      return '';
    }

    let historyString = '\n\nPREVIOUS ACTIONS:\n';

    // Format each action entry
    actions.forEach((action, index) => {
      const timestamp = new Date(action.timestamp).toISOString();
      historyString += `[${timestamp}] Tool: ${action.data.tool}, Success: ${action.data.success}\n`;
    });

    return historyString;
  }

  /**
   * Get related issues based on similarity or past relationships
   */
  private async getRelatedIssues(issueId: string): Promise<string> {
    try {
      // Get files associated with this issue
      const relatedFiles = await redis.smembers(`memory:issue:file:${issueId}`);

      // Find other issues that touched the same files
      let relatedIssues = new Set<string>();

      for (const file of relatedFiles) {
        const issues = await redis.smembers(`memory:file:issue:${file}`);
        // Add to set to avoid duplicates
        issues.forEach((issue) => {
          if (issue !== issueId) {
            relatedIssues.add(issue);
          }
        });
      }

      if (relatedIssues.size === 0) {
        return '';
      }

      // Get issue details for related issues (just the most recent 3)
      const relatedIssueArray = Array.from(relatedIssues).slice(0, 3);
      let relatedIssueDetails = '\n\nRELATED ISSUES:\n';

      for (const relatedIssueId of relatedIssueArray) {
        try {
          // Try to get the issue from Linear
          const relatedIssue = await this.linearClient.issue(relatedIssueId);
          relatedIssueDetails += `- ${relatedIssue.identifier}: ${relatedIssue.title}\n`;
        } catch (error) {
          // If we can't get the issue, just add the ID
          relatedIssueDetails += `- Issue ID: ${relatedIssueId}\n`;
        }
      }

      return relatedIssueDetails;
    } catch (error) {
      console.error(`Error retrieving related issues for ${issueId}:`, error);
      return '';
    }
  }

  /**
   * Store topic expertise for repositories and components
   */
  private async storeCodeKnowledge(
    repository: string,
    path: string,
    topic: string
  ): Promise<void> {
    try {
      // Extract component from path (e.g., src/components/users -> components/users)
      const parts = path.split('/');
      let component = '';

      if (parts.length >= 2) {
        // Try to identify meaningful component (skip very generic paths like 'src')
        const skipParts = ['src', 'lib', 'app', 'main'];
        for (let i = 0; i < parts.length - 1; i++) {
          if (!skipParts.includes(parts[i])) {
            component = parts.slice(i, i + 2).join('/');
            break;
          }
        }

        // If no component found, use the directory
        if (!component && parts.length > 1) {
          component = parts[parts.length - 2];
        }
      }

      if (component) {
        // Associate the topic with this component
        await redis.zincrby(
          `memory:component:${repository}:${component}:topics`,
          1,
          topic
        );
        // Set expiry
        await redis.expire(
          `memory:component:${repository}:${component}:topics`,
          MEMORY_EXPIRY
        );
      }
    } catch (error) {
      console.error(
        `Error storing code knowledge for ${repository}:${path}:`,
        error
      );
    }
  }

  /**
   * Get knowledge about a repository's most accessed files
   */
  private async getRepositoryKnowledge(repository: string): Promise<string> {
    try {
      // Get most frequently accessed files for this repository
      const fileScores = await redis.zrange(
        `memory:repository:${repository}:files`,
        0,
        9,
        {
          rev: true,
          withScores: true,
        }
      );

      if (!fileScores || fileScores.length === 0) {
        return '';
      }

      // Convert to array of files (handling new structure)
      const files: string[] = [];
      for (const entry of fileScores) {
        if (typeof entry === 'string') {
          files.push(entry);
        }
      }

      // We'll include this knowledge directly
      return (
        `\n\nREPOSITORY KNOWLEDGE (${repository}):\n` +
        `Key files: ${files.join(', ')}\n` +
        `Remember to consider repository structure and patterns when making changes.`
      );
    } catch (error) {
      console.error(
        `Error getting repository knowledge for ${repository}:`,
        error
      );
      return '';
    }
  }

  /**
   * Check if a branch is protected (main or master) and should not be directly modified
   * @param branch Branch name to check
   * @returns Object with isProtected flag and optional error message
   */
  private isProtectedBranch(branch: string): {
    isProtected: boolean;
    errorMessage?: string;
  } {
    const protectedBranches = ['main', 'master'];

    if (protectedBranches.includes(branch.toLowerCase())) {
      return {
        isProtected: true,
        errorMessage: `Error: Cannot commit directly to ${branch}. Please use a feature branch instead.`,
      };
    }

    return { isProtected: false };
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
      const issueContext = await this.getIssueContext(issue, commentId);

      // Get previous conversations and actions from memory
      const previousConversations = await this.getPreviousConversations(
        issue.id
      );
      const issueHistory = await this.getIssueHistory(issue.id);

      // Get related issues and repository knowledge
      const relatedIssues = await this.getRelatedIssues(issue.id);

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
          repositoryKnowledge = await this.getRepositoryKnowledge(repoName);
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
      const tools: any[] = [
        {
          name: 'createComment',
          description: 'Create a comment on a Linear issue',
          input_schema: {
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
                description: 'Optional parent comment ID if this is a reply',
              },
            },
            required: ['issueId', 'comment'],
          },
        },
        {
          name: 'editFile',
          description:
            'Make targeted edits to a file without replacing the entire content',
          input_schema: {
            type: 'object',
            properties: {
              repository: {
                type: 'string',
                description: 'Repository in owner/repo format',
              },
              path: {
                type: 'string',
                description: 'Path to the file to modify',
              },
              branch: {
                type: 'string',
                description:
                  'Branch name for the changes (cannot be main or master)',
              },
              commitMessage: {
                type: 'string',
                description: 'Commit message to use for the changes',
              },
              edits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['insert', 'delete', 'replace', 'update'],
                      description:
                        'Type of edit to make (insert, delete, replace, update)',
                    },
                    startLine: {
                      type: 'integer',
                      description:
                        'Starting line number for the edit (1-based)',
                    },
                    endLine: {
                      type: 'integer',
                      description:
                        'Ending line number for the edit (only for delete/replace/update)',
                    },
                    content: {
                      type: 'string',
                      description:
                        'New content to insert or replace with (not needed for delete)',
                    },
                  },
                  required: ['type', 'startLine'],
                },
                description: 'Array of edit operations to perform',
              },
              createBranchIfNeeded: {
                type: 'boolean',
                description: 'Create the branch if it does not exist',
                default: true,
              },
              baseBranch: {
                type: 'string',
                description:
                  'Base branch to create new branch from (only used if creating a new branch)',
                default: 'main',
              },
            },
            required: [
              'repository',
              'path',
              'branch',
              'commitMessage',
              'edits',
            ],
          },
        },
        {
          name: 'replaceInFile',
          description: 'Find and replace text patterns in a file',
          input_schema: {
            type: 'object',
            properties: {
              repository: {
                type: 'string',
                description: 'Repository in owner/repo format',
              },
              path: {
                type: 'string',
                description: 'Path to the file to modify',
              },
              branch: {
                type: 'string',
                description:
                  'Branch name for the changes (cannot be main or master)',
              },
              commitMessage: {
                type: 'string',
                description: 'Commit message to use for the changes',
              },
              replacements: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    find: {
                      type: 'string',
                      description:
                        'Text pattern to find (can be a string or a regex pattern)',
                    },
                    replace: {
                      type: 'string',
                      description: 'Text to replace matches with',
                    },
                    regex: {
                      type: 'boolean',
                      description:
                        'Whether to treat the find pattern as a regular expression',
                      default: false,
                    },
                    global: {
                      type: 'boolean',
                      description:
                        'Whether to replace all occurrences or just the first one',
                      default: true,
                    },
                  },
                  required: ['find', 'replace'],
                },
                description: 'Array of find/replace operations to perform',
              },
              createBranchIfNeeded: {
                type: 'boolean',
                description: 'Create the branch if it does not exist',
                default: true,
              },
              baseBranch: {
                type: 'string',
                description:
                  'Base branch to create new branch from (only used if creating a new branch)',
                default: 'main',
              },
            },
            required: [
              'repository',
              'path',
              'branch',
              'commitMessage',
              'replacements',
            ],
          },
        },
        {
          name: 'searchCodeFiles',
          description:
            'Search for relevant code files related to keywords with advanced capabilities. Some repositories may use vector embeddings for faster, more reliable semantic search. For repositories without embeddings, rate limits and timeouts may apply.',
          input_schema: {
            type: 'object',
            properties: {
              repository: {
                type: 'string',
                description: 'Repository to search in (owner/repo format)',
              },
              query: {
                type: 'string',
                description:
                  'Search query/keywords - be semantic and descriptive for repositories with embeddings. For GitHub API searches, be specific (2-5 terms).',
              },
              fileFilter: {
                type: 'string',
                description:
                  'Optional filter for specific files (e.g., "*.ts", "src/components/*") - recommended to narrow results',
              },
              contextAware: {
                type: 'boolean',
                description: 'Include structural context about matched files',
              },
              semanticBoost: {
                type: 'boolean',
                description:
                  'Use semantic search to improve relevance. For embedded repositories, this is always enabled.',
              },
              maxResults: {
                type: 'integer',
                description:
                  'Maximum number of results to return (default: 5, max: 10). Higher values may cause timeouts with GitHub API.',
              },
            },
            required: ['repository', 'query'],
          },
        },
        {
          name: 'getDirectoryStructure',
          description:
            'Get the directory structure of a repository or specific path',
          input_schema: {
            type: 'object',
            properties: {
              repository: {
                type: 'string',
                description: 'Repository to explore (owner/repo format)',
              },
              path: {
                type: 'string',
                description: 'Path within the repository to explore (optional)',
              },
            },
            required: ['repository'],
          },
        },
        {
          name: 'getFileContent',
          description:
            'Get the content of a specific file from a repository, with optional line range',
          input_schema: {
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
              branch: {
                type: 'string',
                description:
                  'Branch to get the file from (defaults to repository default branch)',
              },
              startLine: {
                type: 'integer',
                description:
                  'Starting line number to retrieve (1-based, defaults to 1)',
              },
              maxLines: {
                type: 'integer',
                description:
                  'Maximum number of lines to retrieve (max 200, defaults to 200)',
              },
            },
            required: ['repository', 'path'],
          },
        },
        {
          name: 'getPullRequest',
          description:
            'Get details of a pull request including its comments and review comments',
          input_schema: {
            type: 'object',
            properties: {
              repository: {
                type: 'string',
                description:
                  'Repository containing the pull request (owner/repo format)',
              },
              pullNumber: {
                type: 'integer',
                description: 'The pull request number to retrieve',
              },
            },
            required: ['repository', 'pullNumber'],
          },
        },
        {
          name: 'updateIssueStatus',
          description: 'Update the status of an issue in Linear',
          input_schema: {
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
        {
          name: 'addLabel',
          description: 'Add a label to an issue in Linear',
          input_schema: {
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
        {
          name: 'removeLabel',
          description: 'Remove a label from an issue in Linear',
          input_schema: {
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
        {
          name: 'assignIssue',
          description: 'Assign an issue to a team member in Linear',
          input_schema: {
            type: 'object',
            properties: {
              issueId: {
                type: 'string',
                description: 'The ID of the issue to assign',
              },
              assigneeEmail: {
                type: 'string',
                description: 'The email of the user to assign the issue to',
              },
            },
            required: ['issueId', 'assigneeEmail'],
          },
        },
        {
          name: 'createIssue',
          description: 'Create a new issue in Linear',
          input_schema: {
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
                description: 'Optional ID of a parent issue (for sub-issues)',
              },
            },
            required: ['teamId', 'title', 'description'],
          },
        },
        {
          name: 'addIssueAttachment',
          description: 'Add a URL attachment to an issue in Linear',
          input_schema: {
            type: 'object',
            properties: {
              issueId: {
                type: 'string',
                description: 'The ID of the issue to add the attachment to',
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
        {
          name: 'updateIssuePriority',
          description: 'Update the priority of an issue in Linear',
          input_schema: {
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
        {
          name: 'createPullRequest',
          description: 'Create a pull request for code changes',
          input_schema: {
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
                description: 'Base branch to create PR against (usually main)',
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
        {
          name: 'createBranchWithChanges',
          description:
            'Create or update a branch with code changes without creating a PR',
          input_schema: {
            type: 'object',
            properties: {
              repository: {
                type: 'string',
                description: 'Repository in owner/repo format',
              },
              branch: {
                type: 'string',
                description:
                  'Branch name for the changes (cannot be main or master)',
              },
              baseBranch: {
                type: 'string',
                description:
                  'Base branch to create branch from (usually main). Only used if creating a new branch.',
              },
              skipBranchCreation: {
                type: 'boolean',
                description:
                  'Set to true to push to existing branch without attempting to create it',
              },
              commitMessage: {
                type: 'string',
                description: 'Commit message to use for the changes',
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
                description: 'File changes to include in the commit',
              },
            },
            required: ['repository', 'branch', 'commitMessage', 'changes'],
          },
        },
        {
          name: 'setPointEstimate',
          description: 'Set the point estimate for a Linear issue',
          input_schema: {
            type: 'object',
            properties: {
              issueId: {
                type: 'string',
                description: 'The ID of the issue to update',
              },
              estimate: {
                type: 'number',
                description:
                  'The point estimate to set (1, 2, 3, 5, 8, 13, 21, etc.)',
              },
            },
            required: ['issueId', 'estimate'],
          },
        },
        {
          name: 'endResponse',
          description:
            'Use this to explicitly signal that you have completed your task and wish to end the conversation. This should be the final tool you call after completing all necessary actions.',
          input_schema: {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description: 'Optional summary of the work completed',
              },
            },
          },
        },
      ];

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
        // Use Anthropic's streaming client
        const stream = anthropic.messages.stream({
          model: 'claude-3-5-sonnet-latest',
          max_tokens: 8192,
          system: systemMessage as any,
          messages: messages as any,
          tools: tools as any,
          tool_choice: {
            type: 'any',
          },
          // thinking: {
          //   budget_tokens: 1024,
          //   type: 'enabled',
          // },
        });

        // Store the complete response without any modifications
        const completeResponse: any[] = [];
        let lastLog = Date.now();
        let eventCount = 0;

        // Process the stream and build the complete response
        for await (const event of stream) {
          eventCount++;
          // Log progress every 5 seconds or every 20 events
          if (Date.now() - lastLog > 5000 || eventCount % 20 === 0) {
            console.log(`[Anthropic stream] Received event:`, event.type);
            lastLog = Date.now();
          }

          // Collect all events to reconstruct the exact original blocks
          if (event.type === 'content_block_start') {
            completeResponse[event.index] = { ...event.content_block };
          } else if (event.type === 'content_block_delta') {
            const block = completeResponse[event.index] || {
              type: event.delta.type,
            };

            if (event.delta.type === 'text_delta') {
              block.text = (block.text || '') + event.delta.text;
            } else if (event.delta.type === 'thinking_delta') {
              block.thinking = (block.thinking || '') + event.delta.thinking;
            } else if (event.delta.type === 'input_json_delta') {
              block.partial_json =
                (block.partial_json || '') + event.delta.partial_json;
            } else if (event.delta.type === 'signature_delta') {
              block.signature = event.delta.signature;
            }

            completeResponse[event.index] = block;
          }
        }

        // Clean up partial_json in tool_use blocks but leave everything else intact
        const finalResponse = completeResponse.map((block) => {
          if (block && block.type === 'tool_use' && block.partial_json) {
            // Parse the JSON if it's complete
            try {
              const input = JSON.parse(block.partial_json);
              return { ...block, input, partial_json: undefined };
            } catch (e) {
              // If JSON parsing fails, just return the block as is
              return block;
            }
          }
          return block;
        });

        // Store this response for future messages
        lastAssistantMessage = {
          role: 'assistant',
          content: finalResponse,
        };

        // Store in memory system for future context
        await this.storeMemory(issue.id, 'conversation', lastAssistantMessage);

        // Log thinking blocks
        const thinkingBlocks = finalResponse.filter(
          (block) =>
            block &&
            (block.type === 'thinking' || block.type === 'redacted_thinking')
        );

        if (thinkingBlocks.length > 0) {
          console.log(
            `\n[Thinking Blocks] Found ${thinkingBlocks.length} thinking blocks:`
          );
          thinkingBlocks.forEach((block, index) => {
            if (block.type === 'thinking') {
              console.log(`\n--- Thinking Block ${index + 1} ---`);
              console.log(block.thinking);
            } else if (block.type === 'redacted_thinking') {
              console.log(`\n--- Redacted Thinking Block ${index + 1} ---`);
              console.log('(Content redacted for safety reasons)');
            }
          });
        }

        // Add to conversation history
        messages.push(lastAssistantMessage);

        // Extract tool use blocks
        const toolUseBlocks = finalResponse.filter(
          (block) => block && block.type === 'tool_use'
        );

        // Log tool use blocks
        if (toolUseBlocks.length > 0) {
          console.log(
            `\n[Tool Use] Found ${toolUseBlocks.length} tool use blocks:`
          );
          toolUseBlocks.forEach((block, index) => {
            console.log(`\n--- Tool Use ${index + 1} ---`);
            console.log(`Tool: ${block.name}`);
            console.log(`Input: ${JSON.stringify(block.input, null, 2)}`);
          });
        }

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
                toolResponse = await this.editFile(
                  toolInput.repository,
                  toolInput.path,
                  toolInput.branch,
                  toolInput.commitMessage,
                  toolInput.edits,
                  toolInput.createBranchIfNeeded,
                  toolInput.baseBranch
                );
                toolSuccess = true;
              } else if (toolName === 'replaceInFile') {
                toolResponse = await this.replaceInFile(
                  toolInput.repository,
                  toolInput.path,
                  toolInput.branch,
                  toolInput.commitMessage,
                  toolInput.replacements,
                  toolInput.createBranchIfNeeded,
                  toolInput.baseBranch
                );
                toolSuccess = true;
              } else if (toolName === 'searchCodeFiles') {
                const results = await this.localRepoManager.searchCode(
                  toolInput.query,
                  toolInput.repository,
                  {
                    contextAware: toolInput.contextAware,
                    semanticBoost: toolInput.semanticBoost,
                    fileFilter: toolInput.fileFilter || '',
                    maxResults: toolInput.maxResults || 5,
                  }
                );

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
                  formattedResults += `Line ${result.line}: ${result.content}\n`;

                  // Include context information if available
                  if (result.context) {
                    formattedResults += `Context: ${result.context}\n`;
                  }

                  formattedResults += '\n';
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
                          await this.storeCodeKnowledge(
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
              } else if (toolName === 'getDirectoryStructure') {
                const directoryStructure =
                  await this.localRepoManager.getDirectoryStructure(
                    toolInput.repository,
                    toolInput.path
                  );

                // Format the directory structure as a string
                let formattedStructure = `Directory structure for ${
                  toolInput.path || 'root'
                } in ${toolInput.repository}:\n\n`;

                // Add each file/directory to the response
                directoryStructure.forEach((item) => {
                  const icon = item.type === 'dir' ? '📁' : '📄';
                  const size = item.size
                    ? ` (${Math.round(item.size / 1024)}KB)`
                    : '';
                  formattedStructure += `${icon} ${item.path}${size}\n`;
                });

                toolResponse = formattedStructure;
                toolSuccess = true;
              } else if (toolName === 'getFileContent') {
                const content = await this.localRepoManager.getFileContent(
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
                const pullRequest = await this.localRepoManager.getPullRequest(
                  toolInput.repository,
                  toolInput.pullNumber
                );
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
                await this.updateIssueStatus(
                  toolInput.issueId,
                  toolInput.status
                );
                toolResponse = `Successfully updated status of issue ${toolInput.issueId} to "${toolInput.status}".`;
                toolSuccess = true;
              } else if (toolName === 'addLabel') {
                await this.addLabel(toolInput.issueId, toolInput.label);
                toolResponse = `Successfully added label "${toolInput.label}" to issue ${toolInput.issueId}.`;
                toolSuccess = true;
              } else if (toolName === 'removeLabel') {
                await this.removeLabel(toolInput.issueId, toolInput.label);
                toolResponse = `Successfully removed label "${toolInput.label}" from issue ${toolInput.issueId}.`;
                toolSuccess = true;
              } else if (toolName === 'assignIssue') {
                await this.assignIssue(
                  toolInput.issueId,
                  toolInput.assigneeEmail
                );
                toolResponse = `Successfully assigned issue ${toolInput.issueId} to ${toolInput.assigneeEmail}.`;
                toolSuccess = true;
              } else if (toolName === 'createIssue') {
                await this.createIssue(
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
                await this.addIssueAttachment(
                  toolInput.issueId,
                  toolInput.url,
                  toolInput.title
                );
                toolResponse = `Successfully added attachment "${toolInput.title}" to issue ${toolInput.issueId}.`;
                toolSuccess = true;
              } else if (toolName === 'updateIssuePriority') {
                await this.updateIssuePriority(
                  toolInput.issueId,
                  toolInput.priority
                );
                toolResponse = `Successfully updated priority of issue ${toolInput.issueId} to ${toolInput.priority}.`;
                toolSuccess = true;
              } else if (toolName === 'createPullRequest') {
                // Check if branch is main or master - reject if so
                const branchCheck = this.isProtectedBranch(toolInput.branch);
                if (branchCheck.isProtected) {
                  toolResponse = branchCheck.errorMessage as string;
                  toolSuccess = false;
                } else {
                  // Create a branch
                  await this.localRepoManager.createBranch(
                    toolInput.branch,
                    toolInput.repository,
                    toolInput.baseBranch || 'main'
                  );

                  // Apply each change
                  for (const change of toolInput.changes) {
                    await this.localRepoManager.createOrUpdateFile(
                      change.path,
                      change.content,
                      `Update ${change.path} for PR`,
                      toolInput.repository,
                      toolInput.branch
                    );
                  }

                  // Create pull request
                  const pullRequest =
                    await this.localRepoManager.createPullRequest(
                      toolInput.title,
                      toolInput.description,
                      toolInput.branch,
                      toolInput.baseBranch || 'main',
                      toolInput.repository
                    );

                  toolResponse = `Successfully created pull request: ${pullRequest.url}`;
                  toolSuccess = true;
                }
              } else if (toolName === 'createBranchWithChanges') {
                // Check if branch is main or master - reject if so
                const branchCheck = this.isProtectedBranch(toolInput.branch);
                if (branchCheck.isProtected) {
                  toolResponse = branchCheck.errorMessage as string;
                  toolSuccess = false;
                } else {
                  // Create branch only if skipBranchCreation is not true
                  if (!toolInput.skipBranchCreation) {
                    try {
                      await this.localRepoManager.createBranch(
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
                    await this.localRepoManager.createOrUpdateFile(
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
                  await this.storeRelationship(
                    'issue:branch',
                    issue.id,
                    `${toolInput.repository}:${toolInput.branch}`
                  );
                }
              } else if (toolName === 'setPointEstimate') {
                await this.setPointEstimate(
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
              await this.trackToolUsage(toolName, toolSuccess, {
                issueId: issue.id,
                input: toolInput,
                response: toolResponse,
              });

              // Store relevant relationships
              if (toolName === 'getFileContent' && toolSuccess) {
                await this.storeRelationship(
                  'issue:file',
                  issue.id,
                  `${toolInput.repository}:${toolInput.path}`
                );
              } else if (toolName === 'createPullRequest' && toolSuccess) {
                await this.storeRelationship(
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
                          await this.storeCodeKnowledge(
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
              await this.trackToolUsage(toolName, false, {
                issueId: issue.id,
                input: toolInput,
                response: toolResponse,
              });
            }

            // Add tool response to conversation
            messages.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolId,
                  content: toolResponse,
                },
              ] as any,
            });

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

  /**
   * Get the context for an issue including comments, child issues, and parent issue
   */
  private async getIssueContext(
    issue: Issue,
    commentId?: string
  ): Promise<string> {
    // Mark this as the assigned issue
    let context = `>>>>> ASSIGNED/TAGGED ISSUE <<<<<\n`;
    context += `ISSUE ${issue.identifier}: ${issue.title}\n`;
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

    // Get parent issue if this is a child issue
    try {
      const parent = await issue.parent;
      if (parent) {
        context += `\n----- PARENT ISSUE (Context Only) -----\n`;
        context += `ISSUE ${parent.identifier}: ${parent.title}\n`;
        context += `DESCRIPTION: ${
          parent.description || 'No description provided'
        }\n`;

        // Add parent issue labels
        const parentLabels = await parent.labels();
        if (parentLabels.nodes.length > 0) {
          const labelNames = parentLabels.nodes.map((l) => l.name).join(', ');
          context += `LABELS: ${labelNames}\n`;
        }
      }
    } catch (error) {
      console.error('Error getting parent issue:', error);
    }

    // Get child issues if any
    try {
      const children = await issue.children();
      if (children.nodes.length > 0) {
        context += `\n----- CHILD ISSUES (Context Only) -----\n`;

        for (const child of children.nodes) {
          context += `ISSUE ${child.identifier}: ${child.title}\n`;

          // Add status information for child issues
          const state = await child.state;
          if (state) {
            context += `STATUS: ${state.name}\n`;
          }

          // Add brief description (first 100 chars)
          if (child.description) {
            const briefDesc =
              child.description.length > 100
                ? `${child.description.substring(0, 100)}...`
                : child.description;
            context += `BRIEF: ${briefDesc}\n`;
          }

          context += `\n`;
        }
      }
    } catch (error) {
      console.error('Error getting child issues:', error);
    }

    return context;
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
   * Set the point estimate for a Linear issue
   */
  private async setPointEstimate(
    issueIdOrIdentifier: string,
    pointEstimate: number
  ): Promise<void> {
    try {
      // Get the issue
      const issue = await this.linearClient.issue(issueIdOrIdentifier);
      if (!issue) {
        console.error(`Issue ${issueIdOrIdentifier} not found`);
        return;
      }

      // Update the issue with the new estimate
      await issue.update({ estimate: pointEstimate });

      console.log(
        `Updated issue ${issueIdOrIdentifier} point estimate to ${pointEstimate}`
      );

      // Add a comment to indicate the change
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `I've updated the point estimate to ${pointEstimate} points.`,
      });
    } catch (error: unknown) {
      console.error(
        `Error setting point estimate for issue ${issueIdOrIdentifier}:`,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  private async editFile(
    repository: string,
    path: string,
    branch: string,
    commitMessage: string,
    edits: any[],
    createBranchIfNeeded: boolean = true,
    baseBranch: string = 'main'
  ): Promise<string> {
    try {
      // Check if branch is protected
      const branchCheck = this.isProtectedBranch(branch);
      if (branchCheck.isProtected) {
        return branchCheck.errorMessage as string;
      }

      // Create branch if needed
      if (createBranchIfNeeded) {
        try {
          await this.localRepoManager.createBranch(
            branch,
            repository,
            baseBranch
          );
          console.log(`Created new branch ${branch} in ${repository}`);
        } catch (error: any) {
          // Branch might already exist, which is fine
          console.log(
            `Note: Branch ${branch} may already exist: ${error.message}`
          );
        }
      }

      // Get the current file content
      const fileContentResult = await this.localRepoManager.getFileContent(
        path,
        repository,
        1, // startLine
        10000, // maxLines - large number to get entire file
        branch // Use the specified branch
      );

      // Split content into lines for processing
      let contentLines = fileContentResult.split('\n');
      const totalLines = contentLines.length;

      console.log(`File ${path} has ${totalLines} lines`);

      // Apply each edit in order
      for (const edit of edits) {
        const { type, startLine, endLine, content } = edit;

        // Validate line numbers
        if (startLine < 1 || startLine > totalLines + 1) {
          throw new Error(
            `Invalid startLine: ${startLine}. File has ${totalLines} lines.`
          );
        }

        // For operations that use endLine, validate it
        if (['delete', 'replace', 'update'].includes(type) && endLine) {
          if (endLine < startLine || endLine > totalLines) {
            throw new Error(
              `Invalid endLine: ${endLine}. File has ${totalLines} lines.`
            );
          }
        }

        // Apply the appropriate edit operation
        switch (type) {
          case 'insert':
            // Insert content at startLine (1-based index)
            const insertIdx = startLine - 1;
            const newContentLines = content.split('\n');
            contentLines.splice(insertIdx, 0, ...newContentLines);
            console.log(
              `Inserted ${newContentLines.length} lines at line ${startLine}`
            );
            break;

          case 'delete':
            // Delete lines from startLine to endLine inclusive
            const deleteCount = (endLine || startLine) - startLine + 1;
            contentLines.splice(startLine - 1, deleteCount);
            console.log(
              `Deleted ${deleteCount} lines starting at line ${startLine}`
            );
            break;

          case 'replace':
            // Replace lines from startLine to endLine with new content
            const replaceCount = (endLine || startLine) - startLine + 1;
            const replaceContentLines = content.split('\n');
            contentLines.splice(
              startLine - 1,
              replaceCount,
              ...replaceContentLines
            );
            console.log(
              `Replaced ${replaceCount} lines with ${replaceContentLines.length} lines starting at line ${startLine}`
            );
            break;

          case 'update':
            // Update specific lines while keeping the original line count
            // This is similar to replace but ensures the same number of lines
            const updateStart = startLine - 1;
            const updateEnd = endLine ? endLine - 1 : updateStart;
            const updateCount = updateEnd - updateStart + 1;
            const updateContentLines = content.split('\n');

            // Check if we're trying to update with a different number of lines
            if (updateContentLines.length !== updateCount) {
              console.log(
                `Warning: Update operation provided ${updateContentLines.length} lines but is replacing ${updateCount} lines. This might result in unexpected behavior.`
              );
            }

            contentLines.splice(
              updateStart,
              updateCount,
              ...updateContentLines
            );
            console.log(
              `Updated ${updateCount} lines starting at line ${startLine}`
            );
            break;

          default:
            throw new Error(`Unknown edit type: ${type}`);
        }
      }

      // Join the lines back together
      const newContent = contentLines.join('\n');

      // Update the file in the repository
      await this.localRepoManager.createOrUpdateFile(
        path,
        newContent,
        commitMessage,
        repository,
        branch
      );

      // Store relationship between issue and branch, assuming this is called in an issue context
      if (edits.length > 0) {
        const issueId = this.getCurrentIssueId();
        if (issueId) {
          await this.storeRelationship(
            'issue:branch',
            issueId,
            `${repository}:${branch}`
          );
        }
      }

      return `Successfully applied ${edits.length} edits to ${path} on branch ${branch} in ${repository}`;
    } catch (error) {
      console.error(`Error editing file ${path}:`, error);
      return `Error editing file: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
    }
  }

  private async replaceInFile(
    repository: string,
    path: string,
    branch: string,
    commitMessage: string,
    replacements: any[],
    createBranchIfNeeded: boolean = true,
    baseBranch: string = 'main'
  ): Promise<string> {
    try {
      // Check if branch is protected
      const branchCheck = this.isProtectedBranch(branch);
      if (branchCheck.isProtected) {
        return branchCheck.errorMessage as string;
      }

      // Create branch if needed
      if (createBranchIfNeeded) {
        try {
          await this.localRepoManager.createBranch(
            branch,
            repository,
            baseBranch
          );
          console.log(`Created new branch ${branch} in ${repository}`);
        } catch (error: any) {
          // Branch might already exist, which is fine
          console.log(
            `Note: Branch ${branch} may already exist: ${error.message}`
          );
        }
      }

      // Get the current file content
      const fileContentResult = await this.localRepoManager.getFileContent(
        path,
        repository,
        1, // startLine
        10000, // maxLines - large number to get entire file
        branch // Use the specified branch
      );

      // Apply each replacement in order
      let fileContent = fileContentResult;
      let changesCount = 0;

      for (const replacement of replacements) {
        const { find, replace, regex = false, global = true } = replacement;

        if (regex) {
          // Handle regex replacement
          try {
            // Create flags for regex (global and case-sensitive by default)
            const flags = global ? 'g' : '';
            const pattern = new RegExp(find, flags);

            // Count occurrences before replacement
            const occurrences = (fileContent.match(pattern) || []).length;

            // Perform the replacement
            fileContent = fileContent.replace(pattern, replace);

            changesCount += occurrences;
            console.log(
              `Replaced ${occurrences} occurrences using regex pattern: ${find}`
            );
          } catch (regexError) {
            console.error(`Invalid regex pattern: ${find}`, regexError);
            return `Error: Invalid regex pattern '${find}': ${
              regexError instanceof Error ? regexError.message : 'Unknown error'
            }`;
          }
        } else {
          // Handle literal string replacement
          if (global) {
            // Count occurrences before replacement
            let count = 0;
            let tempContent = fileContent;
            let index = tempContent.indexOf(find);

            while (index !== -1) {
              count++;
              tempContent = tempContent.substring(index + find.length);
              index = tempContent.indexOf(find);
            }

            // Perform global replacement
            fileContent = fileContent.split(find).join(replace);
            changesCount += count;
            console.log(
              `Replaced ${count} occurrences of literal string: ${find}`
            );
          } else {
            // Replace only the first occurrence
            const index = fileContent.indexOf(find);
            if (index !== -1) {
              fileContent =
                fileContent.substring(0, index) +
                replace +
                fileContent.substring(index + find.length);
              changesCount++;
              console.log(
                `Replaced first occurrence of literal string: ${find}`
              );
            }
          }
        }
      }

      // Only update if changes were made
      if (changesCount > 0) {
        // Update the file in the repository
        await this.localRepoManager.createOrUpdateFile(
          path,
          fileContent,
          commitMessage,
          repository,
          branch
        );

        // Store relationship between issue and branch, assuming this is called in an issue context
        const issueId = this.getCurrentIssueId();
        if (issueId) {
          await this.storeRelationship(
            'issue:branch',
            issueId,
            `${repository}:${branch}`
          );
        }

        return `Successfully made ${changesCount} replacements in ${path} on branch ${branch} in ${repository}`;
      } else {
        return `No changes were made to ${path}. The patterns specified were not found.`;
      }
    } catch (error) {
      console.error(`Error replacing text in file ${path}:`, error);
      return `Error replacing text in file: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
    }
  }

  // Helper method to get the current issue ID
  private getCurrentIssueId(): string | null {
    try {
      // Try to get issue ID from the current context
      // This assumes we're in the processNotification method with an issue context
      return this._currentIssueId || null;
    } catch {
      return null;
    }
  }
}
