import { LinearClient } from "@linear/sdk";
import { goalEvaluator } from "../../ai/goal-evaluator.js";
import {
  agentActivity,
  linearAgentSessionManager,
} from "../../linear/linear-agent-session-manager.js";
import {
  determinePlatform,
  extractIssueIdFromContext,
} from "../context/context-extractor.js";
import {
  generateSessionId,
  storeActiveSession,
  updateActiveSession,
} from "../session/session-manager.js";
import { createCleanupFunction } from "../utils/cleanup.js";
import { generateResponseInternal } from "./response-internal.js";
import type { ActiveSession, GenerateResponseParams } from "./types.js";

const MAX_RETRY_ATTEMPTS = 2;

/**
 * Main response generation function - public interface
 */
export async function generateResponse({
  messages,
  updateStatus,
  linearClient,
  slackContext,
  abortSignal,
  agentSessionId,
}: GenerateResponseParams): Promise<string> {
  let attemptNumber = 1;
  let toolsUsed: string[] = [];
  let actionsPerformed: string[] = [];
  let finalResponse = "";
  let endedExplicitly = false;

  // Use provided agent session ID or generate unique session ID for tracking
  const sessionId = agentSessionId || generateSessionId();
  const contextId = extractIssueIdFromContext(messages, slackContext);
  const platform = determinePlatform(contextId, slackContext);

  // Create initial active session
  const activeSession: ActiveSession = {
    sessionId,
    contextId,
    startTime: Date.now(),
    platform,
    status: "initializing",
    toolsUsed: [],
    actionsPerformed: [],
    messages: [...messages],
    metadata: {
      issueId: contextId,
      channelId: slackContext?.channelId,
      threadTs: slackContext?.threadTs,
    },
  };

  // Store the active session
  await storeActiveSession(activeSession);

  // Log session initialization
  const isLinearIssue = !!(contextId && !contextId.startsWith("slack:"));
  if (isLinearIssue && linearClient) {
    await agentActivity.thought(
      contextId,
      `Session initialized for ${contextId}`,
    );
  }

  // Set up cleanup function
  const cleanup = createCleanupFunction({
    sessionId,
    contextId,
    isLinearIssue,
    linearClient,
  });

  // Set up abort handling
  if (abortSignal) {
    abortSignal.addEventListener("abort", async () => {
      await cleanup("cancelled", "Request was aborted by user");
    });
  }

  // Store original messages for goal evaluation
  const originalMessages = [...messages];

  try {
    while (attemptNumber <= MAX_RETRY_ATTEMPTS) {
      // Check for abort before each attempt
      if (abortSignal?.aborted) {
        await cleanup("cancelled", "Request was aborted during processing");
        throw new Error("Request was aborted during processing");
      }

      try {
        await updateActiveSession(sessionId, {
          status: "planning",
        });

        updateStatus?.("is thinking...");

        // Generate response using the internal function with abort signal
        const result = await generateResponseInternal(
          messages,
          updateStatus,
          linearClient,
          slackContext,
          attemptNumber,
          sessionId,
          abortSignal,
        );

        finalResponse = result.text;
        toolsUsed = result.toolsUsed;
        actionsPerformed = result.actionsPerformed;
        endedExplicitly = result.endedExplicitly;

        // Log linear completion thinking
        if (isLinearIssue && linearClient) {
          await agentActivity.thought(
            contextId,
            `Completed analysis using ${result.toolsUsed.length} tools`,
          );

          await agentActivity.response(contextId, finalResponse);
        }

        // If this is the last attempt, don't evaluate - just return
        if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
          break;
        }

        // Check for abort before evaluation
        if (abortSignal?.aborted) {
          await cleanup("cancelled", "Request was aborted during evaluation");
          throw new Error("Request was aborted during processing");
        }

        // Evaluate goal completion
        await updateActiveSession(sessionId, {
          status: "completing",
        });

        updateStatus?.(
          `Evaluating goal completion for attempt ${attemptNumber}...`,
        );

        const evaluation = await goalEvaluator.evaluateGoalCompletion(
          originalMessages,
          {
            toolsUsed,
            actionsPerformed,
            finalResponse,
            endedExplicitly,
          },
        );

        console.log(
          `Goal evaluation for attempt ${attemptNumber}:`,
          evaluation,
        );

        // If goal is achieved, break the loop
        if (evaluation.isComplete) {
          console.log(
            `Breaking retry loop: isComplete=${evaluation.isComplete}`,
          );
          break;
        }

        // If we should retry based on low confidence, prepare for next attempt
        if (evaluation.confidence < 0.7 && attemptNumber < MAX_RETRY_ATTEMPTS) {
          console.log(
            `Retrying attempt ${attemptNumber + 1}: ${evaluation.reasoning}`,
          );
          attemptNumber++;

          // Add evaluation feedback to the conversation context
          messages.push({
            role: "user",
            content: `[SYSTEM FEEDBACK] ${evaluation.reasoning}. Please try a different approach or provide additional analysis.`,
          });

          continue;
        }

        // If evaluation says we shouldn't retry or can't retry, stop
        break;
      } catch (error) {
        console.error(
          `Error in response generation attempt ${attemptNumber}:`,
          error,
        );

        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Handle specific error cases
        if (errorMessage.includes("STOP_COMMAND_RECEIVED")) {
          await cleanup("cancelled", "Stop command received");
          return "🛑 **Processing stopped as requested**";
        }

        if (errorMessage.includes("Request was aborted")) {
          await cleanup("cancelled", "Request was aborted");
          throw error;
        }

        // For other errors, try again if we have attempts left
        if (attemptNumber < MAX_RETRY_ATTEMPTS) {
          console.log(`Retrying due to error in attempt ${attemptNumber}`);
          attemptNumber++;

          // Add error context for retry
          messages.push({
            role: "user",
            content: `[ERROR RECOVERY] Previous attempt failed: ${errorMessage}. Please try a different approach.`,
          });

          continue;
        }

        // If this was the last attempt, clean up and re-throw
        await cleanup("error", errorMessage);
        throw error;
      }
    }

    // Successful completion
    await cleanup("completed");
    return finalResponse;
  } catch (error) {
    console.error("Fatal error in generateResponse:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Don't double-cleanup if already cleaned up
    if (
      !errorMessage.includes("Request was aborted") &&
      !errorMessage.includes("Stop command received")
    ) {
      await cleanup("error", errorMessage);
    }

    throw error;
  }
}
