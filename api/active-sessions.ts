import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../lib/env.js';
import { withInternalAccess } from '../lib/auth.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

interface BaseSession {
  sessionId: string;
  contextId: string;
  startTime: number;
  platform: 'slack' | 'linear' | 'github' | 'general';
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

interface ActiveSession extends BaseSession {
  status: 'initializing' | 'planning' | 'gathering' | 'acting' | 'completing';
}

interface CompletedSession extends BaseSession {
  status: 'completed' | 'cancelled' | 'error';
  endTime: number;
  duration: number;
  error?: string | null;
}

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      // Get query parameters
      const {
        includeCompleted = 'true',
        limit = '20',
        offset = '0',
        days = '7',
        status = 'all',
      } = req.query;

      const shouldIncludeCompleted = includeCompleted === 'true';
      const sessionLimit = Math.min(parseInt(limit as string) || 20, 200); // Allow up to 200
      const sessionOffset = Math.max(parseInt(offset as string) || 0, 0);
      const daysBack = Math.min(parseInt(days as string) || 7, 365); // Max 1 year
      const statusFilter = status as string;

      // Get all active sessions
      const activeSessionIds = await redis.smembers('active_sessions_list');
      const activeSessions: ActiveSession[] = [];

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
            activeSessions.push(session);
          } else {
            // Clean up orphaned session ID
            await redis.srem('active_sessions_list', sessionId);
          }
        } catch (error) {
          console.error(`Error parsing active session ${sessionId}:`, error);
          // Clean up problematic session
          await redis.srem('active_sessions_list', sessionId);
          await redis.del(`active_session:${sessionId}`);
        }
      }

      // Get completed sessions if requested
      const completedSessions: CompletedSession[] = [];
      let totalCompletedCount = 0;
      let hasMore = false;

      if (shouldIncludeCompleted) {
        // Get total count first
        totalCompletedCount = await redis.llen('completed_sessions_list');

        // Calculate pagination
        const endIndex = sessionOffset + sessionLimit - 1;
        hasMore = endIndex < totalCompletedCount - 1;

        // Get paginated session IDs
        const completedSessionIds = await redis.lrange(
          'completed_sessions_list',
          sessionOffset,
          endIndex
        );

        // Calculate date cutoff
        const cutoffTime = Date.now() - daysBack * 24 * 60 * 60 * 1000;

        for (const sessionId of completedSessionIds) {
          try {
            const sessionData = await redis.get(
              `completed_session:${sessionId}`
            );
            if (sessionData) {
              // Handle both string and object responses from Redis
              let session: CompletedSession;
              if (typeof sessionData === 'string') {
                session = JSON.parse(sessionData) as CompletedSession;
              } else {
                session = sessionData as CompletedSession;
              }

              // Apply date filter
              if (session.startTime >= cutoffTime) {
                // Apply status filter
                if (statusFilter === 'all' || session.status === statusFilter) {
                  completedSessions.push(session);
                }
              }
            } else {
              // Clean up orphaned session ID
              await redis.lrem('completed_sessions_list', 1, sessionId);
            }
          } catch (error) {
            console.error(
              `Error parsing completed session ${sessionId}:`,
              error
            );
            // Clean up problematic session
            await redis.lrem('completed_sessions_list', 1, sessionId);
            await redis.del(`completed_session:${sessionId}`);
          }
        }
      }

      // Sort sessions by start time (newest first)
      activeSessions.sort((a, b) => b.startTime - a.startTime);
      completedSessions.sort((a, b) => b.startTime - a.startTime);

      return res.status(200).json({
        activeSessions,
        completedSessions,
        // Legacy field for backward compatibility
        sessions: activeSessions,
        counts: {
          active: activeSessions.length,
          completed: completedSessions.length,
          total: activeSessions.length + completedSessions.length,
          totalCompleted: totalCompletedCount,
        },
        pagination: {
          limit: sessionLimit,
          offset: sessionOffset,
          hasMore,
          daysBack,
          statusFilter,
        },
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
