import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../src/env.js';
import { withPasswordProtection } from '../src/utils/auth.js';
import { LinearClient } from '@linear/sdk';
import { RepositoryUtils } from '../src/utils/repo-utils.js';
import { LinearService } from '../src/utils/linear.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Initialize repository utilities
const repoUtils = new RepositoryUtils(
  env.ALLOWED_REPOSITORIES?.split(',').map((r) => r.trim()) || []
);

async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch active issues (issues with memory entries in the last 24 hours)
    const issueKeys = await redis.keys('memory:issue:*:action');
    const activeIssues = new Map<string, any>();

    // Process each issue to get its activity data
    for (const key of issueKeys) {
      // Extract issue ID from the key pattern "memory:issue:{issueId}:action"
      const issueId = key.split(':')[2];

      if (!issueId) continue;

      // Get the most recent action for this issue
      const recentActions = await redis.lrange(key, 0, 9); // Get the 10 most recent actions

      if (recentActions.length === 0) continue;

      // Parse the actions
      const parsedActions = recentActions
        .map((action) => {
          try {
            return typeof action === 'object' ? action : JSON.parse(action);
          } catch (e) {
            console.error(`Error parsing action for issue ${issueId}:`, e);
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

      if (!isActive) continue;

      // Get the repository most used with this issue
      const repoUsage = await redis.zrange(
        `memory:issue:${issueId}:repositories`,
        0,
        0,
        {
          rev: true,
        }
      );

      // Store basic issue data
      const issueData = {
        issueId,
        lastActivity: mostRecentTimestamp,
        actionsCount: parsedActions.length,
        recentActions: parsedActions.slice(0, 5),
        repository: repoUsage && repoUsage.length > 0 ? repoUsage[0] : null,
        issueDetails: null,
        branchDetails: null,
      };

      // Add to the map
      activeIssues.set(issueId, issueData);
    }

    // Try to fetch Linear issue details if possible
    let linearClient: LinearClient | null = null;
    try {
      // Check if a stored Linear access token exists - fetch it from Redis
      const storedLinearToken = await redis.get('linear:access_token');
      if (storedLinearToken) {
        // Initialize Linear client with the stored token
        linearClient = new LinearClient({
          accessToken: storedLinearToken as string,
        });
        console.log('Using stored Linear access token');
      } else {
        // Fallback - get API key from environment
        const apiKey = process.env.LINEAR_API_KEY;
        if (apiKey) {
          linearClient = new LinearClient({ apiKey });
          console.log('Using Linear API key');
        }
      }
    } catch (error) {
      console.warn('Could not initialize Linear client:', error);
      linearClient = null;
    }

    // Fetch Linear issue details in parallel if client is available
    if (linearClient) {
      const issuePromises = Array.from(activeIssues.entries()).map(
        async ([issueId, issueData]) => {
          try {
            // Fetch issue details from Linear
            const issue = await linearClient!.issue(issueId);

            // Update issue data with details from Linear
            if (issue) {
              issueData.issueDetails = {
                id: issue.id,
                identifier: issue.identifier,
                title: issue.title,
                description: issue.description,
                state: issue.state ? issue.state.toString() : 'Unknown',
                assignee: issue.assignee ? issue.assignee.toString() : null,
                priority: issue.priority,
                url: issue.url,
              };
            }

            // Look for branch information in memory
            const branches = await redis.smembers(
              `memory:issue:branch:${issueId}`
            );
            if (branches && branches.length > 0) {
              const branchInfo = branches[0].split(':');
              if (branchInfo.length >= 2) {
                const [repo, branch] = branchInfo;
                issueData.branchDetails = {
                  repository: repo,
                  branch: branch,
                };
              }
            }

            // Look for pull requests
            const pullRequests = await redis.smembers(
              `memory:issue:pr:${issueId}`
            );
            if (pullRequests && pullRequests.length > 0) {
              issueData.pullRequests = pullRequests.map((pr) => {
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

            return [issueId, issueData] as [string, any];
          } catch (error) {
            console.error(
              `Error fetching details for issue ${issueId}:`,
              error
            );
            return [issueId, issueData] as [string, any];
          }
        }
      );

      // Wait for all issue details to be fetched
      const updatedIssuesEntries = await Promise.all(issuePromises);
      activeIssues.clear();
      for (const [id, data] of updatedIssuesEntries) {
        activeIssues.set(id, data);
      }
    } else {
      console.log(
        'Linear client not available - skipping issue detail fetching'
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

    // Return the data
    return res.status(200).json({
      activeIssues: Array.from(activeIssues.values()),
      toolStats,
      timestamp: Date.now(),
      linearConnected: linearClient !== null,
    });
  } catch (error) {
    console.error('Error retrieving agent status:', error);
    return res.status(500).json({ error: 'Failed to retrieve agent status' });
  }
}

// Export the handler with password protection
export default withPasswordProtection(handler);
