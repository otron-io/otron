import type { LinearClient } from "@linear/sdk";
import {
  agentActivity,
  linearAgentSessionManager,
} from "../../linear/linear-agent-session-manager.js";
import {
  removeActiveSession,
  updateActiveSession,
} from "../session/session-manager.js";

/**
 * Create a cleanup function for a response generation session
 */
export function createCleanupFunction({
  sessionId,
  contextId,
  isLinearIssue,
  linearClient,
}: {
  sessionId: string;
  contextId: string;
  isLinearIssue: boolean;
  linearClient?: LinearClient;
}) {
  return async (
    status: "completed" | "cancelled" | "error" = "completed",
    error?: string,
  ) => {
    console.log(`Cleaning up session ${sessionId} with status: ${status}`);

    try {
      // Remove active session (which also stores it as completed)
      await removeActiveSession(sessionId, status, error);

      // Complete Linear agent session if applicable
      if (isLinearIssue && linearClient) {
        try {
          await linearAgentSessionManager.completeSession(contextId);
        } catch (linearError) {
          console.error("Error completing Linear agent session:", linearError);
        }

        // Log final session status
        if (status === "completed") {
          await agentActivity.thought(
            contextId,
            "✅ Session completed successfully",
          );
        } else if (status === "cancelled") {
          await agentActivity.thought(contextId, "⏹️ Session cancelled by user");
        } else if (status === "error") {
          await agentActivity.thought(
            contextId,
            `❌ Session ended with error: ${error || "Unknown error"}`,
          );
        }
      }

      console.log(`Successfully cleaned up session ${sessionId}`);
    } catch (cleanupError) {
      console.error(
        `Error during session cleanup for ${sessionId}:`,
        cleanupError,
      );
    }
  };
}
