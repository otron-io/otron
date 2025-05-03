import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../../src/env.js';

// Initialize Redis client for monitoring
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

/**
 * API endpoint to monitor agent activity
 * Provides information about recent agent executions
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Get recent agent activities from memory system
    const agentDelegations = await redis.zrange(
      'memory:agent_delegations',
      0,
      9,
      {
        rev: true,
        withScores: true,
      }
    );

    // Get recent tool usages by agent type
    const devToolUsage = await redis.zrange('memory:tool_usage:dev', 0, 9, {
      rev: true,
      withScores: true,
    });

    const linearToolUsage = await redis.zrange(
      'memory:tool_usage:linear',
      0,
      9,
      {
        rev: true,
        withScores: true,
      }
    );

    // Get active issues being processed
    const activeIssues = await redis.zrange('memory:active_issues', 0, 9, {
      rev: true,
      withScores: true,
    });

    // Return the monitoring data
    res.status(200).json({
      agentDelegations,
      toolUsage: {
        dev: devToolUsage,
        linear: linearToolUsage,
      },
      activeIssues,
    });
  } catch (error) {
    console.error('Error in agent monitor endpoint:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
