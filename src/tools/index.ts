/**
 * Tool definitions for Claude to use within Otron
 */
export function getToolDefinitions() {
  // Return an array of tools that Claude can use
  return [
    {
      name: 'devAgent',
      description:
        'Delegate a technical task to the developer agent for code research, implementation, or technical analysis',
      input_schema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description:
              'A clear description of the technical task to delegate to the dev agent',
          },
        },
        required: ['task'],
      },
    },
    {
      name: 'linearAgent',
      description:
        'Delegate a product management or Linear-related task to the Linear agent for issue management',
      input_schema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description:
              'A clear description of the product management task to delegate to the Linear agent',
          },
        },
        required: ['task'],
      },
    },
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
                  description: 'Starting line number for the edit (1-based)',
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
        required: ['repository', 'path', 'branch', 'commitMessage', 'edits'],
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
            description: 'Repository containing the file (owner/repo format)',
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
        required: ['repository', 'title', 'description', 'branch', 'changes'],
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
}
