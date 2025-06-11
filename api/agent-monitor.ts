import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../lib/env.js';
import { withInternalAccess } from '../lib/auth.js';

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
    // Get lightweight statistics for monitoring
    const [
      // Active sessions are handled by separate endpoint
      // Get basic counts for statistics
      issueKeys,
      toolKeys,
      activeSessionsList,
    ] = await Promise.all([
      redis.keys('memory:issue:*:action'),
      redis.keys('memory:tools:*:stats'),
      redis.smembers('active_sessions_list'),
    ]);

    // Get basic activity counts without processing all the data
    const activeContextsCount = await getActiveContextsCount(issueKeys);
    const completedContextsCount = issueKeys.length - activeContextsCount.total;

    // Get tool usage statistics (this is lightweight)
    const toolStats: Record<string, { attempts: number; successes: number }> =
      {};
    const toolStatsPromises = toolKeys.slice(0, 20).map(async (key) => {
      const toolName = key.split(':')[2];
      if (!toolName) return;

      const stats = await redis.hgetall(key);
      toolStats[toolName] = stats
        ? {
            attempts: parseInt(stats.attempts as string) || 0,
            successes: parseInt(stats.successes as string) || 0,
          }
        : { attempts: 0, successes: 0 };
    });

    await Promise.all(toolStatsPromises);

    // Get recent system activity (limited to last 20 items for performance)
    const recentSystemActivity = await getRecentSystemActivity(
      issueKeys.slice(0, 10)
    );

    // Calculate totals for summary
    const totalToolOperations = Object.values(toolStats).reduce(
      (sum, stat) => sum + stat.attempts,
      0
    );
    const totalSuccessfulOperations = Object.values(toolStats).reduce(
      (sum, stat) => sum + stat.successes,
      0
    );

    return res.status(200).json({
      // Empty arrays for compatibility with the UI
      activeIssues: [],
      completedIssues: [],
      toolStats,
      systemActivity: recentSystemActivity,
      timestamp: Date.now(),
      linearConnected: false, // We're not making Linear calls anymore for performance
      summary: {
        totalActiveContexts: activeContextsCount.total,
        totalCompletedContexts: completedContextsCount,
        totalSlackContexts: activeContextsCount.slack,
        totalLinearIssues: activeContextsCount.linear,
        totalToolOperations,
        totalSuccessfulOperations,
      },
    });
  } catch (error) {
    console.error('Error retrieving agent status:', error);
    return res.status(500).json({ error: 'Failed to retrieve agent status' });
  }
}

// Lightweight function to count active contexts without processing all data
async function getActiveContextsCount(issueKeys: string[]) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
  let total = 0;
  let slack = 0;
  let linear = 0;

  // Sample only recent keys for performance (limit to 50 most recent)
  const keysToCheck = issueKeys.slice(0, 50);

  const promises = keysToCheck.map(async (key) => {
    const contextId = key.split(':')[2];
    if (!contextId) return { active: false, slack: false, linear: false };

    try {
      // Get only the most recent action to check activity
      const recentActions = await redis.lrange(key, 0, 0);

      if (recentActions.length === 0) {
        return { active: false, slack: false, linear: false };
      }

      const action =
        typeof recentActions[0] === 'object'
          ? recentActions[0]
          : JSON.parse(recentActions[0] as string);

      const isActive = action.timestamp && action.timestamp > cutoff;
      const isSlack = contextId.startsWith('slack:');
      const isLinear =
        !isSlack &&
        (/^[A-Z]{2,}-\d+$/.test(contextId) ||
          /^[a-f0-9-]{36}$/.test(contextId));

      return {
        active: isActive,
        slack: isActive && isSlack,
        linear: isActive && isLinear,
      };
    } catch (e) {
      return { active: false, slack: false, linear: false };
    }
  });

  const results = await Promise.all(promises);

  results.forEach((result) => {
    if (result.active) total++;
    if (result.slack) slack++;
    if (result.linear) linear++;
  });

  return { total, slack, linear };
}

// Lightweight function to get recent system activity
async function getRecentSystemActivity(issueKeys: string[]) {
  const recentSystemActivity = [];

  // Only check the 5 most recent issue keys for performance
  const keysToCheck = issueKeys.slice(0, 5);

  for (const key of keysToCheck) {
    const issueId = key.split(':')[2];
    const recentActions = await redis.lrange(key, 0, 2); // Get only 3 most recent per issue

    for (const action of recentActions) {
      try {
        const parsedAction =
          typeof action === 'object' ? action : JSON.parse(action as string);
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
  recentSystemActivity.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return recentSystemActivity.slice(0, 20);
}

// Export the handler with internal access protection
export default withInternalAccess(handler);
