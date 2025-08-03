import { Redis } from "@upstash/redis";
import { env } from "../../core/env.js";
import type { ActiveSession } from "../core/types.js";

// Initialize Redis client for session tracking
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

/**
 * Generate unique session ID
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Store active session in Redis
 */
export async function storeActiveSession(
  session: ActiveSession,
): Promise<void> {
  try {
    await redis.setex(
      `active_session:${session.sessionId}`,
      3600, // 1 hour TTL
      JSON.stringify(session),
    );

    // Also add to a set for easy listing
    await redis.sadd("active_sessions_list", session.sessionId);
  } catch (error) {
    console.error("Error storing active session:", error);
  }
}

/**
 * Update active session status
 */
export async function updateActiveSession(
  sessionId: string,
  updates: Partial<ActiveSession>,
): Promise<void> {
  try {
    const sessionData = await redis.get(`active_session:${sessionId}`);
    if (sessionData) {
      // Handle both string and object responses from Redis
      let session: ActiveSession;
      if (typeof sessionData === "string") {
        session = JSON.parse(sessionData) as ActiveSession;
      } else {
        session = sessionData as ActiveSession;
      }

      const updatedSession = { ...session, ...updates };
      await redis.setex(
        `active_session:${sessionId}`,
        3600,
        JSON.stringify(updatedSession),
      );
    }
  } catch (error) {
    console.error("Error updating active session:", error);
  }
}

/**
 * Store completed session
 */
export async function storeCompletedSession(
  sessionId: string,
  finalStatus: "completed" | "cancelled" | "error",
  error?: string,
): Promise<void> {
  try {
    // Get the current session data
    const sessionData = await redis.get(`active_session:${sessionId}`);
    if (sessionData) {
      // Handle both string and object responses from Redis
      let session: ActiveSession;
      if (typeof sessionData === "string") {
        session = JSON.parse(sessionData) as ActiveSession;
      } else {
        session = sessionData as ActiveSession;
      }

      // Create completed session with additional metadata
      const completedSession = {
        ...session,
        status: finalStatus,
        endTime: Date.now(),
        duration: Date.now() - session.startTime,
        error: error || null,
      };

      // Store in completed sessions without expiration
      await redis.set(
        `completed_session:${sessionId}`,
        JSON.stringify(completedSession),
      );

      // Add to completed sessions list (keep all, but we'll paginate on fetch)
      await redis.lpush("completed_sessions_list", sessionId);
    }
  } catch (error) {
    console.error("Error storing completed session:", error);
  }
}

/**
 * Remove active session
 */
export async function removeActiveSession(
  sessionId: string,
  finalStatus: "completed" | "cancelled" | "error" = "completed",
  error?: string,
): Promise<void> {
  try {
    // Store as completed session before removing
    await storeCompletedSession(sessionId, finalStatus, error);

    // Remove from active sessions
    await redis.del(`active_session:${sessionId}`);
    await redis.srem("active_sessions_list", sessionId);
  } catch (error) {
    console.error("Error removing active session:", error);
  }
}

/**
 * Check if there's already an active agent session for this issue
 */
export async function getActiveSessionForIssue(
  issueId: string,
): Promise<string | null> {
  try {
    const activeSessionsKeys = await redis.smembers("active_sessions_list");

    for (const sessionId of activeSessionsKeys) {
      const sessionData = await redis.get(`active_session:${sessionId}`);
      if (sessionData) {
        let session: ActiveSession;
        if (typeof sessionData === "string") {
          session = JSON.parse(sessionData) as ActiveSession;
        } else {
          session = sessionData as ActiveSession;
        }

        // Check if this session is for the same issue and still active
        if (
          session.metadata?.issueId === issueId &&
          ["initializing", "planning", "gathering", "acting"].includes(
            session.status,
          )
        ) {
          return sessionId;
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error checking for active session:", error);
    return null;
  }
}
