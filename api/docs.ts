import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from '../lib/env.js';
import { withCORS } from '../lib/cors.js';

/**
 * OpenAPI documentation endpoint
 * Returns comprehensive API documentation for all Otron endpoints
 */
async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const openApiSpec = {
    openapi: '3.0.3',
    info: {
      title: 'Otron AI Agent API',
      description:
        'Autonomous AI agent for Linear issue management, GitHub repository integration, and Slack automation',
      version: '0.0.1',
      contact: {
        name: 'Otron',
        url: 'https://github.com/otron-io/otron',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: env.VERCEL_URL,
        description: 'Production server',
      },
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        InternalToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Internal-Token',
          description: 'Internal API token for protected endpoints',
        },
        BasicAuth: {
          type: 'http',
          scheme: 'basic',
          description: 'Basic authentication for admin interfaces',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
            },
          },
          required: ['error'],
        },
        HealthCheck: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['healthy', 'degraded', 'unhealthy'],
              description: 'Overall system health status',
            },
            uptime: {
              type: 'number',
              description: 'System uptime in seconds',
            },
            version: {
              type: 'string',
              description: 'Application version',
            },
            environment: {
              type: 'string',
              description: 'Runtime environment',
            },
            checks: {
              type: 'object',
              description: 'Individual health check results',
              additionalProperties: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    enum: ['healthy', 'unhealthy'],
                  },
                  message: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        MemoryEntry: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique memory entry identifier',
            },
            issueId: {
              type: 'string',
              description: 'Associated issue or context ID',
            },
            memoryType: {
              type: 'string',
              enum: ['conversation', 'action', 'context'],
              description: 'Type of memory entry',
            },
            timestamp: {
              type: 'number',
              description: 'Unix timestamp when memory was created',
            },
            type: {
              type: 'string',
              description: 'Specific memory type (e.g., tool name for actions)',
            },
            data: {
              type: 'object',
              description: 'Memory content data',
              additionalProperties: true,
            },
            relevanceScore: {
              type: 'number',
              description: 'Relevance score for memory ranking',
            },
          },
          required: [
            'id',
            'issueId',
            'memoryType',
            'timestamp',
            'type',
            'data',
          ],
        },
        MemoryStatistics: {
          type: 'object',
          properties: {
            totalMemories: {
              type: 'number',
              description: 'Total number of memory entries',
            },
            conversationMemories: {
              type: 'number',
              description: 'Number of conversation memory entries',
            },
            actionMemories: {
              type: 'number',
              description: 'Number of action memory entries',
            },
            contextMemories: {
              type: 'number',
              description: 'Number of context memory entries',
            },
            totalIssues: {
              type: 'number',
              description: 'Number of unique issues with memories',
            },
            oldestMemory: {
              type: 'number',
              description: 'Timestamp of oldest memory entry',
              nullable: true,
            },
            newestMemory: {
              type: 'number',
              description: 'Timestamp of newest memory entry',
              nullable: true,
            },
          },
        },
        AgentContext: {
          type: 'object',
          properties: {
            contextId: {
              type: 'string',
              description: 'Unique context identifier',
            },
            platform: {
              type: 'string',
              enum: ['linear', 'slack'],
              description: 'Platform where the context originated',
            },
            title: {
              type: 'string',
              description: 'Context title or description',
            },
            status: {
              type: 'string',
              description: 'Current status of the context',
            },
            lastActivity: {
              type: 'string',
              format: 'date-time',
              description: 'Last activity timestamp',
            },
            actionCount: {
              type: 'integer',
              description: 'Number of actions performed in this context',
            },
          },
        },
        ToolStats: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              attempts: {
                type: 'integer',
                description: 'Number of times this tool was attempted',
              },
              successes: {
                type: 'integer',
                description: 'Number of successful tool executions',
              },
              failures: {
                type: 'integer',
                description: 'Number of failed tool executions',
              },
              lastUsed: {
                type: 'string',
                format: 'date-time',
                description: 'Last time this tool was used',
              },
            },
          },
        },
        AgentMonitorResponse: {
          type: 'object',
          properties: {
            activeContexts: {
              type: 'array',
              items: { $ref: '#/components/schemas/AgentContext' },
              description: 'Currently active contexts',
            },
            completedContexts: {
              type: 'array',
              items: { $ref: '#/components/schemas/AgentContext' },
              description: 'Recently completed contexts',
            },
            toolStats: {
              $ref: '#/components/schemas/ToolStats',
              description: 'Tool usage statistics',
            },
            systemActivity: {
              type: 'object',
              description: 'System activity metrics',
            },
            timestamp: {
              type: 'integer',
              description: 'Response timestamp',
            },
            linearConnected: {
              type: 'boolean',
              description: 'Whether Linear integration is connected',
            },
          },
        },
        SearchResult: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            path: {
              type: 'string',
              description: 'File path within repository',
            },
            content: {
              type: 'string',
              description: 'Matched content',
            },
            score: {
              type: 'number',
              description: 'Relevance score (0-1)',
            },
            language: {
              type: 'string',
              description: 'Programming language',
            },
            type: {
              type: 'string',
              enum: ['function', 'class', 'method', 'block', 'file'],
              description: 'Type of code element',
            },
            startLine: {
              type: 'integer',
              description: 'Starting line number',
            },
            endLine: {
              type: 'integer',
              description: 'Ending line number',
            },
          },
        },
        EmbeddingStatus: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            status: {
              type: 'string',
              enum: ['processing', 'completed', 'failed'],
              description: 'Embedding status',
            },
            progress: {
              type: 'number',
              description: 'Progress percentage (0-100)',
            },
            filesProcessed: {
              type: 'integer',
              description: 'Number of files processed',
            },
            totalFiles: {
              type: 'integer',
              description: 'Total number of files to process',
            },
            lastUpdated: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp',
            },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          summary: 'Health Check',
          description: 'Get system health status and connectivity checks',
          tags: ['System'],
          security: [{ InternalToken: [] }],
          responses: {
            '200': {
              description: 'System health information',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthCheck' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/api/agent-monitor': {
        get: {
          summary: 'Agent Monitor',
          description:
            'Get real-time agent activity, contexts, and tool usage statistics',
          tags: ['Agent'],
          security: [{ InternalToken: [] }],
          parameters: [
            {
              name: 'activeDays',
              in: 'query',
              description:
                'Number of days to consider as "active" (default: 7)',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: 30,
                default: 7,
              },
            },
            {
              name: 'includeAll',
              in: 'query',
              description:
                'Whether to include all historical contexts (default: false)',
              required: false,
              schema: {
                type: 'boolean',
                default: false,
              },
            },
          ],
          responses: {
            '200': {
              description: 'Agent monitoring data',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AgentMonitorResponse' },
                },
              },
            },
            '403': {
              description: 'Forbidden - Invalid or missing internal token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/api/code-search': {
        get: {
          summary: 'Semantic Code Search',
          description:
            'Search through repository embeddings using vector similarity',
          tags: ['Repository'],
          security: [{ InternalToken: [] }],
          parameters: [
            {
              name: 'repository',
              in: 'query',
              description: 'Repository name to search in',
              required: true,
              schema: {
                type: 'string',
                example: 'owner/repo-name',
              },
            },
            {
              name: 'query',
              in: 'query',
              description: 'Search query',
              required: true,
              schema: {
                type: 'string',
                example: 'authentication middleware function',
              },
            },
            {
              name: 'method',
              in: 'query',
              description: 'Search method (currently only vector is supported)',
              required: false,
              schema: {
                type: 'string',
                enum: ['vector'],
                default: 'vector',
              },
            },
            {
              name: 'fileFilter',
              in: 'query',
              description: 'File type filter (e.g., .ts, .js)',
              required: false,
              schema: {
                type: 'string',
                example: '.ts',
              },
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of results to return',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: 100,
                default: 20,
              },
            },
          ],
          responses: {
            '200': {
              description: 'Search results',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      results: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/SearchResult' },
                      },
                      totalResults: {
                        type: 'integer',
                        description: 'Total number of results found',
                      },
                      repository: {
                        type: 'string',
                        description: 'Repository that was searched',
                      },
                      query: {
                        type: 'string',
                        description: 'Original search query',
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request - missing or invalid parameters',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '403': {
              description: 'Forbidden - Invalid or missing internal token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          summary: 'Semantic Code Search (POST)',
          description:
            'Search through repository embeddings using vector similarity with request body',
          tags: ['Repository'],
          security: [{ InternalToken: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['repository', 'query'],
                  properties: {
                    repository: {
                      type: 'string',
                      description: 'Repository name to search in',
                      example: 'owner/repo-name',
                    },
                    query: {
                      type: 'string',
                      description: 'Search query',
                      example: 'authentication middleware function',
                    },
                    method: {
                      type: 'string',
                      enum: ['vector'],
                      default: 'vector',
                      description: 'Search method',
                    },
                    fileFilter: {
                      type: 'string',
                      description: 'File type filter',
                      example: '.ts',
                    },
                    limit: {
                      type: 'integer',
                      minimum: 1,
                      maximum: 100,
                      default: 20,
                      description: 'Maximum number of results',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Search results',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      results: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/SearchResult' },
                      },
                      totalResults: {
                        type: 'integer',
                      },
                      repository: {
                        type: 'string',
                      },
                      query: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/embed-repo': {
        post: {
          summary: 'Embed Repository',
          description: 'Start the embedding process for a GitHub repository',
          tags: ['Repository'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['repository'],
                  properties: {
                    repository: {
                      type: 'string',
                      description: 'Repository name in format owner/repo',
                      example: 'owner/repo-name',
                    },
                    force: {
                      type: 'boolean',
                      default: false,
                      description: 'Force re-embedding even if already exists',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Embedding process started',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: {
                        type: 'string',
                        description: 'Success message',
                      },
                      repository: {
                        type: 'string',
                        description: 'Repository name',
                      },
                      status: {
                        type: 'string',
                        enum: ['started', 'already_exists'],
                        description: 'Embedding status',
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request - invalid repository format',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        delete: {
          summary: 'Delete Repository Embeddings',
          description: 'Remove all embeddings for a repository',
          tags: ['Repository'],
          parameters: [
            {
              name: 'repository',
              in: 'query',
              description: 'Repository name to delete embeddings for',
              required: true,
              schema: {
                type: 'string',
                example: 'owner/repo-name',
              },
            },
          ],
          responses: {
            '200': {
              description: 'Repository embeddings deleted successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: {
                        type: 'boolean',
                      },
                      message: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request - missing repository parameter',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/api/embedding-status': {
        get: {
          summary: 'Get Embedding Status',
          description: 'Get the status of repository embedding processes',
          tags: ['Repository'],
          security: [{ InternalToken: [] }],
          parameters: [
            {
              name: 'repository',
              in: 'query',
              description: 'Specific repository to get status for (optional)',
              required: false,
              schema: {
                type: 'string',
                example: 'owner/repo-name',
              },
            },
          ],
          responses: {
            '200': {
              description: 'Embedding status information',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        type: 'array',
                        items: { $ref: '#/components/schemas/EmbeddingStatus' },
                        description: 'Array of all repository statuses',
                      },
                      {
                        $ref: '#/components/schemas/EmbeddingStatus',
                        description: 'Single repository status',
                      },
                    ],
                  },
                },
              },
            },
            '404': {
              description: 'Repository not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/api/issue-actions': {
        get: {
          summary: 'Get Issue Actions',
          description: 'Retrieve actions performed for a specific issue',
          tags: ['Issues'],
          security: [{ InternalToken: [] }],
          parameters: [
            {
              name: 'issueId',
              in: 'query',
              description: 'Linear issue ID',
              required: true,
              schema: {
                type: 'string',
              },
            },
            {
              name: 'skip',
              in: 'query',
              description: 'Number of actions to skip for pagination',
              required: false,
              schema: {
                type: 'integer',
                minimum: 0,
                default: 0,
              },
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of actions to return',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: 100,
                default: 20,
              },
            },
          ],
          responses: {
            '200': {
              description: 'Issue actions data',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      actions: {
                        type: 'array',
                        items: {
                          type: 'object',
                          description:
                            'Action data structure varies by action type',
                        },
                      },
                      totalActions: {
                        type: 'integer',
                        description: 'Total number of actions for this issue',
                      },
                      skip: {
                        type: 'integer',
                        description: 'Number of actions skipped',
                      },
                      limit: {
                        type: 'integer',
                        description: 'Maximum actions returned',
                      },
                      hasMore: {
                        type: 'boolean',
                        description: 'Whether there are more actions available',
                      },
                      issueId: {
                        type: 'string',
                        description: 'The issue ID that was queried',
                      },
                      timestamp: {
                        type: 'integer',
                        description: 'Response timestamp',
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request - missing issue ID',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '403': {
              description: 'Forbidden - Invalid or missing internal token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/api/issue-details': {
        get: {
          summary: 'Get Issue Details',
          description:
            'Retrieve detailed information about an issue including actions, conversations, and context',
          tags: ['Issues'],
          security: [{ InternalToken: [] }],
          parameters: [
            {
              name: 'issueId',
              in: 'query',
              description: 'Issue ID',
              required: true,
              schema: {
                type: 'string',
              },
            },
            {
              name: 'type',
              in: 'query',
              description: 'Type of data to retrieve',
              required: false,
              schema: {
                type: 'string',
                enum: ['all', 'actions', 'conversations', 'context'],
                default: 'all',
              },
            },
            {
              name: 'skip',
              in: 'query',
              description: 'Number of items to skip for pagination',
              required: false,
              schema: {
                type: 'integer',
                minimum: 0,
                default: 0,
              },
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of items to return',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: 100,
                default: 50,
              },
            },
          ],
          responses: {
            '200': {
              description: 'Issue details data',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      actions: {
                        type: 'array',
                        items: {
                          type: 'object',
                          description: 'Action data',
                        },
                      },
                      conversations: {
                        type: 'array',
                        items: {
                          type: 'object',
                          description: 'Conversation data',
                        },
                      },
                      context: {
                        type: 'array',
                        items: {
                          type: 'object',
                          description: 'Context data',
                        },
                      },
                      totalActions: {
                        type: 'integer',
                        description: 'Total number of actions',
                      },
                      totalConversations: {
                        type: 'integer',
                        description: 'Total number of conversations',
                      },
                      totalContext: {
                        type: 'integer',
                        description: 'Total number of context entries',
                      },
                      issueId: {
                        type: 'string',
                        description: 'The issue ID that was queried',
                      },
                      skip: {
                        type: 'integer',
                        description: 'Number of items skipped',
                      },
                      limit: {
                        type: 'integer',
                        description: 'Maximum items returned',
                      },
                      timestamp: {
                        type: 'integer',
                        description: 'Response timestamp',
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request - missing issue ID',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '403': {
              description: 'Forbidden - Invalid or missing internal token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/api/memory-browser': {
        get: {
          summary: 'Browse Memory Entries',
          description:
            'Retrieve paginated memory entries with filtering and search capabilities',
          tags: ['Memory'],
          security: [{ InternalToken: [] }],
          parameters: [
            {
              name: 'page',
              in: 'query',
              description: 'Page number for pagination (1-based)',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                default: 1,
              },
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Number of items per page',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: 100,
                default: 20,
              },
            },
            {
              name: 'issueId',
              in: 'query',
              description: 'Filter by specific issue ID',
              required: false,
              schema: {
                type: 'string',
              },
            },
            {
              name: 'memoryType',
              in: 'query',
              description: 'Filter by memory type',
              required: false,
              schema: {
                type: 'string',
                enum: ['conversation', 'action', 'context'],
              },
            },
            {
              name: 'dateFrom',
              in: 'query',
              description:
                'Filter memories from this timestamp (Unix timestamp)',
              required: false,
              schema: {
                type: 'number',
              },
            },
            {
              name: 'dateTo',
              in: 'query',
              description:
                'Filter memories until this timestamp (Unix timestamp)',
              required: false,
              schema: {
                type: 'number',
              },
            },
            {
              name: 'slackChannel',
              in: 'query',
              description: 'Filter by Slack channel ID',
              required: false,
              schema: {
                type: 'string',
              },
            },
            {
              name: 'searchQuery',
              in: 'query',
              description: 'Search within memory content',
              required: false,
              schema: {
                type: 'string',
              },
            },
          ],
          responses: {
            '200': {
              description: 'Memory entries with pagination and statistics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      memories: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/MemoryEntry' },
                        description: 'Array of memory entries',
                      },
                      pagination: {
                        type: 'object',
                        properties: {
                          page: {
                            type: 'integer',
                            description: 'Current page number',
                          },
                          limit: {
                            type: 'integer',
                            description: 'Items per page',
                          },
                          total: {
                            type: 'integer',
                            description: 'Total number of items',
                          },
                          totalPages: {
                            type: 'integer',
                            description: 'Total number of pages',
                          },
                        },
                      },
                      statistics: {
                        $ref: '#/components/schemas/MemoryStatistics',
                        description: 'Memory statistics',
                      },
                    },
                  },
                },
              },
            },
            '403': {
              description: 'Forbidden - Invalid or missing internal token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        delete: {
          summary: 'Delete Memory Entry',
          description: 'Delete a specific memory entry by ID',
          tags: ['Memory'],
          security: [{ InternalToken: [] }],
          parameters: [
            {
              name: 'id',
              in: 'query',
              description: 'Memory entry ID to delete',
              required: true,
              schema: {
                type: 'string',
              },
            },
          ],
          responses: {
            '200': {
              description: 'Memory entry deleted successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: {
                        type: 'boolean',
                      },
                      message: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request - missing memory ID',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Memory entry not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '403': {
              description: 'Forbidden - Invalid or missing internal token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          summary: 'Bulk Memory Operations',
          description:
            'Perform bulk operations on memory entries (delete by filters, delete by IDs, cleanup)',
          tags: ['Memory'],
          security: [{ InternalToken: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['operation'],
                  properties: {
                    operation: {
                      type: 'string',
                      enum: ['deleteByFilters', 'deleteByIds', 'cleanup'],
                      description: 'Type of bulk operation to perform',
                    },
                    filters: {
                      type: 'object',
                      description: 'Filters for deleteByFilters operation',
                      properties: {
                        issueId: {
                          type: 'string',
                          description: 'Filter by issue ID',
                        },
                        memoryType: {
                          type: 'string',
                          enum: ['conversation', 'action', 'context'],
                          description: 'Filter by memory type',
                        },
                        dateFrom: {
                          type: 'number',
                          description: 'Filter from timestamp',
                        },
                        dateTo: {
                          type: 'number',
                          description: 'Filter until timestamp',
                        },
                        slackChannel: {
                          type: 'string',
                          description: 'Filter by Slack channel',
                        },
                        searchQuery: {
                          type: 'string',
                          description: 'Search query for content',
                        },
                      },
                    },
                    memoryIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                      description:
                        'Array of memory IDs for deleteByIds operation',
                    },
                    olderThanDays: {
                      type: 'number',
                      description: 'Number of days for cleanup operation',
                      minimum: 1,
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Bulk operation completed successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: {
                        type: 'boolean',
                      },
                      message: {
                        type: 'string',
                      },
                      deletedCount: {
                        type: 'integer',
                        description: 'Number of memories deleted',
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request - invalid operation or parameters',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '403': {
              description: 'Forbidden - Invalid or missing internal token',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal server error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/webhook': {
        post: {
          summary: 'Linear Webhook Handler',
          description: 'Receive and process Linear webhook events',
          tags: ['Webhooks'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description:
                    'Linear webhook payload (structure varies by event type)',
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Webhook processed successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      received: {
                        type: 'boolean',
                        description: 'Whether the webhook was received',
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request - invalid webhook signature or payload',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '405': {
              description: 'Method not allowed - only POST is supported',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/api/events': {
        post: {
          summary: 'Slack Events Handler',
          description: 'Receive and process Slack event API events',
          tags: ['Webhooks'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description:
                    'Slack event payload (structure varies by event type)',
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Event processed successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      challenge: {
                        type: 'string',
                        description: 'Challenge response for URL verification',
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request - invalid event signature or payload',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '405': {
              description: 'Method not allowed - only POST is supported',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/oauth/callback': {
        get: {
          summary: 'OAuth Callback Handler',
          description: 'Handle OAuth callback from Linear authorization flow',
          tags: ['Authentication'],
          parameters: [
            {
              name: 'code',
              in: 'query',
              description: 'Authorization code from Linear',
              required: true,
              schema: {
                type: 'string',
              },
            },
            {
              name: 'state',
              in: 'query',
              description: 'State parameter for CSRF protection',
              required: false,
              schema: {
                type: 'string',
              },
            },
          ],
          responses: {
            '302': {
              description: 'Redirect to success or error page',
            },
            '400': {
              description:
                'Bad request - missing or invalid authorization code',
            },
            '500': {
              description: 'Internal server error during OAuth flow',
            },
          },
        },
      },
      '/linear-app': {
        get: {
          summary: 'Linear App Installation',
          description: 'Redirect to Linear for app installation/authorization',
          tags: ['Authentication'],
          responses: {
            '307': {
              description: 'Redirect to Linear authorization URL',
            },
            '500': {
              description: 'Internal server error generating auth URL',
            },
          },
        },
      },
    },
    tags: [
      {
        name: 'System',
        description: 'System health and status endpoints',
      },
      {
        name: 'Agent',
        description: 'AI agent monitoring and activity endpoints',
      },
      {
        name: 'Repository',
        description: 'Repository embedding and search endpoints',
      },
      {
        name: 'Issues',
        description: 'Issue tracking and action endpoints',
      },
      {
        name: 'Memory',
        description: 'Memory management and browsing endpoints',
      },
      {
        name: 'Webhooks',
        description: 'Webhook handlers for external integrations',
      },
      {
        name: 'Authentication',
        description: 'OAuth and authentication endpoints',
      },
    ],
  };

  return res.status(200).json(openApiSpec);
}

// Export with CORS protection
export default withCORS(handler);
