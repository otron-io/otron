import type { LinearClient } from "@linear/sdk";
import { Redis } from "@upstash/redis";
import type { CoreMessage } from "ai";
import { env } from "../../core/env.js";
import {
  agentActivity,
  linearAgentSessionManager,
} from "../../linear/linear-agent-session-manager.js";
import { memoryManager } from "../../memory/memory-manager.js";
import { client as slackClient } from "../../slack/slack-utils.js";
import type {
  ExecutionStrategy,
  ExecutionTracker,
  SlackContext,
} from "../core/types.js";
import { getQueuedMessages } from "../session/message-queue.js";
import {
  storeCompletedSession,
  updateActiveSession,
} from "../session/session-manager.js";

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Detailed tool context generator
const getDetailedToolContext = (toolName: string, params: any): string => {
  const contextLines = [];

  // Basic tool info with improved formatting
  contextLines.push(`**Tool:** ${toolName}`);

  // Parameters with better structure
  if (params && Object.keys(params).length > 0) {
    contextLines.push("**Parameters:**");
    Object.entries(params).forEach(([key, value]) => {
      const formattedValue =
        typeof value === "string" && value.length > 100
          ? `${value.substring(0, 100)}...`
          : JSON.stringify(value);
      contextLines.push(`  • ${key}: ${formattedValue}`);
    });
  }

  return contextLines.join("\n");
};

// Success details generator
const getSuccessDetails = (
  toolName: string,
  result: any,
  input: any,
): string => {
  // Return concise success message with key details
  if (!result) return "Completed successfully";

  // Extract meaningful info based on tool type
  if (toolName.includes("search") || toolName.includes("Search")) {
    const resultCount = Array.isArray(result)
      ? result.length
      : result.results?.length || "unknown";
    return `Found ${resultCount} results`;
  }

  if (toolName.includes("File") || toolName.includes("file")) {
    if (result.totalLines) {
      return `Read ${result.totalLines} lines from ${
        input.file_path || input.path
      }`;
    }
    if (result.length || result.content?.length) {
      const size = result.length || result.content.length;
      return `Processed ${size} characters`;
    }
  }

  if (toolName.includes("create") || toolName.includes("Create")) {
    return result.id || result.url || result.number
      ? `Created successfully (${result.id || result.url || result.number})`
      : "Created successfully";
  }

  if (toolName.includes("update") || toolName.includes("Update")) {
    return "Updated successfully";
  }

  // Fallback
  const preview =
    typeof result === "string"
      ? result.substring(0, 50)
      : result.text?.substring(0, 50) ||
        result.message?.substring(0, 50) ||
        "Success";

  return preview.length > 50 ? `${preview}...` : preview;
};

// Failure context generator
const getFailureContext = (
  toolName: string,
  error: string,
  input: any,
): string => {
  if (error.includes("File not found") || error.includes("404")) {
    return `File/resource not found: ${
      input?.file_path || input?.path || "unknown"
    }`;
  }
  if (error.includes("permission") || error.includes("403")) {
    return "Permission denied - check access rights";
  }
  if (error.includes("rate limit") || error.includes("429")) {
    return "Rate limit exceeded - wait before retrying";
  }
  return error.length > 200 ? `${error.substring(0, 200)}...` : error;
};

// Error guidance generator
const getErrorGuidance = (
  toolName: string,
  error: string,
  input: any,
): string => {
  if (error.includes("File not found") || error.includes("404")) {
    return "Try checking if the file path is correct or use a different file.";
  }
  if (error.includes("permission") || error.includes("403")) {
    return "Verify you have the necessary permissions for this operation.";
  }
  if (error.includes("Old code not found") || error.includes("not match")) {
    return "Read the current file content first and use exact code for editing.";
  }
  if (error.includes("rate limit") || error.includes("429")) {
    return "Wait a moment before trying again, or use a different approach.";
  }
  if (error.includes("network") || error.includes("timeout")) {
    return "Check your connection or try the operation again.";
  }
  return "Consider trying a different approach or checking the input parameters.";
};

/**
 * Create a memory-aware tool executor wrapper
 */
export function createMemoryAwareToolExecutor(
  toolName: string,
  originalExecutor: Function,
  {
    executionTracker,
    executionStrategy,
    sessionId,
    contextId,
    isLinearIssue,
    linearClient,
    slackContext,
    messages,
    abortSignal,
  }: {
    executionTracker: ExecutionTracker;
    executionStrategy: ExecutionStrategy;
    sessionId?: string;
    contextId: string;
    isLinearIssue: boolean;
    linearClient?: LinearClient;
    slackContext?: SlackContext;
    messages: CoreMessage[];
    abortSignal?: AbortSignal;
  },
) {
  return async (...args: any[]) => {
    let success = false;
    let response = "";
    let detailedOutput: any = null;

    // Update current tool in session
    if (sessionId) {
      await updateActiveSession(sessionId, {
        currentTool: toolName,
        toolsUsed: Array.from(executionTracker.toolsUsed).concat([toolName]),
      });
    }

    // Check for abort signal before executing tool
    if (abortSignal?.aborted) {
      throw new Error("Request was aborted during tool execution");
    }

    // Check for cancellation from external source (Redis)
    if (sessionId) {
      try {
        const cancelled = await redis.get(`session_cancelled:${sessionId}`);
        if (cancelled) {
          // Store as cancelled session before throwing
          await storeCompletedSession(
            sessionId,
            "cancelled",
            "Request was cancelled by user",
          );
          await redis.del(`active_session:${sessionId}`);
          await redis.srem("active_sessions_list", sessionId);
          throw new Error("Request was cancelled by user");
        }
      } catch (redisError) {
        // Don't fail on Redis errors, but log them
        console.warn("Error checking cancellation status:", redisError);
      }
    }

    // Circuit breaker: Prevent identical repeated calls (anti-loop protection)
    const callSignature = `${toolName}:${JSON.stringify(args[0] || {})}`;
    const recentCalls = executionTracker.recentToolCalls || [];
    const identicalCallCount = recentCalls.filter(
      (call: string) => call === callSignature,
    ).length;

    if (identicalCallCount >= 3) {
      const errorMsg = `🚫 Circuit breaker activated: ${toolName} called ${
        identicalCallCount + 1
      } times with identical parameters. This suggests an infinite retry loop. Try a different approach or tool.`;
      console.warn(errorMsg);

      // Log to Linear if available
      if (isLinearIssue && linearClient) {
        await agentActivity.thought(contextId, `❌ ${errorMsg}`);
      }

      throw new Error(errorMsg);
    }

    // Track this call
    if (!executionTracker.recentToolCalls) {
      executionTracker.recentToolCalls = [];
    }
    executionTracker.recentToolCalls.push(callSignature);

    // Keep only last 10 calls to prevent memory bloat
    if (executionTracker.recentToolCalls.length > 10) {
      executionTracker.recentToolCalls =
        executionTracker.recentToolCalls.slice(-10);
    }

    // Check for queued messages from other webhooks/interjections
    if (sessionId && isLinearIssue && linearClient) {
      try {
        const queuedMessages = await getQueuedMessages(sessionId);
        if (queuedMessages.length > 0) {
          console.log(
            `Found ${queuedMessages.length} queued messages for session ${sessionId}`,
          );

          // Log that we're processing interjections
          await agentActivity.thought(
            contextId,
            `Processing ${queuedMessages.length} new message(s) received during analysis`,
          );

          // Check for stop commands first
          const stopMessage = queuedMessages.find((msg) => msg.type === "stop");
          if (stopMessage) {
            console.log(
              `🛑 Stop command found in queued messages for session ${sessionId}`,
            );

            // Log the stop command
            if (isLinearIssue && linearClient) {
              await agentActivity.response(
                contextId,
                "🛑 **Otron is immediately stopping all operations** as requested. Processing has been terminated.",
              );
            }

            // Reply to Slack thread if conversation originated from Slack
            if (slackContext) {
              await slackClient.chat.postMessage({
                channel: slackContext.channelId,
                thread_ts: slackContext.threadTs,
                text: "🛑 **Otron is immediately stopping all operations** as requested. Processing has been terminated.",
              });
            }

            // Abort the current processing
            throw new Error("STOP_COMMAND_RECEIVED");
          }

          // Add non-stop queued messages to the conversation context
          for (const queuedMsg of queuedMessages) {
            if (queuedMsg.type !== "stop") {
              messages.push({
                role: "user",
                content: `[INTERJECTION ${new Date(
                  queuedMsg.timestamp,
                ).toISOString()}] ${queuedMsg.content}`,
              });
            }
          }

          // Update the session with new messages
          await updateActiveSession(sessionId, { messages });

          console.log(
            `Added ${queuedMessages.length} interjection messages to conversation context`,
          );
        }
      } catch (messageError) {
        // Don't fail on message polling errors, but log them
        console.warn("Error checking for queued messages:", messageError);
      }
    }

    // Track tool usage counts
    const currentCount = executionStrategy.toolUsageCounts.get(toolName) || 0;
    executionStrategy.toolUsageCounts.set(toolName, currentCount + 1);

    // Categorize tool types and enforce limits
    const searchTools = [
      "searchEmbeddedCode",
      "searchLinearIssues",
      "searchSlackMessages",
    ];
    const readTools = [
      "getFileContent",
      "getRawFileContent",
      "readRelatedFiles",
      "getIssueContext",
    ];
    const actionTools = [
      "createFile",
      "editCode",
      "addCode",
      "removeCode",
      "editUrl",
      "createBranch",
      "createPullRequest",
      "updateIssueStatus",
      "createLinearComment",
      "setIssueParent",
      "addIssueToProject",
      "createAgentActivity",
      "sendSlackMessage",
      "sendChannelMessage",
      "sendDirectMessage",
    ];
    const analysisTools = [
      "analyzeFileStructure",
      "getRepositoryStructure",
      "getDirectoryStructure",
    ];

    // Track operations without limits
    if (searchTools.includes(toolName)) {
      executionStrategy.searchOperations++;
    }

    if (readTools.includes(toolName)) {
      executionStrategy.readOperations++;
    }

    if (analysisTools.includes(toolName)) {
      executionStrategy.analysisOperations++;
    }

    if (actionTools.includes(toolName)) {
      executionStrategy.actionOperations++;
      if (!executionStrategy.hasStartedActions) {
        // Log transition to action phase
        if (isLinearIssue && linearClient) {
          await agentActivity.thought(
            contextId,
            `Starting to take some action with ${toolName}`,
          );
        }
      }
      executionStrategy.hasStartedActions = true;
      executionStrategy.phase = "acting";
    }

    // Update execution phase based on tool usage (without limits)
    if (
      executionStrategy.searchOperations +
        executionStrategy.readOperations +
        executionStrategy.analysisOperations >=
        3 &&
      executionStrategy.phase === "planning"
    ) {
      executionStrategy.phase = "gathering";
      // Log phase transition thinking
      if (isLinearIssue && linearClient) {
        await agentActivity.thought(
          contextId,
          `Moving from planning to information gathering. Completed ${
            executionStrategy.searchOperations +
            executionStrategy.readOperations +
            executionStrategy.analysisOperations
          } operations.`,
        );
      }
    }

    // Enhanced Linear tool logging with context
    const inputParams = args[0] || {};
    const detailedContext = getDetailedToolContext(toolName, inputParams);

    // Log tool start with enhanced context if working on Linear issue
    if (isLinearIssue && linearClient) {
      try {
        await agentActivity.thought(contextId, `🔧 ${detailedContext}`);
      } catch (error) {
        console.error("Error logging tool start to Linear:", error);
      }
    }

    try {
      // Execute the actual tool
      const result = await originalExecutor(...args);
      success = true;
      detailedOutput = result;

      // Enhanced success logging
      const successDetails = getSuccessDetails(toolName, result, inputParams);
      response = `✅ ${toolName}: ${successDetails}`;

      // Log success with details if working on Linear issue
      if (isLinearIssue && linearClient) {
        try {
          await agentActivity.thought(contextId, response);
        } catch (error) {
          console.error("Error logging tool success to Linear:", error);
        }
      }

      // Track tool usage
      executionTracker.toolsUsed.add(toolName);

      // Memory storage
      try {
        const memoryContent = {
          tool: toolName,
          input: inputParams,
          success,
          output: detailedOutput,
          timestamp: Date.now(),
        };

        await memoryManager.storeMemory(contextId, "action", memoryContent);
      } catch (memoryError) {
        console.error("Error storing tool execution in memory:", memoryError);
      }

      return result;
    } catch (error) {
      success = false;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Enhanced error logging
      const failureContext = getFailureContext(
        toolName,
        errorMessage,
        inputParams,
      );
      const errorGuidance = getErrorGuidance(
        toolName,
        errorMessage,
        inputParams,
      );

      response = `❌ ${toolName}: ${failureContext}`;

      // Log failure with context and guidance if working on Linear issue
      if (isLinearIssue && linearClient) {
        try {
          await agentActivity.thought(
            contextId,
            `${response}\n💡 **Suggestion**: ${errorGuidance}`,
          );
        } catch (logError) {
          console.error("Error logging tool failure to Linear:", logError);
        }
      }

      // Memory storage for failures too
      try {
        const memoryContent = {
          tool: toolName,
          input: inputParams,
          success,
          error: errorMessage,
          timestamp: Date.now(),
        };

        await memoryManager.storeMemory(contextId, "action", memoryContent);
      } catch (memoryError) {
        console.error("Error storing tool failure in memory:", memoryError);
      }

      // Re-throw the error to maintain normal error handling flow
      throw error;
    }
  };
}
