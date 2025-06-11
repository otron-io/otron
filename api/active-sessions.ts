import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../lib/env.js';
import { withInternalAccess } from '../lib/auth.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

interface ActiveSession {
  sessionId: string;
  contextId: string;
  startTime: number;
  platform: 'slack' | 'linear' | 'github' | 'general';
  status: 'initializing' | 'planning' | 'gathering' | 'acting' | 'completing';
  currentTool?: string;
  toolsUsed: string[];
  actionsPerformed: string[];
  messages: any[];
  metadata?: {
    issueId?: string;
    channelId?: string;
    threadTs?: string;
    userId?: string;
  };
}

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      // Get all active sessions
      const activeSessionIds = await redis.smembers('active_sessions_list');
      const sessions: ActiveSession[] = [];

      for (const sessionId of activeSessionIds) {
        try {
          const sessionData = await redis.get(`active_session:${sessionId}`);
          if (sessionData) {
            // Handle both string and object responses from Redis
            let session: ActiveSession;
            if (typeof sessionData === 'string') {
              session = JSON.parse(sessionData) as ActiveSession;
            } else {
              session = sessionData as ActiveSession;
            }
            sessions.push(session);
          } else {
            // Clean up orphaned session ID
            await redis.srem('active_sessions_list', sessionId);
          }
        } catch (error) {
          console.error(`Error parsing session ${sessionId}:`, error);
          // Clean up problematic session
          await redis.srem('active_sessions_list', sessionId);
          await redis.del(`active_session:${sessionId}`);
        }
      }

      // Sort by start time (newest first)
      sessions.sort((a, b) => b.startTime - a.startTime);

      return res.status(200).json({
        sessions,
        count: sessions.length,
        timestamp: Date.now(),
      });
    } else if (req.method === 'DELETE') {
      // Cancel/abort a specific session
      const { sessionId } = req.query;

      if (!sessionId || typeof sessionId !== 'string') {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      try {
        // Get session data first
        const sessionData = await redis.get(`active_session:${sessionId}`);

        if (!sessionData) {
          return res.status(404).json({ error: 'Session not found' });
        }

        // Handle both string and object responses from Redis
        let session: ActiveSession;
        if (typeof sessionData === 'string') {
          session = JSON.parse(sessionData) as ActiveSession;
        } else {
          session = sessionData as ActiveSession;
        }

        // Mark session as cancelled by storing a cancellation flag
        await redis.setex(`session_cancelled:${sessionId}`, 300, 'true'); // 5 minute TTL

        // Remove from active sessions
        await redis.del(`active_session:${sessionId}`);
        await redis.srem('active_sessions_list', sessionId);

        return res.status(200).json({
          message: 'Session cancellation requested',
          sessionId,
          contextId: session.contextId,
          cancelled: true,
        });
      } catch (error) {
        console.error(`Error cancelling session ${sessionId}:`, error);
        return res.status(500).json({ error: 'Failed to cancel session' });
      }
    } else if (req.method === 'POST') {
      // Cancel all active sessions
      try {
        const activeSessionIds = await redis.smembers('active_sessions_list');

        for (const sessionId of activeSessionIds) {
          // Mark each session as cancelled
          await redis.setex(`session_cancelled:${sessionId}`, 300, 'true');

          // Remove from active sessions
          await redis.del(`active_session:${sessionId}`);
        }

        // Clear the active sessions list
        await redis.del('active_sessions_list');

        return res.status(200).json({
          message: 'All sessions cancellation requested',
          cancelledCount: activeSessionIds.length,
          cancelled: true,
        });
      } catch (error) {
        console.error('Error cancelling all sessions:', error);
        return res.status(500).json({ error: 'Failed to cancel all sessions' });
      }
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in active sessions handler:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Export the handler with internal access protection
export default withInternalAccess(handler);
