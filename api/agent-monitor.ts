import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../lib/env.js';
import { withInternalAccess } from '../lib/auth.js';
import { LinearClient } from '@linear/sdk';
import { RepositoryManager } from '../lib/github/repository-manager.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Initialize repository manager
const repoManager = new RepositoryManager(
  env.ALLOWED_REPOSITORIES?.split(',').map((r) => r.trim()) || []
);

// We'll initialize the LinearClient in the handler to handle errors better

async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Create a safe LinearClient
    let linearClient: LinearClient | null = null;
    let linearConnected = false;

    try {
      // First try to get token from Redis - using the keys defined in callback.ts
      const linearToken = await redis.get('linearAccessToken');

      if (linearToken && typeof linearToken === 'string') {
        linearClient = new LinearClient({
          accessToken: linearToken,
        });
        console.log('Initializing Linear client with stored access token');
      } else if (process.env.LINEAR_API_KEY) {
        // Fallback to API key
        linearClient = new LinearClient({
          apiKey: process.env.LINEAR_API_KEY,
        });
        console.log('Initializing Linear client with API key');
      }

      // Test the connection if we have a client
      if (linearClient) {
        const viewer = await linearClient.viewer;
        linearConnected = !!viewer;
        console.log(
          'Linear connection successful as:',
          viewer?.name || 'Unknown user'
        );
      }
    } catch (error) {
      console.warn('Linear client initialization or connection failed:', error);
      linearClient = null;
      linearConnected = false;
    }

    // Fetch active contexts (both Linear issues and Slack conversations)
    const issueKeys = await redis.keys('memory:issue:*:action');
    const activeContexts = new Map<string, any>();
    const completedContexts = new Map<string, any>();

    // Process each context to get its activity data
    for (const key of issueKeys) {
      // Extract context ID from the key pattern "memory:issue:{contextId}:action"
      const contextId = key.split(':')[2];

      if (!contextId) continue;

      // Get the most recent action for this context
      const recentActions = await redis.lrange(key, 0, 19); // Get the 20 most recent actions

      if (recentActions.length === 0) continue;

      // Parse the actions
      const parsedActions = recentActions
        .map((action) => {
          try {
            return typeof action === 'object' ? action : JSON.parse(action);
          } catch (e) {
            console.error(`Error parsing action for context ${contextId}:`, e);
            return null;
          }
        })
        .filter((a) => a !== null);

      if (parsedActions.length === 0) continue;

      // Check if there's been activity in the last 24 hours
      const mostRecentTimestamp = Math.max(
        ...parsedActions.map((a) => a.timestamp || 0)
      );
      const isActive = Date.now() - mostRecentTimestamp < 24 * 60 * 60 * 1000;

      // Get conversation history for this context
      const conversationHistory = await redis.lrange(
        `memory:issue:${contextId}:conversation`,
        0,
        9 // Get last 10 conversation entries
      );

      const parsedConversations = conversationHistory
        .map((conv) => {
          try {
            return typeof conv === 'object' ? conv : JSON.parse(conv);
          } catch (e) {
            console.error(
              `Error parsing conversation for context ${contextId}:`,
              e
            );
            return null;
          }
        })
        .filter((c) => c !== null);

      // Determine context type and platform
      const isSlackContext = contextId.startsWith('slack:');
      const isLinearIssue =
        !isSlackContext && /^[A-Z]{2,}-\d+$/.test(contextId);
      const isLinearUUID = !isSlackContext && /^[a-f0-9-]{36}$/.test(contextId);

      let contextType = 'general';
      let platform = 'unknown';
      let displayName = contextId;

      if (isSlackContext) {
        contextType = 'slack_conversation';
        platform = 'slack';
        // Extract channel info from slack:channelId or slack:channelId:threadTs
        const slackParts = contextId.split(':');
        if (slackParts.length >= 2) {
          const channelId = slackParts[1];
          const isThread = slackParts.length > 2;
          displayName = `#${channelId}${isThread ? ' (thread)' : ''}`;
        }
      } else if (isLinearIssue || isLinearUUID) {
        contextType = 'linear_issue';
        platform = 'linear';
        displayName = isLinearIssue
          ? contextId
          : `Issue ${contextId.substring(0, 8)}...`;
      }

      // Get the repository most used with this context
      const repoUsage = await redis.zrange(
        `memory:issue:${contextId}:repositories`,
        0,
        0,
        {
          rev: true,
        }
      );

      // Get Slack channel info if available
      let slackDetails = null;
      if (isSlackContext) {
        const slackParts = contextId.split(':');
        if (slackParts.length >= 2) {
          slackDetails = {
            channelId: slackParts[1],
            threadTs: slackParts.length > 2 ? slackParts[2] : null,
            isThread: slackParts.length > 2,
          };
        }
      }

      // Store basic context data
      const contextData = {
        contextId,
        displayName,
        contextType,
        platform,
        lastActivity: mostRecentTimestamp,
        actionsCount: parsedActions.length,
        recentActions: parsedActions.slice(0, 5),
        allActions: parsedActions, // Include all actions for detailed view
        conversationHistory: parsedConversations.slice(0, 5),
        allConversations: parsedConversations, // Include all conversations
        conversationCount: parsedConversations.length,
        repository: repoUsage && repoUsage.length > 0 ? repoUsage[0] : null,
        issueDetails: null, // Will be populated for Linear issues
        slackDetails, // Will be populated for Slack contexts
        branchDetails: null,
        status: isActive ? 'active' : 'completed',
      };

      // Categorize as active or completed
      if (isActive) {
        activeContexts.set(contextId, contextData);
      } else {
        completedContexts.set(contextId, contextData);
      }
    }

    // Fetch Linear issue details in parallel if connection is available
    if (linearConnected && linearClient) {
      const allContexts = new Map([...activeContexts, ...completedContexts]);
      const linearContexts = Array.from(allContexts.entries()).filter(
        ([contextId, contextData]) => contextData.contextType === 'linear_issue'
      );

      const issuePromises = linearContexts.map(
        async ([contextId, contextData]) => {
          try {
            // Fetch issue details from Linear
            const issue = await linearClient!.issue(contextId);

            // Update context data with details from Linear
            if (issue) {
              contextData.issueDetails = {
                id: issue.id,
                identifier: issue.identifier,
                title: issue.title,
                description: issue.description,
                state: issue.state ? (await issue.state).name : 'Unknown',
                assignee: issue.assignee ? (await issue.assignee).name : null,
                priority: issue.priority,
                url: issue.url,
                createdAt: issue.createdAt,
                updatedAt: issue.updatedAt,
              };

              // Update display name with Linear identifier
              contextData.displayName =
                issue.identifier || contextData.displayName;

              // Update status based on Linear state if available
              const state = await issue.state;
              if (state) {
                const completedStates = [
                  'Done',
                  'Completed',
                  'Closed',
                  'Canceled',
                ];
                const isLinearCompleted = completedStates.some((s) =>
                  state.name.toLowerCase().includes(s.toLowerCase())
                );
                if (isLinearCompleted) {
                  contextData.status = 'completed';
                }
              }
            }

            // Look for branch information in memory
            const branches = await redis.smembers(
              `memory:issue:branch:${contextId}`
            );
            if (branches && branches.length > 0) {
              const branchInfo = branches[0].split(':');
              if (branchInfo.length >= 2) {
                const [repo, branch] = branchInfo;
                contextData.branchDetails = {
                  repository: repo,
                  branch: branch,
                };
              }
            }

            // Look for pull requests
            const pullRequests = await redis.smembers(
              `memory:issue:pr:${contextId}`
            );
            if (pullRequests && pullRequests.length > 0) {
              contextData.pullRequests = pullRequests.map((pr) => {
                // For PR URLs like https://github.com/owner/repo/pull/123
                const match = pr.match(
                  /github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/
                );
                if (match) {
                  return {
                    owner: match[1],
                    repo: match[2],
                    number: match[3],
                    url: pr,
                  };
                }
                return { url: pr };
              });
            }

            return [contextId, contextData] as [string, any];
          } catch (error) {
            console.error(
              `Error fetching details for Linear issue ${contextId}:`,
              error
            );
            return [contextId, contextData] as [string, any];
          }
        }
      );

      // Wait for all Linear issue details to be fetched
      const updatedLinearEntries = await Promise.all(issuePromises);

      // Update the contexts with Linear data
      for (const [id, data] of updatedLinearEntries) {
        if (data.status === 'active') {
          activeContexts.set(id, data);
        } else {
          completedContexts.set(id, data);
        }
      }
    } else {
      console.log(
        'Linear client not available - skipping Linear issue detail fetching'
      );
    }

    // Get tool usage statistics
    const toolKeys = await redis.keys('memory:tools:*:stats');
    const toolStats: Record<string, { attempts: number; successes: number }> =
      {};

    for (const key of toolKeys) {
      // Extract tool name from pattern "memory:tools:{toolName}:stats"
      const toolName = key.split(':')[2];
      if (!toolName) continue;

      const stats = await redis.hgetall(key);
      toolStats[toolName] = stats
        ? {
            attempts: parseInt(stats.attempts as string) || 0,
            successes: parseInt(stats.successes as string) || 0,
          }
        : { attempts: 0, successes: 0 };
    }

    // Get recent system activity (last 50 actions across all issues)
    const allActionKeys = await redis.keys('memory:issue:*:action');
    const recentSystemActivity = [];

    for (const key of allActionKeys.slice(0, 10)) {
      // Limit to prevent performance issues
      const issueId = key.split(':')[2];
      const recentActions = await redis.lrange(key, 0, 4); // Get 5 most recent per issue

      for (const action of recentActions) {
        try {
          const parsedAction =
            typeof action === 'object' ? action : JSON.parse(action);
          recentSystemActivity.push({
            ...parsedAction,
            issueId,
          });
        } catch (e) {
          // Skip malformed entries
        }
      }
    }

    // Sort by timestamp and take the most recent 20
    recentSystemActivity.sort(
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    );
    const systemActivity = recentSystemActivity.slice(0, 20);

    // Return the enhanced data with platform-aware naming
    return res.status(200).json({
      activeContexts: Array.from(activeContexts.values()),
      completedContexts: Array.from(completedContexts.values()),
      // Keep legacy naming for backward compatibility
      activeIssues: Array.from(activeContexts.values()),
      completedIssues: Array.from(completedContexts.values()),
      toolStats,
      systemActivity,
      timestamp: Date.now(),
      linearConnected,
      summary: {
        totalActiveContexts: activeContexts.size,
        totalCompletedContexts: completedContexts.size,
        totalSlackContexts: Array.from(activeContexts.values())
          .concat(Array.from(completedContexts.values()))
          .filter((c) => c.platform === 'slack').length,
        totalLinearIssues: Array.from(activeContexts.values())
          .concat(Array.from(completedContexts.values()))
          .filter((c) => c.platform === 'linear').length,
        // Legacy naming for backward compatibility
        totalActiveIssues: activeContexts.size,
        totalCompletedIssues: completedContexts.size,
        totalToolOperations: Object.values(toolStats).reduce(
          (sum, stat) => sum + stat.attempts,
          0
        ),
        totalSuccessfulOperations: Object.values(toolStats).reduce(
          (sum, stat) => sum + stat.successes,
          0
        ),
      },
    });
  } catch (error) {
    console.error('Error retrieving agent status:', error);
    return res.status(500).json({ error: 'Failed to retrieve agent status' });
  }
}

// Export the handler with internal access protection
export default withInternalAccess(handler);
