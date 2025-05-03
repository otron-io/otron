import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../src/env.js';
import { withPasswordProtection } from '../src/utils/auth.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch active issues (issues with memory entries in the last 24 hours)
    const issueKeys = await redis.keys('memory:issue:*:action');
    const activeIssues = new Map();

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

      // Store issue data
      activeIssues.set(issueId, {
        issueId,
        lastActivity: mostRecentTimestamp,
        actionsCount: parsedActions.length,
        recentActions: parsedActions.slice(0, 5),
        repository: repoUsage && repoUsage.length > 0 ? repoUsage[0] : null,
      });
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
    });
  } catch (error) {
    console.error('Error retrieving agent status:', error);
    return res.status(500).json({ error: 'Failed to retrieve agent status' });
  }
}

// Export the handler with password protection
export default withPasswordProtection(handler);
