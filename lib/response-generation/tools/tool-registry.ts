import { tool } from 'ai';
import { z } from 'zod';
import {
  // Exa search tools
  executeExaSearch,
  executeExaCrawlContent,
  executeExaFindSimilar,
} from '../../exa/exa-utils.js';
import {
  // New line-based file editing tools
  executeReplaceLines,
  executeInsertLines,
  executeDeleteLines,
} from '../../file-editing-tools.js';
import {
  // Linear tools
  executeGetIssueContext,
  executeUpdateIssueStatus,
  executeAddLabel,
  executeRemoveLabel,
  executeAssignIssue,
  executeCreateIssue,
  executeAddIssueAttachment,
  executeUpdateIssuePriority,
  executeSetPointEstimate,
  executeGetLinearTeams,
  executeGetLinearProjects,
  executeGetLinearInitiatives,
  executeGetLinearUsers,
  executeGetLinearRecentIssues,
  executeSearchLinearIssues,
  executeGetLinearWorkflowStates,
  executeCreateLinearComment,
  executeCreateAgentActivity,
  executeSetIssueParent,
  executeAddIssueToProject,
} from '../../linear-tools.js';
import {
  // Slack tools
  executeSendSlackMessage,
  executeSendDirectMessage,
  executeSendChannelMessage,
  executeAddSlackReaction,
  executeRemoveSlackReaction,
  executeGetSlackChannelHistory,
  executeGetSlackThread,
  executeUpdateSlackMessage,
  executeDeleteSlackMessage,
  executeGetSlackUserInfo,
  executeGetSlackChannelInfo,
  executeJoinSlackChannel,
  executeSetSlackStatus,
  executePinSlackMessage,
  executeUnpinSlackMessage,
  executeSendRichSlackMessage,
  executeSendRichChannelMessage,
  executeSendRichDirectMessage,
  executeCreateFormattedSlackMessage,
  executeRespondToSlackInteraction,
} from '../../slack-tools.js';
import {
  // GitHub tools
  executeGetFileContent,
  executeCreateBranch,
  executeCreatePullRequest,
  executeGetPullRequest,
  executeAddPullRequestComment,
  executeGetPullRequestFiles,
  executeGetDirectoryStructure,
  executeGetRepositoryStructure,
  executeDeleteFile,
  executeCreateFile,
  // GitHub branch management tools
  executeResetBranchToHead,
  // GitHub file reading tools
  executeGetRawFileContent,
  executeReadRelatedFiles,
  // Embedded repository tools
  executeSearchEmbeddedCode,
} from '../../tool-executors.js';

/**
 * Create tool definitions wrapped with the memory-aware executor
 */
export function createToolRegistry(
  createMemoryAwareToolExecutor: (
    toolName: string,
    executor: Function
  ) => Function,
  updateStatus?: (status: string) => void
) {
  return {
    // === WEB SEARCH AND RESEARCH TOOLS ===

    // Enhanced Exa Web Search, Answer, and Research Tools
    exaSearch: tool({
      description:
        'Comprehensive web search, answer generation, and research using Exa AI. Supports three modes: search (find web content), answer (get AI-powered answers with sources), and research (comprehensive analysis). This is the primary tool for web-based information gathering.',
      parameters: z.object({
        query: z.string().describe('The search query or question to ask'),
        mode: z
          .enum(['search', 'answer', 'research'])
          .describe(
            'Mode: "search" for finding web content, "answer" for AI-powered answers with sources, "research" for comprehensive analysis with multiple sources'
          ),
        numResults: z
          .number()
          .describe(
            'Number of results to return (default: 5 for search/answer, 10 for research). Use 5 if not specified.'
          ),
        includeContent: z
          .boolean()
          .describe(
            'Whether to include full content/text from sources (default: true for research, false for search). Use true for research mode.'
          ),
        livecrawl: z
          .enum(['always', 'never', 'when-necessary'])
          .describe(
            'Live crawling behavior: "always" for fresh content, "never" for cached only, "when-necessary" for smart crawling (default). Use "when-necessary" if not specified.'
          ),
        timeRange: z
          .string()
          .describe(
            'Optional time filter for content age: "day", "week", "month", "year". Leave empty for no time restriction.'
          ),
        domainFilter: z
          .string()
          .describe(
            'Optional domain to restrict search to (e.g., "github.com"). Leave empty for all domains.'
          ),
        fileType: z
          .string()
          .describe(
            'Optional file type filter (e.g., "pdf", "doc"). Leave empty for all file types.'
          ),
      }),
      execute: createMemoryAwareToolExecutor(
        'exaSearch',
        executeExaSearch
      ) as any,
    }),

    // Exa content crawling tool
    exaCrawlContent: tool({
      description:
        'Crawl and retrieve full content from specific URLs. Use this when you need the complete text content from web pages found through search.',
      parameters: z.object({
        urls: z
          .array(z.string())
          .describe('Array of URLs to crawl for content'),
      }),
      execute: createMemoryAwareToolExecutor(
        'exaCrawlContent',
        executeExaCrawlContent
      ) as any,
    }),

    // Exa find similar content tool
    exaFindSimilar: tool({
      description:
        'Find content similar to a given URL or topic. Useful for finding related articles, documentation, or resources.',
      parameters: z.object({
        url: z.string().describe('Reference URL to find similar content for'),
        numResults: z
          .number()
          .describe('Number of similar results to return (default: 5)'),
        includeContent: z
          .boolean()
          .describe('Whether to include full content from similar pages'),
      }),
      execute: createMemoryAwareToolExecutor(
        'exaFindSimilar',
        executeExaFindSimilar
      ) as any,
    }),

    // === REPOSITORY AND CODE TOOLS ===

    // Enhanced embedded code search with repository intelligence
    searchEmbeddedCode: tool({
      description:
        'Search for code across all embedded repositories using semantic search. This searches through code, comments, documentation, and README files to find relevant content. Perfect for understanding codebases, finding implementations, or locating specific functionality.',
      parameters: z.object({
        query: z
          .string()
          .describe(
            'Detailed search query describing what code/functionality you are looking for. Be specific about the language, framework, or type of code if relevant.'
          ),
        repository: z
          .string()
          .describe(
            'Repository name in "owner/repo" format to search within. If not specified, searches across all embedded repositories.'
          ),
        limit: z
          .number()
          .describe('Maximum number of results to return (default: 10)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'searchEmbeddedCode',
        executeSearchEmbeddedCode
      ) as any,
    }),

    // GitHub file content reader
    getFileContent: tool({
      description:
        'Get the contents of a file from a GitHub repository with enhanced context and metadata. Returns file content with line numbers, file info, and related context.',
      parameters: z.object({
        file_path: z.string().describe('The file path in the repository'),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch: z
          .string()
          .optional()
          .describe('Branch to read from (defaults to main/master)'),
        startLine: z
          .number()
          .optional()
          .describe(
            'Starting line number (1-indexed). Use 0 to get file info only without content.'
          ),
        endLine: z
          .number()
          .optional()
          .describe(
            'Ending line number (1-indexed, inclusive). If not provided, returns from startLine to end. Max 200 lines per request.'
          ),
      }),
      execute: createMemoryAwareToolExecutor('getFileContent', (params: any) =>
        executeGetFileContent(params, updateStatus)
      ) as any,
    }),

    // Raw file content reader (for editing)
    getRawFileContent: tool({
      description:
        'Get raw file content specifically for editing purposes. Returns unformatted content suitable for precise code editing. Use this before making edits to get exact content.',
      parameters: z.object({
        file_path: z.string().describe('The file path in the repository'),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch: z
          .string()
          .describe(
            'Branch to read from (required - specify the exact branch name)'
          ),
        should_read_entire_file: z
          .boolean()
          .describe(
            'Whether to read the entire file (up to 1500 lines) or a specific range'
          ),
        start_line_one_indexed: z
          .number()
          .optional()
          .describe(
            'Starting line number (1-indexed). Required if should_read_entire_file is false.'
          ),
        end_line_one_indexed_inclusive: z
          .number()
          .optional()
          .describe(
            'Ending line number (1-indexed, inclusive). Required if should_read_entire_file is false. Max 200 lines per range.'
          ),
      }),
      execute: createMemoryAwareToolExecutor(
        'getRawFileContent',
        executeGetRawFileContent
      ) as any,
    }),

    // Read related files
    readRelatedFiles: tool({
      description:
        'Intelligently read multiple related files in a repository based on a main file. Discovers and reads imports, dependencies, tests, and other related files.',
      parameters: z.object({
        file_path: z.string().describe('The main file to analyze'),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch: z
          .string()
          .optional()
          .describe('Branch to read from (defaults to main/master)'),
        depth: z
          .number()
          .optional()
          .describe(
            'How deep to go in discovering related files (1-3, default: 2)'
          ),
      }),
      execute: createMemoryAwareToolExecutor(
        'readRelatedFiles',
        executeReadRelatedFiles
      ) as any,
    }),

    // Repository structure analyzer
    getRepositoryStructure: tool({
      description:
        'Get an overview of the repository structure, including key directories, file types, and architecture patterns. Useful for understanding a codebase layout.',
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch: z
          .string()
          .optional()
          .describe('Branch to analyze (defaults to main/master)'),
        maxDepth: z
          .number()
          .optional()
          .describe('Maximum directory depth to analyze (default: 3)'),
        includeFileTypes: z
          .boolean()
          .optional()
          .describe('Whether to include file type analysis (default: true)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getRepositoryStructure',
        executeGetRepositoryStructure
      ) as any,
    }),

    // Directory structure analyzer
    getDirectoryStructure: tool({
      description:
        'Get detailed structure of a specific directory in a repository, showing files and subdirectories with metadata.',
      parameters: z.object({
        directory_path: z
          .string()
          .describe('The directory path to analyze (e.g., "src", "lib/utils")'),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch: z
          .string()
          .optional()
          .describe('Branch to analyze (defaults to main/master)'),
        includeHidden: z
          .boolean()
          .optional()
          .describe(
            'Whether to include hidden files/directories (default: false)'
          ),
      }),
      execute: createMemoryAwareToolExecutor(
        'getDirectoryStructure',
        executeGetDirectoryStructure
      ) as any,
    }),

    // === FILE EDITING TOOLS ===

    // Create new file
    createFile: tool({
      description:
        'Create a new file in a GitHub repository with the specified content.',
      parameters: z.object({
        file_path: z.string().describe('The file path to create'),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch: z
          .string()
          .describe(
            'Branch to create file in (required - specify the exact branch name)'
          ),
        content: z.string().describe('The file content'),
        commit_message: z.string().describe('Commit message for the change'),
      }),
      execute: createMemoryAwareToolExecutor('createFile', (params: any) =>
        executeCreateFile(params, updateStatus)
      ) as any,
    }),

    // Delete file
    deleteFile: tool({
      description:
        'Delete a file from a GitHub repository. Use with caution as this is irreversible.',
      parameters: z.object({
        file_path: z.string().describe('The file path to delete'),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch: z
          .string()
          .describe(
            'Branch to delete file from (required - specify the exact branch name)'
          ),
        commit_message: z.string().describe('Commit message for the deletion'),
      }),
      execute: createMemoryAwareToolExecutor('deleteFile', (params: any) =>
        executeDeleteFile(params, updateStatus)
      ) as any,
    }),

    // === GITHUB BRANCH AND PR TOOLS ===

    // Create branch
    createBranch: tool({
      description:
        'Create a new branch in a GitHub repository. If the branch already exists, it will be reset to match the base branch.',
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch_name: z.string().describe('Name of the new branch to create'),
        base_branch: z
          .string()
          .optional()
          .describe('Base branch to create from (defaults to main/master)'),
      }),
      execute: createMemoryAwareToolExecutor('createBranch', (params: any) =>
        executeCreateBranch(params, updateStatus)
      ) as any,
    }),

    // Reset branch to head
    resetBranchToHead: tool({
      description:
        'Reset a branch to match the HEAD of the base branch, discarding any changes. Use this to clean up a branch before making new changes.',
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch_name: z.string().describe('Name of the branch to reset'),
        base_branch: z
          .string()
          .optional()
          .describe('Base branch to reset to (defaults to main/master)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'resetBranchToHead',
        executeResetBranchToHead
      ) as any,
    }),

    // Create pull request
    createPullRequest: tool({
      description:
        'Create a new pull request in a GitHub repository. Make sure you have committed changes to the source branch first.',
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        source_branch: z
          .string()
          .describe('The branch with your changes (head branch)'),
        target_branch: z
          .string()
          .optional()
          .describe('The branch to merge into (defaults to main/master)'),
        title: z.string().describe('Pull request title'),
        description: z.string().describe('Pull request description'),
        draft: z
          .boolean()
          .optional()
          .describe('Whether to create as a draft PR (default: false)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'createPullRequest',
        (params: any) => executeCreatePullRequest(params, updateStatus)
      ) as any,
    }),

    // Get pull request details
    getPullRequest: tool({
      description:
        'Get details about a specific pull request, including status, files changed, and comments.',
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        pull_number: z.number().describe('The pull request number'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getPullRequest',
        executeGetPullRequest
      ) as any,
    }),

    // Add pull request comment
    addPullRequestComment: tool({
      description:
        'Add a comment to a pull request. Useful for providing feedback or additional context.',
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        pull_number: z.number().describe('The pull request number'),
        comment: z.string().describe('The comment text'),
      }),
      execute: createMemoryAwareToolExecutor(
        'addPullRequestComment',
        executeAddPullRequestComment
      ) as any,
    }),

    // Get pull request files
    getPullRequestFiles: tool({
      description:
        'Get the list of files changed in a pull request with their modifications.',
      parameters: z.object({
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        pull_number: z.number().describe('The pull request number'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getPullRequestFiles',
        executeGetPullRequestFiles
      ) as any,
    }),

    // === LINEAR TOOLS ===

    // Get Linear issue context
    getIssueContext: tool({
      description:
        'Get comprehensive context for a Linear issue including description, comments, labels, assignees, and related issues.',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getIssueContext',
        executeGetIssueContext
      ) as any,
    }),

    // Update Linear issue status
    updateIssueStatus: tool({
      description:
        'Update the status/state of a Linear issue (e.g., "In Progress", "Done", "Backlog").',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        status: z
          .string()
          .describe(
            'The new status name (e.g., "In Progress", "Done", "Backlog", "Todo")'
          ),
      }),
      execute: createMemoryAwareToolExecutor(
        'updateIssueStatus',
        executeUpdateIssueStatus
      ) as any,
    }),

    // Add label to Linear issue
    addLabel: tool({
      description: 'Add a label to a Linear issue.',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        labelName: z.string().describe('The label name to add'),
      }),
      execute: createMemoryAwareToolExecutor(
        'addLabel',
        executeAddLabel
      ) as any,
    }),

    // Remove label from Linear issue
    removeLabel: tool({
      description: 'Remove a label from a Linear issue.',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        labelName: z.string().describe('The label name to remove'),
      }),
      execute: createMemoryAwareToolExecutor(
        'removeLabel',
        executeRemoveLabel
      ) as any,
    }),

    // Assign Linear issue
    assignIssue: tool({
      description: 'Assign a Linear issue to a team member.',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        assigneeEmail: z
          .string()
          .describe('Email address of the person to assign the issue to'),
      }),
      execute: createMemoryAwareToolExecutor(
        'assignIssue',
        executeAssignIssue
      ) as any,
    }),

    // Create Linear issue
    createIssue: tool({
      description: 'Create a new Linear issue with title and description.',
      parameters: z.object({
        title: z.string().describe('The issue title'),
        description: z.string().describe('The issue description'),
        teamName: z
          .string()
          .optional()
          .describe(
            'The team name (optional, will use default team if not specified)'
          ),
        priority: z
          .enum(['No priority', 'Low', 'Medium', 'High', 'Urgent'])
          .optional()
          .describe('Issue priority level'),
        labels: z
          .array(z.string())
          .optional()
          .describe('Array of label names to add to the issue'),
      }),
      execute: createMemoryAwareToolExecutor(
        'createIssue',
        executeCreateIssue
      ) as any,
    }),

    // Add attachment to Linear issue
    addIssueAttachment: tool({
      description:
        'Add an attachment (like a screenshot or file) to a Linear issue.',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        url: z.string().describe('URL of the attachment'),
        title: z.string().describe('Title/name of the attachment'),
      }),
      execute: createMemoryAwareToolExecutor(
        'addIssueAttachment',
        executeAddIssueAttachment
      ) as any,
    }),

    // Update Linear issue priority
    updateIssuePriority: tool({
      description: 'Update the priority level of a Linear issue.',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        priority: z
          .enum(['No priority', 'Low', 'Medium', 'High', 'Urgent'])
          .describe('New priority level'),
      }),
      execute: createMemoryAwareToolExecutor(
        'updateIssuePriority',
        executeUpdateIssuePriority
      ) as any,
    }),

    // Set point estimate for Linear issue
    setPointEstimate: tool({
      description: 'Set the point estimate (story points) for a Linear issue.',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        estimate: z
          .number()
          .describe('Point estimate (usually 1, 2, 3, 5, 8, 13)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'setPointEstimate',
        executeSetPointEstimate
      ) as any,
    }),

    // Get Linear teams
    getLinearTeams: tool({
      description: 'Get a list of all Linear teams with their IDs and details.',
      parameters: z.object({}),
      execute: createMemoryAwareToolExecutor(
        'getLinearTeams',
        executeGetLinearTeams
      ) as any,
    }),

    // Get Linear projects
    getLinearProjects: tool({
      description:
        'Get a list of Linear projects with their IDs, names, and details.',
      parameters: z.object({
        teamName: z
          .string()
          .optional()
          .describe('Filter projects by team name (optional)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getLinearProjects',
        executeGetLinearProjects
      ) as any,
    }),

    // Get Linear initiatives
    getLinearInitiatives: tool({
      description:
        'Get a list of Linear initiatives with their IDs, names, and details.',
      parameters: z.object({}),
      execute: createMemoryAwareToolExecutor(
        'getLinearInitiatives',
        executeGetLinearInitiatives
      ) as any,
    }),

    // Get Linear users
    getLinearUsers: tool({
      description:
        'Get a list of Linear users with their IDs, names, and email addresses.',
      parameters: z.object({}),
      execute: createMemoryAwareToolExecutor(
        'getLinearUsers',
        executeGetLinearUsers
      ) as any,
    }),

    // Get Linear recent issues
    getLinearRecentIssues: tool({
      description: 'Get a list of recent Linear issues with filtering options.',
      parameters: z.object({
        limit: z
          .number()
          .optional()
          .describe('Number of issues to return (default: 20)'),
        teamName: z
          .string()
          .optional()
          .describe('Filter by team name (optional)'),
        assigneeEmail: z
          .string()
          .optional()
          .describe('Filter by assignee email (optional)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getLinearRecentIssues',
        executeGetLinearRecentIssues
      ) as any,
    }),

    // Search Linear issues
    searchLinearIssues: tool({
      description:
        'Search Linear issues by text query across titles and descriptions.',
      parameters: z.object({
        query: z.string().describe('Search query for issues'),
        limit: z
          .number()
          .optional()
          .describe('Number of results to return (default: 10)'),
        teamName: z
          .string()
          .optional()
          .describe('Filter by team name (optional)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'searchLinearIssues',
        executeSearchLinearIssues
      ) as any,
    }),

    // Get Linear workflow states
    getLinearWorkflowStates: tool({
      description:
        'Get available workflow states for Linear issues (e.g., "Todo", "In Progress", "Done").',
      parameters: z.object({
        teamName: z
          .string()
          .optional()
          .describe('Filter by team name (optional)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getLinearWorkflowStates',
        executeGetLinearWorkflowStates
      ) as any,
    }),

    // Create Linear comment
    createLinearComment: tool({
      description: 'Add a comment to a Linear issue.',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        comment: z.string().describe('The comment text (supports Markdown)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'createLinearComment',
        executeCreateLinearComment
      ) as any,
    }),

    // Create agent activity
    createAgentActivity: tool({
      description:
        'Log agent activity or thoughts to a Linear issue for transparency.',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        activity: z.string().describe('Description of the agent activity'),
        type: z
          .enum(['thought', 'action', 'response'])
          .optional()
          .describe('Type of activity (default: "thought")'),
      }),
      execute: createMemoryAwareToolExecutor(
        'createAgentActivity',
        executeCreateAgentActivity
      ) as any,
    }),

    // Set issue parent
    setIssueParent: tool({
      description:
        'Set a parent issue for a Linear issue (create sub-issue relationship).',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        parentIssueId: z
          .string()
          .describe('The parent issue ID or identifier (e.g., "OTR-456")'),
      }),
      execute: createMemoryAwareToolExecutor(
        'setIssueParent',
        executeSetIssueParent
      ) as any,
    }),

    // Add issue to project
    addIssueToProject: tool({
      description: 'Add a Linear issue to a project.',
      parameters: z.object({
        issueId: z
          .string()
          .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
        projectName: z
          .string()
          .describe('The project name to add the issue to'),
      }),
      execute: createMemoryAwareToolExecutor(
        'addIssueToProject',
        executeAddIssueToProject
      ) as any,
    }),

    // === SLACK TOOLS ===

    // Send Slack message
    sendSlackMessage: tool({
      description:
        'Send a message to a Slack channel or user. Use for notifications, updates, or responses.',
      parameters: z.object({
        message: z.string().describe('The message text to send'),
        channel: z
          .string()
          .optional()
          .describe(
            'Channel ID or name (optional, uses current channel if not specified)'
          ),
        thread_ts: z
          .string()
          .optional()
          .describe('Thread timestamp to reply in thread (optional)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'sendSlackMessage',
        executeSendSlackMessage
      ) as any,
    }),

    // Send direct Slack message
    sendDirectMessage: tool({
      description: 'Send a direct message to a specific Slack user.',
      parameters: z.object({
        userId: z.string().describe('Slack user ID to send message to'),
        message: z.string().describe('The message text to send'),
      }),
      execute: createMemoryAwareToolExecutor(
        'sendDirectMessage',
        executeSendDirectMessage
      ) as any,
    }),

    // Send channel message
    sendChannelMessage: tool({
      description: 'Send a message to a specific Slack channel.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
        message: z.string().describe('The message text to send'),
        thread_ts: z
          .string()
          .optional()
          .describe('Thread timestamp to reply in thread (optional)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'sendChannelMessage',
        executeSendChannelMessage
      ) as any,
    }),

    // Add Slack reaction
    addSlackReaction: tool({
      description: 'Add a reaction emoji to a Slack message.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
        timestamp: z.string().describe('Message timestamp'),
        emoji: z
          .string()
          .describe('Emoji name (without colons, e.g., "thumbsup")'),
      }),
      execute: createMemoryAwareToolExecutor(
        'addSlackReaction',
        executeAddSlackReaction
      ) as any,
    }),

    // Remove Slack reaction
    removeSlackReaction: tool({
      description: 'Remove a reaction emoji from a Slack message.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
        timestamp: z.string().describe('Message timestamp'),
        emoji: z
          .string()
          .describe('Emoji name (without colons, e.g., "thumbsup")'),
      }),
      execute: createMemoryAwareToolExecutor(
        'removeSlackReaction',
        executeRemoveSlackReaction
      ) as any,
    }),

    // Get Slack channel history
    getSlackChannelHistory: tool({
      description: 'Get recent message history from a Slack channel.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
        limit: z
          .number()
          .optional()
          .describe('Number of messages to retrieve (default: 20)'),
        oldest: z
          .string()
          .optional()
          .describe('Oldest message timestamp to include'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getSlackChannelHistory',
        executeGetSlackChannelHistory
      ) as any,
    }),

    // Get Slack thread
    getSlackThread: tool({
      description: 'Get all messages in a Slack thread.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
        thread_ts: z.string().describe('Thread timestamp'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getSlackThread',
        executeGetSlackThread
      ) as any,
    }),

    // Update Slack message
    updateSlackMessage: tool({
      description: 'Update/edit an existing Slack message.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
        timestamp: z.string().describe('Message timestamp'),
        newText: z.string().describe('New message text'),
      }),
      execute: createMemoryAwareToolExecutor(
        'updateSlackMessage',
        executeUpdateSlackMessage
      ) as any,
    }),

    // Delete Slack message
    deleteSlackMessage: tool({
      description: 'Delete a Slack message.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
        timestamp: z.string().describe('Message timestamp'),
      }),
      execute: createMemoryAwareToolExecutor(
        'deleteSlackMessage',
        executeDeleteSlackMessage
      ) as any,
    }),

    // Get Slack user info
    getSlackUserInfo: tool({
      description: 'Get information about a Slack user.',
      parameters: z.object({
        userId: z.string().describe('Slack user ID'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getSlackUserInfo',
        executeGetSlackUserInfo
      ) as any,
    }),

    // Get Slack channel info
    getSlackChannelInfo: tool({
      description: 'Get information about a Slack channel.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
      }),
      execute: createMemoryAwareToolExecutor(
        'getSlackChannelInfo',
        executeGetSlackChannelInfo
      ) as any,
    }),

    // Join Slack channel
    joinSlackChannel: tool({
      description: 'Join a Slack channel.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID to join'),
      }),
      execute: createMemoryAwareToolExecutor(
        'joinSlackChannel',
        executeJoinSlackChannel
      ) as any,
    }),

    // Set Slack status
    setSlackStatus: tool({
      description: "Set the bot's Slack status message and emoji.",
      parameters: z.object({
        statusText: z.string().describe('Status message text'),
        statusEmoji: z
          .string()
          .optional()
          .describe('Status emoji (e.g., ":robot_face:")'),
      }),
      execute: createMemoryAwareToolExecutor(
        'setSlackStatus',
        executeSetSlackStatus
      ) as any,
    }),

    // Pin Slack message
    pinSlackMessage: tool({
      description: 'Pin a message in a Slack channel.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
        timestamp: z.string().describe('Message timestamp to pin'),
      }),
      execute: createMemoryAwareToolExecutor(
        'pinSlackMessage',
        executePinSlackMessage
      ) as any,
    }),

    // Unpin Slack message
    unpinSlackMessage: tool({
      description: 'Unpin a message in a Slack channel.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
        timestamp: z.string().describe('Message timestamp to unpin'),
      }),
      execute: createMemoryAwareToolExecutor(
        'unpinSlackMessage',
        executeUnpinSlackMessage
      ) as any,
    }),

    // Send rich Slack message
    sendRichSlackMessage: tool({
      description:
        'Send a rich formatted Slack message with blocks, attachments, or advanced formatting.',
      parameters: z.object({
        content: z.string().describe('Rich message content or blocks JSON'),
        channel: z
          .string()
          .optional()
          .describe(
            'Channel ID (optional, uses current channel if not specified)'
          ),
        thread_ts: z
          .string()
          .optional()
          .describe('Thread timestamp to reply in thread (optional)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'sendRichSlackMessage',
        executeSendRichSlackMessage
      ) as any,
    }),

    // Send rich channel message
    sendRichChannelMessage: tool({
      description: 'Send a rich formatted message to a specific Slack channel.',
      parameters: z.object({
        channelId: z.string().describe('Slack channel ID'),
        content: z.string().describe('Rich message content or blocks JSON'),
        thread_ts: z
          .string()
          .optional()
          .describe('Thread timestamp to reply in thread (optional)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'sendRichChannelMessage',
        executeSendRichChannelMessage
      ) as any,
    }),

    // Send rich direct message
    sendRichDirectMessage: tool({
      description: 'Send a rich formatted direct message to a Slack user.',
      parameters: z.object({
        userId: z.string().describe('Slack user ID'),
        content: z.string().describe('Rich message content or blocks JSON'),
      }),
      execute: createMemoryAwareToolExecutor(
        'sendRichDirectMessage',
        executeSendRichDirectMessage
      ) as any,
    }),

    // Create formatted Slack message
    createFormattedSlackMessage: tool({
      description:
        'Create a well-formatted Slack message with proper structure and styling.',
      parameters: z.object({
        title: z.string().describe('Message title'),
        content: z.string().describe('Main message content'),
        type: z
          .enum(['info', 'success', 'warning', 'error'])
          .optional()
          .describe('Message type for styling (optional)'),
        channel: z
          .string()
          .optional()
          .describe(
            'Channel ID (optional, uses current channel if not specified)'
          ),
      }),
      execute: createMemoryAwareToolExecutor(
        'createFormattedSlackMessage',
        executeCreateFormattedSlackMessage
      ) as any,
    }),

    // Respond to Slack interaction
    respondToSlackInteraction: tool({
      description:
        'Respond to a Slack interaction (button click, menu selection, etc.).',
      parameters: z.object({
        responseUrl: z.string().describe('Response URL from the interaction'),
        message: z.string().describe('Response message'),
        replace: z
          .boolean()
          .optional()
          .describe('Whether to replace the original message (default: false)'),
      }),
      execute: createMemoryAwareToolExecutor(
        'respondToSlackInteraction',
        executeRespondToSlackInteraction
      ) as any,
    }),

    // === LINE-BASED FILE EDITING TOOLS ===

    // Line-based replacement tool - replace specific line ranges
    replaceLines: tool({
      description:
        'Replace specific line ranges in a file with new content. Uses precise line numbers instead of unreliable context matching.',
      parameters: z.object({
        file_path: z.string().describe('The file path in the repository'),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch: z
          .string()
          .describe(
            'Branch to edit (required - specify the exact branch name)'
          ),
        start_line: z
          .number()
          .int()
          .min(1)
          .describe('First line to replace (1-indexed)'),
        end_line: z
          .number()
          .int()
          .min(1)
          .describe('Last line to replace (1-indexed, inclusive)'),
        new_content: z.string().describe('The new content to replace with'),
        commit_message: z.string().describe('Commit message for the change'),
      }),
      execute: createMemoryAwareToolExecutor('replaceLines', (params: any) =>
        executeReplaceLines(params, updateStatus)
      ) as any,
    }),

    // Line-based insertion tool - insert content at specific line numbers
    insertLines: tool({
      description:
        'Insert new content at a specific line number. Uses precise line positioning instead of unreliable context matching.',
      parameters: z.object({
        file_path: z.string().describe('The file path in the repository'),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch: z
          .string()
          .describe(
            'Branch to edit (required - specify the exact branch name)'
          ),
        line_number: z
          .number()
          .int()
          .min(1)
          .describe(
            'Line number where to insert content (1-indexed). Use 1 for start of file, or totalLines+1 for end of file'
          ),
        new_content: z.string().describe('The new content to insert'),
        commit_message: z.string().describe('Commit message for the change'),
      }),
      execute: createMemoryAwareToolExecutor('insertLines', (params: any) =>
        executeInsertLines(params, updateStatus)
      ) as any,
    }),

    // Line-based deletion tool - delete specific line ranges
    deleteLines: tool({
      description:
        'Delete specific line ranges from a file. Uses precise line numbers for safe, predictable deletion.',
      parameters: z.object({
        file_path: z.string().describe('The file path in the repository'),
        repository: z
          .string()
          .describe('The repository in format "owner/repo"'),
        branch: z
          .string()
          .describe(
            'Branch to edit (required - specify the exact branch name)'
          ),
        start_line: z
          .number()
          .int()
          .min(1)
          .describe('First line to delete (1-indexed)'),
        end_line: z
          .number()
          .int()
          .min(1)
          .describe('Last line to delete (1-indexed, inclusive)'),
        commit_message: z.string().describe('Commit message for the change'),
      }),
      execute: createMemoryAwareToolExecutor('deleteLines', (params: any) =>
        executeDeleteLines(params, updateStatus)
      ) as any,
    }),
  };
}
