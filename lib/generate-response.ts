import { CoreMessage, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { LinearClient } from "@linear/sdk";
import { memoryManager } from "./memory/memory-manager.js";
import {
  linearAgentSessionManager,
  agentActivity,
} from "./linear/linear-agent-session-manager.js";
import { Redis } from "@upstash/redis";
import { env } from "./env.js";
import { createAllTools } from "./tools/index.js";
import { buildSystemPrompt } from "./system-prompt.js";

const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueuedMessage {
  timestamp: number;
  type: "created" | "prompted" | "stop";
  content: string;
  sessionId: string;
  issueId: string;
  userId?: string;
  metadata?: any;
}

interface ActiveSession {
  sessionId: string;
  contextId: string;
  startTime: number;
  platform: "slack" | "linear" | "github" | "general";
  status: "initializing" | "planning" | "gathering" | "acting" | "completing";
  currentTool?: string;
  toolsUsed: string[];
  actionsPerformed: string[];
  messages: CoreMessage[];
  metadata?: {
    issueId?: string;
    channelId?: string;
    threadTs?: string;
    userId?: string;
  };
}

export interface RepoDefinition {
  id: string;
  name: string;
  description: string;
  purpose: string;
  githubUrl: string;
  owner: string;
  repo: string;
  isActive: boolean;
  tags: string[];
  contextDescription: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function extractIssueIdFromContext(
  messages: CoreMessage[],
  slackContext?: { channelId: string; threadTs?: string }
): string {
  for (const message of messages) {
    if (typeof message.content === "string") {
      const issueMatch = message.content.match(/\b([A-Z]{2,}-\d+)\b/);
      if (issueMatch) return issueMatch[1];

      const issueIdMatch = message.content.match(/issue\s+([a-f0-9-]{36})/i);
      if (issueIdMatch) return issueIdMatch[1];
    }
  }

  if (slackContext?.channelId) {
    return `slack:${slackContext.channelId}${
      slackContext.threadTs ? `:${slackContext.threadTs}` : ""
    }`;
  }

  return "general";
}

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

async function storeActiveSession(session: ActiveSession): Promise<void> {
  try {
    await redis.setex(
      `active_session:${session.sessionId}`,
      3600,
      JSON.stringify(session)
    );
    await redis.sadd("active_sessions_list", session.sessionId);
  } catch (error) {
    console.error("Error storing active session:", error);
  }
}

async function updateActiveSession(
  sessionId: string,
  updates: Partial<ActiveSession>
): Promise<void> {
  try {
    const sessionData = await redis.get(`active_session:${sessionId}`);
    if (sessionData) {
      const session: ActiveSession =
        typeof sessionData === "string"
          ? JSON.parse(sessionData)
          : (sessionData as ActiveSession);

      await redis.setex(
        `active_session:${sessionId}`,
        3600,
        JSON.stringify({ ...session, ...updates })
      );
    }
  } catch (error) {
    console.error("Error updating active session:", error);
  }
}

async function storeCompletedSession(
  sessionId: string,
  finalStatus: "completed" | "cancelled" | "error",
  error?: string
): Promise<void> {
  try {
    const sessionData = await redis.get(`active_session:${sessionId}`);
    if (sessionData) {
      const session: ActiveSession =
        typeof sessionData === "string"
          ? JSON.parse(sessionData)
          : (sessionData as ActiveSession);

      await redis.set(
        `completed_session:${sessionId}`,
        JSON.stringify({
          ...session,
          status: finalStatus,
          endTime: Date.now(),
          duration: Date.now() - session.startTime,
          error: error || null,
        })
      );
      await redis.lpush("completed_sessions_list", sessionId);
    }
  } catch (error) {
    console.error("Error storing completed session:", error);
  }
}

async function removeActiveSession(
  sessionId: string,
  finalStatus: "completed" | "cancelled" | "error" = "completed",
  error?: string
): Promise<void> {
  try {
    await storeCompletedSession(sessionId, finalStatus, error);
    await redis.del(`active_session:${sessionId}`);
    await redis.srem("active_sessions_list", sessionId);
  } catch (error) {
    console.error("Error removing active session:", error);
  }
}

// ---------------------------------------------------------------------------
// Repository context
// ---------------------------------------------------------------------------

async function getRepositoryContext(): Promise<string> {
  try {
    const repoIds = await redis.smembers("repo_definitions");
    if (!repoIds || repoIds.length === 0) return "";

    const activeRepos: RepoDefinition[] = [];

    for (const repoId of repoIds) {
      try {
        const repoData = await redis.get(`repo_definition:${repoId}`);
        if (repoData) {
          const parsed =
            typeof repoData === "string"
              ? JSON.parse(repoData)
              : (repoData as RepoDefinition);
          if (parsed.isActive) activeRepos.push(parsed);
        }
      } catch {
        // Skip malformed entries
      }
    }

    if (activeRepos.length === 0) return "";

    activeRepos.sort((a, b) => a.name.localeCompare(b.name));

    let ctx = `## Repository Context\n\nThe following repositories are available in this environment:\n\n`;
    activeRepos.forEach((repo, i) => {
      ctx += `### ${i + 1}. ${repo.name} (${repo.owner}/${repo.repo})\n`;
      ctx += `- **Description**: ${repo.description}\n`;
      if (repo.purpose) ctx += `- **Purpose**: ${repo.purpose}\n`;
      if (repo.contextDescription)
        ctx += `- **Context**: ${repo.contextDescription}\n`;
      if (repo.tags?.length) ctx += `- **Tags**: ${repo.tags.join(", ")}\n`;
      ctx += `- **GitHub**: ${repo.githubUrl}\n\n`;
    });

    ctx += `**Repository Guidelines:**\n`;
    ctx += `- When working with code, consider the repository context above\n`;
    ctx += `- Use the appropriate repository for each task based on the descriptions\n`;
    ctx += `- Reference repository purposes when making architectural decisions\n`;
    ctx += `- Consider cross-repository dependencies when making changes\n\n`;
    return ctx;
  } catch (error) {
    console.error("Error fetching repository context:", error);
    return "";
  }
}

// ---------------------------------------------------------------------------
// Tool executor wrapper
// ---------------------------------------------------------------------------

function createToolExecutorWrapper(options: {
  sessionId?: string;
  contextId: string;
  isLinearIssue: boolean;
  linearClient?: LinearClient;
  messages: CoreMessage[];
  abortSignal?: AbortSignal;
}) {
  const { sessionId, contextId, isLinearIssue, linearClient, messages, abortSignal } =
    options;

  const toolsUsed = new Set<string>();
  const actionsPerformed: string[] = [];
  const recentToolCalls: string[] = [];

  const wrapper = (toolName: string, originalExecutor: Function) => {
    return async (...args: any[]) => {
      // Update session
      if (sessionId) {
        await updateActiveSession(sessionId, {
          currentTool: toolName,
          toolsUsed: Array.from(toolsUsed).concat([toolName]),
        });
      }

      // Check abort
      if (abortSignal?.aborted) {
        throw new Error("Request was aborted during tool execution");
      }

      // Check Redis cancellation
      if (sessionId) {
        try {
          const cancelled = await redis.get(`session_cancelled:${sessionId}`);
          if (cancelled) {
            await storeCompletedSession(sessionId, "cancelled", "Cancelled by user");
            await redis.del(`active_session:${sessionId}`);
            await redis.srem("active_sessions_list", sessionId);
            throw new Error("Request was cancelled by user");
          }
        } catch (e) {
          if (e instanceof Error && e.message === "Request was cancelled by user") throw e;
        }
      }

      // Circuit breaker
      const sig = `${toolName}:${JSON.stringify(args[0] || {})}`;
      const identicalCount = recentToolCalls.filter((c) => c === sig).length;
      if (identicalCount >= 3) {
        const msg = `Circuit breaker: ${toolName} called ${identicalCount + 1} times with identical parameters. Try a different approach.`;
        console.warn(msg);
        throw new Error(msg);
      }
      recentToolCalls.push(sig);
      if (recentToolCalls.length > 10) recentToolCalls.splice(0, recentToolCalls.length - 10);

      // Check queued messages (interjections)
      if (sessionId && isLinearIssue && linearClient) {
        try {
          const queued = await getQueuedMessages(sessionId);
          if (queued.length > 0) {
            const stopMsg = queued.find((m) => m.type === "stop");
            if (stopMsg) {
              await agentActivity.response(
                contextId,
                "Stopping all operations as requested."
              );
              throw new Error("STOP_COMMAND_RECEIVED");
            }
            for (const q of queued) {
              if (q.type !== "stop") {
                messages.push({
                  role: "user",
                  content: `[INTERJECTION ${new Date(q.timestamp).toISOString()}] ${q.content}`,
                });
              }
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message === "STOP_COMMAND_RECEIVED") throw e;
        }
      }

      try {
        const result = await originalExecutor(...args);
        toolsUsed.add(toolName);
        const resStr = typeof result === "string" ? result : JSON.stringify(result);
        actionsPerformed.push(`${toolName}: ${resStr.substring(0, 100)}...`);

        await memoryManager.trackToolUsage(toolName, true, {
          issueId: contextId,
          input: args[0],
          response: resStr.substring(0, 500),
        });

        return result;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);

        await memoryManager.trackToolUsage(toolName, false, {
          issueId: contextId,
          input: args[0],
          response: errMsg,
        });

        return {
          success: false,
          error: errMsg,
          message: `TOOL FAILED: ${toolName} - ${errMsg}`,
          guidance: "Review the error message and try an alternative approach.",
        };
      }
    };
  };

  return {
    wrapper,
    getResults: () => ({
      toolsUsed: Array.from(toolsUsed),
      actionsPerformed,
    }),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export const generateResponse = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient,
  slackContext?: { channelId: string; threadTs?: string },
  abortSignal?: AbortSignal,
  agentSessionId?: string
): Promise<string> => {
  const sessionId = agentSessionId || generateSessionId();
  const contextId = extractIssueIdFromContext(messages, slackContext);

  let platform: "slack" | "linear" | "github" | "general" = "general";
  if (slackContext) platform = "slack";
  else if (contextId && !contextId.startsWith("slack:")) platform = "linear";

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

  await storeActiveSession(activeSession);

  if (linearClient) {
    linearAgentSessionManager.setLinearClient(linearClient);
  }

  const cleanup = async (
    status: "completed" | "cancelled" | "error" = "completed",
    error?: string
  ) => {
    await removeActiveSession(sessionId, status, error);
    // Don't complete the Linear session if a coding task was dispatched —
    // the worker will post activity on it and complete it when done.
    if (agentSessionId && !codingTaskDispatched) {
      try {
        await linearAgentSessionManager.completeSession(agentSessionId);
      } catch {
        // Best effort
      }
    }
  };

  if (abortSignal?.aborted) {
    await cleanup("cancelled", "Aborted before processing");
    throw new Error("Aborted before processing");
  }

  const isLinearIssue = contextId && !contextId.startsWith("slack:");

  // Flag set by dispatchCodingTask tool — when true, the Linear session
  // stays open so the worker can post activity on it.
  let codingTaskDispatched = false;

  try {
    if (abortSignal?.aborted) {
      await cleanup("cancelled", "Aborted during processing");
      throw new Error("Aborted during processing");
    }

    await updateActiveSession(sessionId, { status: "planning" });
    updateStatus?.("is thinking...");

    // Store user message in memory
    try {
      const last = messages[messages.length - 1];
      const content =
        typeof last?.content === "string"
          ? last.content
          : Array.isArray(last?.content)
          ? last.content.map((p) => ("text" in p ? p.text : JSON.stringify(p))).join(" ")
          : "No content";
      await memoryManager.storeMemory(contextId, "conversation", {
        role: "user",
        content,
        timestamp: Date.now(),
        platform: slackContext ? "slack" : "linear",
      });
    } catch {
      // Best effort
    }

    // Retrieve memory context
    let memoryContext = "";
    try {
      const last = messages[messages.length - 1];
      const currentContent =
        typeof last?.content === "string"
          ? last.content
          : Array.isArray(last?.content)
          ? last.content.map((p) => ("text" in p ? p.text : "")).join(" ")
          : "";
      const prev = await memoryManager.getPreviousConversations(contextId, currentContent);
      const history = await memoryManager.getIssueHistory(contextId);
      memoryContext = prev + history;
    } catch {
      // Best effort
    }

    const repositoryContext = await getRepositoryContext();

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      sessionId,
      slackContext,
      repositoryContext,
      memoryContext,
    });

    // Build abort-aware sleep helper
    const sleepWithAbort = (seconds: number, abort?: AbortSignal): Promise<string> => {
      const bounded = Math.max(0, Math.min(60, Math.floor(seconds)));
      return new Promise((resolve, reject) => {
        if (abort?.aborted || abortSignal?.aborted) return reject(new Error("Sleep aborted"));
        if (bounded === 0) return resolve("Slept for 0 seconds");

        const onAbort = () => {
          clearTimeout(tid);
          reject(new Error("Sleep aborted"));
        };
        const tid = setTimeout(() => {
          abortSignal?.removeEventListener("abort", onAbort);
          resolve(`Slept for ${bounded} seconds`);
        }, bounded * 1000);
        abortSignal?.addEventListener("abort", onAbort, { once: true });
      });
    };

    // Create tool executor wrapper
    const { wrapper: executor, getResults } = createToolExecutorWrapper({
      sessionId,
      contextId,
      isLinearIssue: !!isLinearIssue,
      linearClient,
      messages,
      abortSignal,
    });

    // Create all tools
    const tools = createAllTools({
      executor,
      updateStatus,
      linearClient,
      sleepWithAbort,
      codingContext: {
        slackChannelId: slackContext?.channelId,
        slackThreadTs: slackContext?.threadTs,
        linearSessionId: agentSessionId,
        linearIssueId: isLinearIssue ? contextId : undefined,
        linearIssueIdentifier: isLinearIssue ? contextId : undefined,
      },
      onCodingTaskDispatched: () => {
        codingTaskDispatched = true;
      },
    });

    // Call the model
    const { text } = await generateText({
      model: anthropic("claude-opus-4-7"),
      system: systemPrompt,
      messages,
      maxSteps: 30,
      abortSignal,
      tools,
    });

    // Log completion to Linear
    if (isLinearIssue && linearClient) {
      const { toolsUsed } = getResults();
      await agentActivity.thought(
        contextId,
        `Completed analysis using ${toolsUsed.length} tools`
      );
      await agentActivity.response(contextId, text);
    }

    // Store assistant response in memory
    try {
      await memoryManager.storeMemory(contextId, "conversation", {
        role: "assistant",
        content: [{ type: "text", text }],
      });
    } catch {
      // Best effort
    }

    return text;
  } finally {
    await cleanup();
  }
};

// ---------------------------------------------------------------------------
// Session coordination & message queuing (used by webhook handlers)
// ---------------------------------------------------------------------------

export async function getActiveSessionForIssue(
  issueId: string
): Promise<string | null> {
  try {
    const sessionIds = await redis.smembers("active_sessions_list");

    for (const sessionId of sessionIds) {
      const data = await redis.get(`active_session:${sessionId}`);
      if (data) {
        const session: ActiveSession =
          typeof data === "string" ? JSON.parse(data) : (data as ActiveSession);

        if (
          session.metadata?.issueId === issueId &&
          ["initializing", "planning", "gathering", "acting"].includes(session.status)
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

export async function queueMessageForSession(
  sessionId: string,
  message: QueuedMessage
): Promise<void> {
  try {
    const key = `message_queue:${sessionId}`;
    await redis.lpush(key, JSON.stringify(message));
    await redis.expire(key, 3600);
  } catch (error) {
    console.error("Error queuing message:", error);
  }
}

export async function getQueuedMessages(
  sessionId: string
): Promise<QueuedMessage[]> {
  try {
    const key = `message_queue:${sessionId}`;
    const raw = await redis.lrange(key, 0, -1);

    if (raw.length > 0) {
      await redis.del(key);
      return raw.reverse().map((msg) =>
        typeof msg === "string" ? JSON.parse(msg) : (msg as QueuedMessage)
      );
    }

    return [];
  } catch (error) {
    console.error("Error getting queued messages:", error);
    return [];
  }
}
