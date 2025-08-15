import { CoreMessage, generateText, tool } from 'ai';
import { z } from 'zod';
import {
  // Exa search tools
  executeExaSearch,
  executeExaCrawlContent,
  executeExaFindSimilar,
} from './exa/exa-utils.js';
import {
  // Linear tools
  executeGetIssueContext,
  executeUpdateIssueStatus,
  executeAddLabel,
  executeRemoveLabel,
  executeAssignIssue,
  executeCreateIssue,
  executeAddIssueAttachment,
  executeUpdateIssuePriority,
  executeSetPointEstimate,
  executeGetLinearTeams,
  executeGetLinearProjects,
  executeGetLinearInitiatives,
  executeGetLinearUsers,
  executeGetLinearRecentIssues,
  executeSearchLinearIssues,
  executeGetLinearWorkflowStates,
  executeCreateLinearComment,
  executeCreateAgentActivity,
  executeSetIssueParent,
  executeAddIssueToProject,
} from './linear-tools.js';
import {
  // Slack tools
  executeAddSlackReaction,
  executeRemoveSlackReaction,
  executeGetSlackChannelHistory,
  executeGetSlackThread,
  executeUpdateSlackMessage,
  executeDeleteSlackMessage,
  executeGetSlackUserInfo,
  executeGetSlackChannelInfo,
  executeJoinSlackChannel,
  executeSetSlackStatus,
  executePinSlackMessage,
  executeUnpinSlackMessage,
  executeSendRichSlackMessage,
  executeSendRichChannelMessage,
  executeSendRichDirectMessage,
  executeCreateFormattedSlackMessage,
  executeRespondToSlackInteraction,
} from './slack-tools.js';
import {
  // GitHub tools
  executeGetFileContent,
  executeCreatePullRequest,
  executeGetPullRequest,
  executeAddPullRequestComment,
  executeGetPullRequestFiles,
  executeGetDirectoryStructure,
  executeCreateIssue as executeGithubCreateIssue,
  executeGetIssue as executeGithubGetIssue,
  executeListIssues as executeGithubListIssues,
  executeAddIssueComment as executeGithubAddIssueComment,
  executeUpdateIssue as executeGithubUpdateIssue,
  executeGetIssueComments as executeGithubGetIssueComments,
  // Embedded repository tools
  executeSearchEmbeddedCode,
} from './tool-executors.js';
import { LinearClient } from '@linear/sdk';
import { memoryManager } from './memory/memory-manager.js';
import { goalEvaluator } from './goal-evaluator.js';
import { openai } from '@ai-sdk/openai';
import {
  linearAgentSessionManager,
  agentActivity,
} from './linear/linear-agent-session-manager.js';
import { Redis } from '@upstash/redis';
import { env } from './env.js';

// Initialize Redis client for tracking active responses and message queuing
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Interface for queued messages during agent processing
export interface QueuedMessage {
  timestamp: number;
  type: 'created' | 'prompted' | 'stop';
  content: string;
  sessionId: string;
  issueId: string;
  userId?: string;
  metadata?: any;
}

// Interface for tracking active response sessions
interface ActiveSession {
  sessionId: string;
  contextId: string;
  startTime: number;
  platform: 'slack' | 'linear' | 'github' | 'general';
  status: 'initializing' | 'planning' | 'gathering' | 'acting' | 'completing';
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

// Helper function to extract issue ID from context
function extractIssueIdFromContext(
  messages: CoreMessage[],
  slackContext?: { channelId: string; threadTs?: string }
): string {
  // Try to extract issue ID from message content
  for (const message of messages) {
    if (typeof message.content === 'string') {
      // Look for Linear issue patterns like OTR-123, ABC-456, etc.
      const issueMatch = message.content.match(/\b([A-Z]{2,}-\d+)\b/);
      if (issueMatch) {
        return issueMatch[1];
      }

      // Look for issue ID in Linear notification context
      const issueIdMatch = message.content.match(/issue\s+([a-f0-9-]{36})/i);
      if (issueIdMatch) {
        return issueIdMatch[1];
      }
    }
  }

  // If no issue ID found in messages, use Slack context as fallback
  if (slackContext?.channelId) {
    return `slack:${slackContext.channelId}${
      slackContext.threadTs ? `:${slackContext.threadTs}` : ''
    }`;
  }

  // Default fallback
  return 'general';
}

// Helper function to generate unique session ID
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Helper function to store active session in Redis
async function storeActiveSession(session: ActiveSession): Promise<void> {
  try {
    await redis.setex(
      `active_session:${session.sessionId}`,
      3600, // 1 hour TTL
      JSON.stringify(session)
    );

    // Also add to a set for easy listing
    await redis.sadd('active_sessions_list', session.sessionId);
  } catch (error) {
    console.error('Error storing active session:', error);
  }
}

// Helper function to update active session status
async function updateActiveSession(
  sessionId: string,
  updates: Partial<ActiveSession>
): Promise<void> {
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

      const updatedSession = { ...session, ...updates };
      await redis.setex(
        `active_session:${sessionId}`,
        3600,
        JSON.stringify(updatedSession)
      );
    }
  } catch (error) {
    console.error('Error updating active session:', error);
  }
}

// Helper function to store completed session
async function storeCompletedSession(
  sessionId: string,
  finalStatus: 'completed' | 'cancelled' | 'error',
  error?: string
): Promise<void> {
  try {
    // Get the current session data
    const sessionData = await redis.get(`active_session:${sessionId}`);
    if (sessionData) {
      // Handle both string and object responses from Redis
      let session: ActiveSession;
      if (typeof sessionData === 'string') {
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
        JSON.stringify(completedSession)
      );

      // Add to completed sessions list (keep all, but we'll paginate on fetch)
      await redis.lpush('completed_sessions_list', sessionId);
    }
  } catch (error) {
    console.error('Error storing completed session:', error);
  }
}

// Helper function to remove active session
async function removeActiveSession(
  sessionId: string,
  finalStatus: 'completed' | 'cancelled' | 'error' = 'completed',
  error?: string
): Promise<void> {
  try {
    // Store as completed session before removing
    await storeCompletedSession(sessionId, finalStatus, error);

    // Remove from active sessions
    await redis.del(`active_session:${sessionId}`);
    await redis.srem('active_sessions_list', sessionId);
  } catch (error) {
    console.error('Error removing active session:', error);
  }
}

export const generateResponse = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient,
  slackContext?: {
    channelId: string;
    threadTs?: string;
  },
  abortSignal?: AbortSignal,
  agentSessionId?: string
): Promise<string> => {
  const MAX_RETRY_ATTEMPTS = 1;
  let attemptNumber = 1;
  let toolsUsed: string[] = [];
  let actionsPerformed: string[] = [];
  let finalResponse = '';
  let endedExplicitly = false;

  // Use provided agent session ID or generate unique session ID for tracking
  const sessionId = agentSessionId || generateSessionId();
  const contextId = extractIssueIdFromContext(messages, slackContext);

  // Determine platform
  let platform: 'slack' | 'linear' | 'github' | 'general' = 'general';
  if (slackContext) {
    platform = 'slack';
  } else if (contextId && !contextId.startsWith('slack:')) {
    platform = 'linear';
  }

  // Create initial active session
  const activeSession: ActiveSession = {
    sessionId,
    contextId,
    startTime: Date.now(),
    platform,
    status: 'initializing',
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
  if (contextId && !contextId.startsWith('slack:') && linearClient) {
    await agentActivity.thought(
      contextId,
      `Session initialized for ${contextId}`
    );
  }

  // Set up abort handling
  const cleanup = async (
    status: 'completed' | 'cancelled' | 'error' = 'completed',
    error?: string
  ) => {
    await removeActiveSession(sessionId, status, error);

    // Also complete the Linear agent session if this is a Linear agent session
    if (agentSessionId) {
      try {
        await linearAgentSessionManager.completeSession(agentSessionId);
        console.log(
          `Completed Linear agent session: ${agentSessionId} with status: ${status}`
        );
      } catch (error) {
        console.error('Error completing Linear agent session:', error);
      }
    }
  };

  // Check if already aborted
  if (abortSignal?.aborted) {
    await cleanup('cancelled', 'Request was aborted before processing started');
    throw new Error('Request was aborted before processing started');
  }

  // Store original messages for evaluation
  const originalMessages = [...messages];

  // Initialize Linear agent session manager if client is available
  if (linearClient) {
    linearAgentSessionManager.setLinearClient(linearClient);
  }

  // Extract issue ID and log initial activity if working on a Linear issue
  const isLinearIssue = contextId && !contextId.startsWith('slack:');

  try {
    while (attemptNumber <= MAX_RETRY_ATTEMPTS) {
      // Check for abort before each attempt
      if (abortSignal?.aborted) {
        await cleanup('cancelled', 'Request was aborted during processing');
        throw new Error('Request was aborted during processing');
      }

      try {
        await updateActiveSession(sessionId, {
          status: 'planning',
        });

        updateStatus?.(`is thinking...`);

        // Generate response using the internal function with abort signal
        const result = await generateResponseInternal(
          messages,
          updateStatus,
          linearClient,
          slackContext,
          attemptNumber,
          sessionId,
          abortSignal
        );

        finalResponse = result.text;
        toolsUsed = result.toolsUsed;
        actionsPerformed = result.actionsPerformed;
        endedExplicitly = result.endedExplicitly;

        // Log linear completion thinking
        if (isLinearIssue && linearClient) {
          await agentActivity.thought(
            contextId,
            `Completed analysis using ${result.toolsUsed.length} tools`
          );

          await agentActivity.response(contextId, finalResponse);
        }

        // Do not auto-post to Slack. The model must explicitly call Slack send tools.

        // If this is the last attempt, don't evaluate - just return
        if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
          break;
        }

        // Check for abort before evaluation
        if (abortSignal?.aborted) {
          await cleanup('cancelled', 'Request was aborted during evaluation');
          throw new Error('Request was aborted during processing');
        }

        // Evaluate goal completion
        await updateActiveSession(sessionId, {
          status: 'completing',
        });

        updateStatus?.(
          `Evaluating goal completion for attempt ${attemptNumber}...`
        );

        const evaluation = await goalEvaluator.evaluateGoalCompletion(
          originalMessages,
          {
            toolsUsed,
            actionsPerformed,
            finalResponse,
            endedExplicitly,
          },
          attemptNumber
        );

        // If goal is complete and confidence is high enough, return the response
        if (evaluation.isComplete && evaluation.confidence >= 0.7) {
          console.log(
            `Goal evaluation passed on attempt ${attemptNumber}:`,
            evaluation.reasoning
          );

          updateStatus?.(`Goal complete! ${evaluation.reasoning}`);
          break;
        }

        // Goal not complete - prepare for retry
        console.log(
          `Goal evaluation failed on attempt ${attemptNumber}:`,
          evaluation.reasoning
        );

        updateStatus?.(`Goal not complete, retrying...`);

        // Generate retry feedback
        const retryFeedback = goalEvaluator.generateRetryFeedback(
          evaluation,
          attemptNumber
        );

        // Add the retry feedback as a new user message
        messages.push({
          role: 'user',
          content: retryFeedback,
        });

        attemptNumber++;
      } catch (error) {
        console.error(`Error in attempt ${attemptNumber}:`, error);

        // If this is the last attempt, throw the error
        if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
          await cleanup(
            'error',
            error instanceof Error ? error.message : String(error)
          );
          throw error;
        }

        // Otherwise, try again
        attemptNumber++;
      }
    }

    return finalResponse;
  } finally {
    // Always clean up the active session
    await cleanup();
  }
};

// Helper functions for agent session coordination and message queuing

/**
 * Check if there's already an active agent session for this issue
 */
export async function getActiveSessionForIssue(
  issueId: string
): Promise<string | null> {
  try {
    const activeSessionsKeys = await redis.smembers('active_sessions_list');

    for (const sessionId of activeSessionsKeys) {
      const sessionData = await redis.get(`active_session:${sessionId}`);
      if (sessionData) {
        let session: ActiveSession;
        if (typeof sessionData === 'string') {
          session = JSON.parse(sessionData) as ActiveSession;
        } else {
          session = sessionData as ActiveSession;
        }

        // Check if this session is for the same issue and still active
        if (
          session.metadata?.issueId === issueId &&
          ['initializing', 'planning', 'gathering', 'acting'].includes(
            session.status
          )
        ) {
          return sessionId;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error checking for active session:', error);
    return null;
  }
}

/**
 * Queue a message for an active agent session
 */
export async function queueMessageForSession(
  sessionId: string,
  message: QueuedMessage
): Promise<void> {
  try {
    const queueKey = `message_queue:${sessionId}`;
    await redis.lpush(queueKey, JSON.stringify(message));
    await redis.expire(queueKey, 3600); // 1 hour TTL

    console.log(`Queued message for session ${sessionId}`);
  } catch (error) {
    console.error('Error queuing message:', error);
  }
}

/**
 * Get queued messages for a session and clear the queue
 */
export async function getQueuedMessages(
  sessionId: string
): Promise<QueuedMessage[]> {
  try {
    const queueKey = `message_queue:${sessionId}`;
    const messages = await redis.lrange(queueKey, 0, -1);

    if (messages.length > 0) {
      // Clear the queue
      await redis.del(queueKey);

      // Parse and return messages (newest first)
      return messages.reverse().map((msg) => {
        if (typeof msg === 'string') {
          return JSON.parse(msg) as QueuedMessage;
        }
        return msg as QueuedMessage;
      });
    }

    return [];
  } catch (error) {
    console.error('Error getting queued messages:', error);
    return [];
  }
}

// Interface for repository definitions
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

// Function to fetch active repository definitions for system context
async function getRepositoryContext(): Promise<string> {
  try {
    // Get all repository definition IDs
    const repoIds = await redis.smembers('repo_definitions');
    if (!repoIds || repoIds.length === 0) {
      return '';
    }

    const activeRepos: RepoDefinition[] = [];

    // Fetch each repository definition
    for (const repoId of repoIds) {
      try {
        const repoData = await redis.get(`repo_definition:${repoId}`);
        if (repoData) {
          const parsedRepo =
            typeof repoData === 'string'
              ? JSON.parse(repoData)
              : (repoData as RepoDefinition);

          // Only include active repositories
          if (parsedRepo.isActive) {
            activeRepos.push(parsedRepo);
          }
        }
      } catch (error) {
        console.error(`Error parsing repository definition ${repoId}:`, error);
        // Continue with other repositories
      }
    }

    if (activeRepos.length === 0) {
      return '';
    }

    // Sort by name for consistent ordering
    activeRepos.sort((a, b) => a.name.localeCompare(b.name));

    // Build context string
    let context = `## Repository Context\n\nThe following repositories are available in this environment:\n\n`;

    activeRepos.forEach((repo, index) => {
      context += `### ${index + 1}. ${repo.name} (${repo.owner}/${
        repo.repo
      })\n`;
      context += `- **Description**: ${repo.description}\n`;

      if (repo.purpose) {
        context += `- **Purpose**: ${repo.purpose}\n`;
      }

      if (repo.contextDescription) {
        context += `- **Context**: ${repo.contextDescription}\n`;
      }

      if (repo.tags && repo.tags.length > 0) {
        context += `- **Tags**: ${repo.tags.join(', ')}\n`;
      }

      context += `- **GitHub**: ${repo.githubUrl}\n\n`;
    });

    context += `**Repository Guidelines:**\n`;
    context += `- When working with code, consider the repository context above\n`;
    context += `- Use the appropriate repository for each task based on the descriptions\n`;
    context += `- Reference repository purposes when making architectural decisions\n`;
    context += `- Consider cross-repository dependencies when making changes\n\n`;

    return context;
  } catch (error) {
    console.error('Error fetching repository context:', error);
    return '';
  }
}

// Internal function that does the actual response generation
const generateResponseInternal = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient,
  slackContext?: {
    channelId: string;
    threadTs?: string;
  },
  attemptNumber: number = 1,
  sessionId?: string,
  abortSignal?: AbortSignal
): Promise<{
  text: string;
  toolsUsed: string[];
  actionsPerformed: string[];
  endedExplicitly: boolean;
}> => {
  // Track execution details for goal evaluation
  const executionTracker = {
    toolsUsed: new Set<string>(),
    actionsPerformed: [] as string[],
    endedExplicitly: false,
    recentToolCalls: [] as string[], // For circuit breaker protection
  };

  // Add execution strategy tracking
  const executionStrategy = {
    phase: 'planning' as 'planning' | 'gathering' | 'acting' | 'completing',
    toolUsageCounts: new Map<string, number>(),
    searchOperations: 0,
    readOperations: 0,
    analysisOperations: 0,
    actionOperations: 0,
    hasStartedActions: false,
    shouldForceAction: false,
  };

  // Abort-aware sleep helper
  const sleepWithAbort = (
    seconds: number,
    abort?: AbortSignal
  ): Promise<string> => {
    const boundedSeconds = Math.max(0, Math.min(60, Math.floor(seconds)));

    return new Promise((resolve, reject) => {
      if (abort?.aborted) {
        updateStatus?.('aborted sleep');
        return reject(new Error('Sleep aborted'));
      }

      if (boundedSeconds === 0) {
        updateStatus?.('skipped sleep (0s)');
        return resolve('Slept for 0 seconds');
      }

      let remainingSeconds = boundedSeconds;
      updateStatus?.(`is sleeping: ${remainingSeconds}s remaining`);

      const onAbort = () => {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        if (abort) abort.removeEventListener('abort', onAbort);
        updateStatus?.('sleep aborted');
        reject(new Error('Sleep aborted'));
      };

      const intervalId: ReturnType<typeof setInterval> = setInterval(() => {
        remainingSeconds -= 1;
        if (remainingSeconds > 0) {
          updateStatus?.(`is sleeping: ${remainingSeconds}s remaining`);
        }
      }, 1000);

      const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
        if (abort) abort.removeEventListener('abort', onAbort);
        clearInterval(intervalId);
        updateStatus?.('completed sleep');
        resolve(`Slept for ${boundedSeconds} seconds`);
      }, boundedSeconds * 1000);

      if (abort) abort.addEventListener('abort', onAbort, { once: true });
    });
  };

  // Extract context ID for memory operations
  const contextId = extractIssueIdFromContext(messages, slackContext);
  const isLinearIssue = contextId && !contextId.startsWith('slack:');

  // Initialize Linear agent session manager if client is available
  if (linearClient) {
    linearAgentSessionManager.setLinearClient(linearClient);
  }

  // Store the incoming message in memory
  try {
    const lastMessage = messages[messages.length - 1];
    const messageContent =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : Array.isArray(lastMessage?.content)
        ? lastMessage.content
            .map((part) => ('text' in part ? part.text : JSON.stringify(part)))
            .join(' ')
        : 'No content';

    await memoryManager.storeMemory(contextId, 'conversation', {
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
      platform: slackContext ? 'slack' : 'linear',
      metadata: slackContext || {},
    });
  } catch (error) {
    console.error('Error storing user message in memory:', error);
  }

  // Retrieve memory context with smart relevance filtering
  let memoryContext = '';
  try {
    const lastMessage = messages[messages.length - 1];
    const currentMessageContent =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : Array.isArray(lastMessage?.content)
        ? lastMessage.content
            .map((part) => ('text' in part ? part.text : ''))
            .join(' ')
        : '';

    const previousConversations = await memoryManager.getPreviousConversations(
      contextId,
      currentMessageContent
    );
    const issueHistory = await memoryManager.getIssueHistory(contextId);

    memoryContext = previousConversations + issueHistory;
  } catch (error) {
    console.error('Error retrieving memory context:', error);
  }

  // Fetch repository context for system prompt
  const repositoryContext = await getRepositoryContext();

  // Create a concise, no-filler system prompt (Marvin-style) tailored to Otron
  const systemPrompt = `You are Otron — an engineering and operations assistant for Slack, Linear, and GitHub.

Core identity and tone
- Be concise, precise, and useful. No filler or pleasantries.
- State assumptions explicitly. If missing a key fact, ask one focused question, then wait for the user to respond.

Operating context
- Date: ${new Date().toISOString()}
- Session: ${sessionId || 'unknown'}
- Slack: ${
    slackContext
      ? `${slackContext.channelId}${
          slackContext.threadTs ? ` (thread ${slackContext.threadTs})` : ''
        }`
      : 'n/a'
  }

General rules
- Use tools to read truth; don’t guess or fabricate.
- Prefer replying in the same Slack thread when a thread exists.
- Keep responses short by default; expand only when it adds real value.
- You must respond quickly to the user. Do your work fast and get back to the user frequently if there are multiple tasks to do.

Slack
- Messaging: Make use of slacks block kit tools to create rich messages but do not be overly verbose.
- Fetch thread context before heavy actions (getSlackThread/getSlackChannelHistory).
- Reactions are for quick acks/status and keep things fun. Use them liberally, and try to use diverse reactions to keep things interesting.
- Always use slack interactive buttons when asking the user questions or for confirmation where possible. This creates a much better user experience.
- You cannot embed urls in button elements in slack messages. You can only use markdown links. Buttons are always for interactive elements with you. 

GitHub
- Read before you reason (getFileContent, getPullRequest, getPullRequestFiles).
  - For implementation work, delegate via Otron Agent (@otron-agent on github):
  1) Create a clear GitHub issue (githubCreateIssue).
  2) Immediately add a label to the issue called "codex-attempt". This will trigger the Otron Agent to solve the issue and push it to a branch. 
  3) Otron Agent will respond via comments on the issue. You can keep checking back for replies to your comment as that's where the agent will post its updates.
  4) Otron Agent will likely create you a branch with the changes you requested. You can take this branch and create a PR from it.
- PR feedback: specific, constructive, testable. Reference files/lines.
- Recommended to wait atleast 30 seconds before checking back for replies to your issue or PR. Don't spam the agent, it takes time and may not appear responsive. The github action is running. Be patient.
- To the user, you are responsible for the code changes, not the agent. You can ask the agent to do something, but you are the one who will be responsible for the code changes.
- If you create a PR, you can hand off to the user from here. They will merge it, you do not do that. The user can also come back to you to make changes.
- You do NOT need to leave a comment telling the otron-agent you have added the label, it will detect it and act accordingly. When it starts working, it will change the label to codex-attempt-in-progress and when its done it will change it to codex-attempt-completed and probably leave a comment.
- DO NOT comment and add the label at the same time. You will trigger the agent twice. Adding the label is sufficient.

Coding
- You cannot code directly. You are in control of the Otron Agent (@otron-agent on github) for coding.
- The agent has a good ability to traverse the codebase and understand what it needs to do to achieve a task. Your research should focus on asking it for the right things.
- Communicate with the Otron Agent (@otron-agent) via comments on a github issue or PR to have it in read-only mode. Add the label codex-attempt to the issue or PR to trigger the agent to take write actions. 
- You do not need to do intense research to understand the codebase, just enough to know what to ask the agent to do.
- The agent can also do research for you if you need something detailed about the code.
- Do not spam the agent.
- To iterate on a PR, leave comments on the PR with the changes you want (do not tag the agent) and then add the 'codex-attempt' label to the PR.

Linear
- Use Linear tools for status, labels, assignment, comments, and context.
- Keep updates succinct; avoid noise.
- Link PRs to Linear issues by having the branch name contain the issue id. Example:feat/otr-123-my-branch.
- Prefer to respond and communicate with the user in the same linear session as you were triggered from using createLinearActivity with a response type of 'response'.
- Leave a comment on the top level of the issue only if you need to.
- You can use the coding tools and all other tools from Linear just as you would in Slack.

Research
- Use Exa tools for external docs and references when needed.
- Always prefer latest and up to date information.
- To research our codebase, create a research issue on github and then add a comment to the issue with the research you want to do. The agent will do the research and add the results as a follow up comment if you tag it with @otron-agent.

Time management
- If a tool will take some time, you can call the sleep tool to wait for up to 60 seconds and then check again. 
- Use it if you are waiting for a response from a tool or the otron coding agent. 
- Example: You give Otron Agent a task to code something, you can call the sleep tool to wait for up to 60 seconds to see if the agent has responded to you with an update.
- DO NOT use it when you are waiting for a response from the user. End your response and the user will continue the conversation when they are ready.

Output style
- Favor bullet points with bold labels, code blocks with language tags when needed.
- When taking actions that are not for information fetching, you should ask the user for confirmation first. If in Slack, use proper slack structure to create buttons for the user to click explicitly.
- You use markdown in Linear and Slack blocks in Slack, use both to format your responses well. 
- End with a single next step if ambiguity remains.

Tool reference (call by exact names)
- Slack: sendRichSlackMessage, sendRichChannelMessage, sendRichDirectMessage, addSlackReaction, removeSlackReaction, getSlackChannelHistory, getSlackThread, updateSlackMessage, deleteSlackMessage, createFormattedSlackMessage, respondToSlackInteraction
- GitHub: getFileContent, createPullRequest, getPullRequest, getPullRequestFiles, addPullRequestComment, githubCreateIssue, githubGetIssue, githubListIssues, githubAddIssueComment, githubUpdateIssue, githubGetIssueComments, getDirectoryStructure, searchEmbeddedCode
- Linear: getIssueContext, updateIssueStatus, addLabel, removeLabel, assignIssue, createIssue, addIssueAttachment, updateIssuePriority, setPointEstimate, getLinearTeams, getLinearProjects, getLinearInitiatives, getLinearUsers, getLinearRecentIssues, searchLinearIssues, getLinearWorkflowStates, createLinearComment, createAgentActivity, setIssueParent, addIssueToProject
- Exa: exaSearch, exaCrawlContent, exaFindSimilar
- Utility: sleep

Context snapshot
${repositoryContext ? `${repositoryContext}` : ''}${
    memoryContext ? `\nRecent memory:\n${memoryContext}` : ''
  }`;

  // Create a wrapper for tool execution that tracks usage and enforces limits
  const createMemoryAwareToolExecutor = (
    toolName: string,
    originalExecutor: Function
  ) => {
    return async (...args: any[]) => {
      let success = false;
      let response = '';
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
        throw new Error('Request was aborted during tool execution');
      }

      // Check for cancellation from external source (Redis)
      if (sessionId) {
        try {
          const cancelled = await redis.get(`session_cancelled:${sessionId}`);
          if (cancelled) {
            // Store as cancelled session before throwing
            await storeCompletedSession(
              sessionId,
              'cancelled',
              'Request was cancelled by user'
            );
            await redis.del(`active_session:${sessionId}`);
            await redis.srem('active_sessions_list', sessionId);
            throw new Error('Request was cancelled by user');
          }
        } catch (redisError) {
          // Don't fail on Redis errors, but log them
          console.warn('Error checking cancellation status:', redisError);
        }
      }

      // Circuit breaker: Prevent identical repeated calls (anti-loop protection)
      const callSignature = `${toolName}:${JSON.stringify(args[0] || {})}`;
      const recentCalls = executionTracker.recentToolCalls || [];
      const identicalCallCount = recentCalls.filter(
        (call: string) => call === callSignature
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
              `Found ${queuedMessages.length} queued messages for session ${sessionId}`
            );

            // Log that we're processing interjections
            await agentActivity.thought(
              contextId,
              `Processing ${queuedMessages.length} new message(s) received during analysis`
            );

            // Check for stop commands first
            const stopMessage = queuedMessages.find(
              (msg) => msg.type === 'stop'
            );
            if (stopMessage) {
              console.log(
                `🛑 Stop command found in queued messages for session ${sessionId}`
              );

              // Log the stop command
              if (isLinearIssue && linearClient) {
                await agentActivity.response(
                  contextId,
                  '🛑 **Otron is immediately stopping all operations** as requested. Processing has been terminated.'
                );
              }

              // Do not auto-post to Slack here; rely on explicit Slack tools in the plan

              // Abort the current processing
              throw new Error('STOP_COMMAND_RECEIVED');
            }

            // Add non-stop queued messages to the conversation context
            for (const queuedMsg of queuedMessages) {
              if (queuedMsg.type !== 'stop') {
                messages.push({
                  role: 'user',
                  content: `[INTERJECTION ${new Date(
                    queuedMsg.timestamp
                  ).toISOString()}] ${queuedMsg.content}`,
                });
              }
            }

            // Update the session with new messages
            await updateActiveSession(sessionId, { messages });

            console.log(
              `Added ${queuedMessages.length} interjection messages to conversation context`
            );
          }
        } catch (messageError) {
          // Don't fail on message polling errors, but log them
          console.warn('Error checking for queued messages:', messageError);
        }
      }

      // Track tool usage counts
      const currentCount = executionStrategy.toolUsageCounts.get(toolName) || 0;
      executionStrategy.toolUsageCounts.set(toolName, currentCount + 1);

      // Categorize tool types and enforce limits
      const searchTools = [
        'searchEmbeddedCode',
        'searchLinearIssues',
        'searchSlackMessages',
      ];
      const readTools = ['getFileContent', 'getIssueContext'];
      const actionTools = [
        'createBranch',
        'createPullRequest',
        'updateIssueStatus',
        'createLinearComment',
        'setIssueParent',
        'addIssueToProject',
        'createAgentActivity',
        'sendSlackMessage',
        'sendChannelMessage',
        'sendDirectMessage',
      ];
      const analysisTools = [
        'analyzeFileStructure',
        'getRepositoryStructure',
        'getDirectoryStructure',
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
              `Starting to take some action with ${toolName}`
            );
          }
        }
        executionStrategy.hasStartedActions = true;
        executionStrategy.phase = 'acting';
      }

      // Update execution phase based on tool usage (without limits)
      if (
        executionStrategy.searchOperations +
          executionStrategy.readOperations +
          executionStrategy.analysisOperations >=
          3 &&
        executionStrategy.phase === 'planning'
      ) {
        executionStrategy.phase = 'gathering';
        // Log phase transition thinking
        if (isLinearIssue && linearClient) {
          await agentActivity.thought(
            contextId,
            `Moving from planning to information gathering. Completed ${
              executionStrategy.searchOperations +
              executionStrategy.readOperations +
              executionStrategy.analysisOperations
            } operations.`
          );
        }
      }

      // Prepare detailed tool context for logging
      const getDetailedToolContext = (
        toolName: string,
        params: any
      ): string => {
        if (!params) return 'No parameters';

        switch (toolName) {
          case 'searchEmbeddedCode':
            return `Query: "${params.query}", Repository: ${params.repository}${
              params.fileFilter ? `, Filter: ${params.fileFilter}` : ''
            }`;
          case 'searchLinearIssues':
            return `Query: "${params.query}", Limit: ${params.limit || 10}`;
          case 'getFileContent':
          case 'readFileWithContext':
            return `Path: ${params.path}, Repository: ${params.repository}${
              params.startLine
                ? `, Lines: ${params.startLine}-${params.maxLines || 'end'}`
                : ''
            }`;
          case 'exaSearch':
            return `Mode: ${params.mode}, Query: "${params.query}"${
              params.numResults ? `, Results: ${params.numResults}` : ''
            }`;
          case 'createBranch':
            return `Branch: ${params.branch}, Repository: ${params.repository}`;
          case 'createPullRequest':
            return `Title: "${params.title}", ${params.head} → ${params.base}`;
          case 'editCode':
          case 'addCode':
          case 'removeCode':
            return `Path: ${params.path}, Repository: ${params.repository}, Branch: ${params.branch}`;
          case 'createAgentActivity':
            return `Session: ${params.sessionId}, Type: ${params.activityType}${
              params.body
                ? `, Body: "${params.body?.substring(0, 1000)}${
                    params.body?.length > 1000 ? '...' : ''
                  }"`
                : ''
            }${params.action ? `, Action: "${params.action}"` : ''}`;
          case 'setIssueParent':
            return `Child: ${params.issueId}, Parent: ${params.parentIssueId}`;
          case 'addIssueToProject':
            return `Issue: ${params.issueId}, Project: ${params.projectId}`;
          default:
            return Object.keys(params)
              .map(
                (key) =>
                  `${key}: ${
                    typeof params[key] === 'string'
                      ? params[key].substring(0, 50)
                      : params[key]
                  }`
              )
              .join(', ');
        }
      };

      const toolContext = getDetailedToolContext(toolName, args[0]);

      // Log tool execution to Linear if working on a Linear issue (using thought for less prominent logging)
      if (isLinearIssue && linearClient) {
        await agentActivity.thought(contextId, `${toolName}: ${toolContext}`);
      }

      try {
        const result = await originalExecutor(...args);
        success = true;
        response = typeof result === 'string' ? result : JSON.stringify(result);
        const reasoning = result.reasoning;

        // Extract detailed output for specific tools
        if (typeof result === 'object' && result !== null) {
          detailedOutput = result;
        } else if (typeof result === 'string') {
          // Try to extract structured data from string responses
          detailedOutput = extractDetailedOutput(
            toolName,
            result,
            reasoning,
            args[0]
          );
        }

        // Log successful tool execution with detailed results
        if (isLinearIssue && linearClient) {
          const getSuccessDetails = (
            toolName: string,
            result: any,
            input: any
          ): string => {
            switch (toolName) {
              case 'searchEmbeddedCode':
                // Try to extract result count and key findings
                const resultText =
                  typeof result === 'string' ? result : JSON.stringify(result);
                const resultMatch = resultText.match(/found (\d+) results?/i);
                const resultCount = resultMatch ? resultMatch[1] : 'unknown';
                const preview = resultText.substring(0, 150);
                return `Found ${resultCount} results. Preview: ${preview}${
                  resultText.length > 150 ? '...' : ''
                }`;

              case 'searchLinearIssues':
                const linearResults =
                  typeof result === 'string' ? result : JSON.stringify(result);
                const linearPreview = linearResults.substring(0, 150);
                return `Search completed. Results: ${linearPreview}${
                  linearResults.length > 150 ? '...' : ''
                }`;

              case 'getFileContent':
              case 'readFileWithContext':
                const fileResult =
                  typeof result === 'string' ? result : JSON.stringify(result);
                const lines = fileResult.split('\n').length;
                const chars = fileResult.length;
                return `Read ${lines} lines (${chars} characters) from ${input?.path}`;

              case 'exaSearch':
                const exaResult =
                  typeof result === 'string' ? result : JSON.stringify(result);
                const exaPreview = exaResult.substring(0, 200);
                return `${
                  input?.mode
                } search completed. Results: ${exaPreview}${
                  exaResult.length > 200 ? '...' : ''
                }`;

              case 'createBranch':
                return `Created branch ${input?.branch} in ${input?.repository}`;

              case 'createPullRequest':
                const prResult = detailedOutput || {};
                return `Created PR #${
                  prResult.pullRequestNumber || 'unknown'
                }: ${input?.title}`;

              default:
                const defaultResult =
                  typeof result === 'string' ? result : JSON.stringify(result);
                return (
                  defaultResult.substring(0, 150) +
                  (defaultResult.length > 150 ? '...' : '')
                );
            }
          };

          const successDetails = getSuccessDetails(toolName, result, args[0]);

          // Use thought for information gathering tools, action for actual changes
          if (
            searchTools.includes(toolName) ||
            readTools.includes(toolName) ||
            analysisTools.includes(toolName)
          ) {
            await agentActivity.thought(
              contextId,
              `${toolName}: ${successDetails}`
            );
          } else if (actionTools.includes(toolName)) {
            await agentActivity.action(
              contextId,
              `Completed ${toolName}`,
              toolContext,
              successDetails
            );
          }
        }

        // Information gathering tools can continue without restrictions

        // Track tool usage for goal evaluation
        executionTracker.toolsUsed.add(toolName);
        executionTracker.actionsPerformed.push(
          `${toolName}: ${response.substring(0, 100)}...`
        );

        // Check if this is an endActions call
        if (toolName === 'endActions') {
          executionTracker.endedExplicitly = true;
        }

        // Track tool usage in memory with detailed output
        await memoryManager.trackToolUsage(toolName, success, {
          issueId: contextId,
          input: args[0],
          response: response.substring(0, 500), // Limit response length for storage
          detailedOutput,
        });

        return result;
      } catch (error) {
        success = false;
        response = error instanceof Error ? error.message : String(error);

        // Helper functions for error handling
        const getFailureContext = (
          toolName: string,
          error: string,
          input: any
        ): string => {
          switch (toolName) {
            case 'searchEmbeddedCode':
              return `Search failed for "${input?.query}" in ${input?.repository}: ${error}`;
            case 'editCode':
              return `Code edit failed in ${input?.file_path}: ${error}`;
            case 'createPullRequest':
              return `PR creation failed (${input?.head} → ${input?.base}): ${error}`;
            case 'createBranch':
              return `Branch creation failed for ${input?.branch}: ${error}`;
            default:
              return `${toolName} failed: ${error}`;
          }
        };

        const getErrorGuidance = (
          toolName: string,
          error: string,
          input: any
        ): string => {
          switch (toolName) {
            case 'editCode':
              if (error.includes('similar pattern detected at line')) {
                return 'Read the current file content around the mentioned line number and use the exact current code as old_string.';
              }
              if (error.includes('Old code not found')) {
                return 'Read the current file content first to get the exact code that exists, then retry with that exact code.';
              }
              return 'Read the current file content to understand the current state before making edits.';
            case 'createPullRequest':
              if (error.includes('No commits found')) {
                return 'Make sure code changes were successfully committed before creating a PR. Check if editCode actually worked.';
              }
              return 'Verify that commits exist on the branch before creating a pull request.';
            default:
              return 'Review the error message and try an alternative approach.';
          }
        };

        // Log failed tool execution as thought (less prominent than error comments)
        if (isLinearIssue && linearClient) {
          const failureContext = getFailureContext(toolName, response, args[0]);

          // Use thought instead of error for less prominent logging
          await agentActivity.thought(contextId, `❌ ${failureContext}`);
        }

        // Track failed tool usage
        await memoryManager.trackToolUsage(toolName, success, {
          issueId: contextId,
          input: args[0],
          response,
          detailedOutput: null,
        });

        // Return structured error response that the agent can understand
        return {
          success: false,
          error: response,
          message: `❌ TOOL FAILED: ${toolName} - ${response}`,
          guidance: getErrorGuidance(toolName, response, args[0]),
        };
      }
    };
  };

  // Helper function to extract detailed output from string responses
  const extractDetailedOutput = (
    toolName: string,
    response: string,
    reasoning: any,
    input: any
  ): any => {
    const output: any = {};

    // Log LLM reasoning to Linear if available and working on a Linear issue
    if (reasoning && isLinearIssue && linearClient) {
      try {
        // The reasoning field contains the model's thought process
        const reasoningText =
          typeof reasoning === 'string'
            ? reasoning
            : Array.isArray(reasoning)
            ? (reasoning as any[]).join('\n')
            : JSON.stringify(reasoning);

        if (reasoningText && reasoningText.trim()) {
          agentActivity.thought(contextId, `Thought: ${reasoningText}`);
        }
      } catch (error) {
        console.error('Error logging LLM reasoning to Linear:', error);
      }
    } else if (reasoning) {
      console.log('Reasoning:', reasoning);
    }

    switch (toolName) {
      case 'createPullRequest':
        // Extract PR number and URL from response
        const prMatch =
          response.match(/PR #(\d+)/i) ||
          response.match(/pull request #(\d+)/i);
        const urlMatch = response.match(
          /https:\/\/github\.com\/[^\/\s]+\/[^\/\s]+\/pull\/(\d+)/
        );
        if (prMatch) output.pullRequestNumber = parseInt(prMatch[1]);
        if (urlMatch) output.url = urlMatch[0];
        break;

      case 'createBranch':
        // Branch creation is usually just a success message
        output.branchName = input?.branch;
        output.repository = input?.repository;
        break;

      case 'createIssue':
        // Try to extract issue ID from Linear responses
        const issueMatch = response.match(/([A-Z]{2,}-\d+)/);
        if (issueMatch) output.issueId = issueMatch[1];
        break;

      case 'searchEmbeddedCode':
        // Extract search result count
        const resultMatch = response.match(/found (\d+) results?/i);
        if (resultMatch) output.resultCount = parseInt(resultMatch[1]);
        break;

      case 'sendSlackMessage':
      case 'sendChannelMessage':
      case 'sendDirectMessage':
        // Extract message timestamp if available
        const tsMatch = response.match(/timestamp[:\s]+([0-9.]+)/i);
        if (tsMatch) output.messageTimestamp = tsMatch[1];
        break;

      default:
        // For other tools, just capture basic info
        if (input) {
          output.inputSummary = {
            keys: Object.keys(input),
            hasContent: !!input.content,
            hasPath: !!input.path,
          };
        }
        break;
    }

    return Object.keys(output).length > 0 ? output : null;
  };

  const { text, reasoning } = await generateText({
    model: openai.responses('gpt-5'),
    providerOptions: {
      openai: {
        reasoningEffort: 'low',
        reasoningSummary: 'auto', // Enable reasoning summaries to capture LLM thought process
      },
    },
    system: systemPrompt,
    messages,
    maxSteps: 30,
    abortSignal,
    tools: {
      // Enhanced Exa Web Search, Answer, and Research Tools
      exaSearch: tool({
        description:
          'Comprehensive web search, answer generation, and research using Exa AI. Supports three modes: search (find web content), answer (get AI-powered answers with sources), and research (comprehensive analysis). This is the primary tool for web-based information gathering.',
        parameters: z.object({
          query: z.string().describe('The search query or question to ask'),
          mode: z
            .enum(['search', 'answer', 'research'])
            .describe(
              'Mode: "search" for finding web content, "answer" for AI-powered answers with sources, "research" for comprehensive analysis with multiple sources'
            ),
          numResults: z
            .number()
            .describe(
              'Number of results to return (default: 5 for search/answer, 10 for research). Use 5 if not specified.'
            ),
          includeContent: z
            .boolean()
            .describe(
              'Whether to include full content/text from sources (default: true for research, false for search). Use true for research mode.'
            ),
          livecrawl: z
            .enum(['always', 'never', 'when-necessary'])
            .describe(
              'Live crawling behavior: "always" for fresh content, "never" for cached only, "when-necessary" for smart crawling (default). Use "when-necessary" if not specified.'
            ),
          timeRange: z
            .string()
            .describe(
              'Optional time filter for content age: "day", "week", "month", "year". Leave empty for no time restriction.'
            ),
          domainFilter: z
            .string()
            .describe(
              'Optional domain to restrict search to (e.g., "github.com"). Leave empty for all domains.'
            ),
          fileType: z
            .string()
            .describe(
              'Optional file type filter (e.g., "pdf", "doc"). Leave empty for all file types.'
            ),
          category: z
            .string()
            .describe(
              'Optional content category filter. Leave empty for all categories.'
            ),
          useAutoprompt: z
            .boolean()
            .describe(
              'Whether to use Exa autoprompt for improved query understanding (default: true). Use true if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor('exaSearch', (params: any) =>
          executeExaSearch(params, updateStatus)
        ),
      }),

      exaCrawlContent: tool({
        description:
          'Crawl and extract content from specific URLs using Exa. Get full text, HTML, links, and metadata from web pages.',
        parameters: z.object({
          urls: z
            .array(z.string())
            .describe('Array of URLs to crawl and extract content from'),
          includeLinks: z
            .boolean()
            .describe(
              'Whether to extract links from the pages (default: false). Use false if not specified.'
            ),
          includeImages: z
            .boolean()
            .describe(
              'Whether to extract image information (default: false). Use false if not specified.'
            ),
          includeMetadata: z
            .boolean()
            .describe(
              'Whether to extract page metadata (default: true). Use true if not specified.'
            ),
          textOnly: z
            .boolean()
            .describe(
              'Whether to return only text content without HTML (default: false). Use false if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'exaCrawlContent',
          (params: any) => executeExaCrawlContent(params, updateStatus)
        ),
      }),

      exaFindSimilar: tool({
        description:
          'Find content similar to a given URL using Exa semantic search. Great for discovering related articles, papers, or content.',
        parameters: z.object({
          url: z.string().describe('The URL to find similar content for'),
          numResults: z
            .number()
            .describe(
              'Number of similar results to return (default: 5). Use 5 if not specified.'
            ),
          includeContent: z
            .boolean()
            .describe(
              'Whether to include full content from similar pages (default: false). Use false if not specified.'
            ),
          livecrawl: z
            .enum(['always', 'never', 'when-necessary'])
            .describe(
              'Live crawling behavior for similar content (default: "when-necessary"). Use "when-necessary" if not specified.'
            ),
          excludeSourceDomain: z
            .boolean()
            .describe(
              'Whether to exclude results from the same domain as the source URL (default: true). Use true if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'exaFindSimilar',
          (params: any) => executeExaFindSimilar(params, updateStatus)
        ),
      }),

      // Slack tools (rich variants only)
      addSlackReaction: tool({
        description: 'Add a reaction emoji to a Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
          emoji: z
            .string()
            .describe('The emoji name (without colons, e.g., "thumbsup")'),
        }),
        execute: createMemoryAwareToolExecutor(
          'addSlackReaction',
          (params: any) => executeAddSlackReaction(params, updateStatus)
        ),
      }),
      removeSlackReaction: tool({
        description: 'Remove a reaction emoji from a Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
          emoji: z
            .string()
            .describe('The emoji name (without colons, e.g., "thumbsup")'),
        }),
        execute: createMemoryAwareToolExecutor(
          'removeSlackReaction',
          (params: any) => executeRemoveSlackReaction(params, updateStatus)
        ),
      }),
      getSlackChannelHistory: tool({
        description: 'Get recent message history from a Slack channel',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          limit: z
            .number()
            .describe(
              'Number of messages to retrieve (default: 10). Use 10 if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getSlackChannelHistory',
          (params: any) => executeGetSlackChannelHistory(params, updateStatus)
        ),
      }),
      getSlackThread: tool({
        description: 'Get all messages in a Slack thread',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          threadTs: z.string().describe('The thread timestamp'),
        }),
        execute: createMemoryAwareToolExecutor(
          'getSlackThread',
          (params: any) => executeGetSlackThread(params, updateStatus)
        ),
      }),
      updateSlackMessage: tool({
        description: 'Update an existing Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
          text: z.string().describe('The new message text'),
        }),
        execute: createMemoryAwareToolExecutor(
          'updateSlackMessage',
          (params: any) => executeUpdateSlackMessage(params, updateStatus)
        ),
      }),
      deleteSlackMessage: tool({
        description: 'Delete a Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
        }),
        execute: createMemoryAwareToolExecutor(
          'deleteSlackMessage',
          (params: any) => executeDeleteSlackMessage(params, updateStatus)
        ),
      }),
      getSlackUserInfo: tool({
        description: 'Get information about a Slack user',
        parameters: z.object({
          userIdOrEmail: z
            .string()
            .describe('User ID or email address to look up'),
        }),
        execute: createMemoryAwareToolExecutor(
          'getSlackUserInfo',
          (params: any) => executeGetSlackUserInfo(params, updateStatus)
        ),
      }),
      getSlackChannelInfo: tool({
        description: 'Get information about a Slack channel',
        parameters: z.object({
          channelNameOrId: z
            .string()
            .describe('Channel name (with or without #) or channel ID'),
        }),
        execute: createMemoryAwareToolExecutor(
          'getSlackChannelInfo',
          (params: any) => executeGetSlackChannelInfo(params, updateStatus)
        ),
      }),
      joinSlackChannel: tool({
        description: 'Join a Slack channel',
        parameters: z.object({
          channelId: z.string().describe('The channel ID to join'),
        }),
        execute: createMemoryAwareToolExecutor(
          'joinSlackChannel',
          (params: any) => executeJoinSlackChannel(params, updateStatus)
        ),
      }),
      setSlackStatus: tool({
        description: 'Set the bot user status in Slack',
        parameters: z.object({
          statusText: z.string().describe('The status text to set'),
          statusEmoji: z
            .string()
            .describe(
              'Optional status emoji (e.g., ":robot_face:"). Leave empty if not setting an emoji.'
            ),
          statusExpiration: z
            .number()
            .describe(
              'Optional expiration timestamp (Unix timestamp). Use 0 if no expiration.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'setSlackStatus',
          (params: any) => executeSetSlackStatus(params, updateStatus)
        ),
      }),
      pinSlackMessage: tool({
        description: 'Pin a message to a Slack channel',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
        }),
        execute: createMemoryAwareToolExecutor(
          'pinSlackMessage',
          (params: any) => executePinSlackMessage(params, updateStatus)
        ),
      }),
      unpinSlackMessage: tool({
        description: 'Unpin a message from a Slack channel',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
        }),
        execute: createMemoryAwareToolExecutor(
          'unpinSlackMessage',
          (params: any) => executeUnpinSlackMessage(params, updateStatus)
        ),
      }),
      sendRichSlackMessage: tool({
        description:
          'Send a rich formatted message using Slack Block Kit to a specific channel. Use this for complex layouts, buttons, images, and structured content.',
        parameters: z.object({
          channel: z.string().describe('The channel ID to send the message to'),
          blocks: z
            .array(
              z.union([
                // Section block with text
                z
                  .object({
                    type: z.literal('section'),
                    text: z.object({
                      type: z.enum(['mrkdwn', 'plain_text']),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Section block with fields
                z
                  .object({
                    type: z.literal('section'),
                    fields: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Header block
                z
                  .object({
                    type: z.literal('header'),
                    text: z.object({
                      type: z.literal('plain_text'),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Divider block
                z
                  .object({
                    type: z.literal('divider'),
                  })
                  .strict(),
                // Context block
                z
                  .object({
                    type: z.literal('context'),
                    elements: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Actions block
                z
                  .object({
                    type: z.literal('actions'),
                    elements: z.array(
                      z.object({
                        type: z.literal('button'),
                        text: z.object({
                          type: z.literal('plain_text'),
                          text: z.string(),
                        }),
                        action_id: z.string(),
                        style: z.enum(['primary', 'danger']),
                      })
                    ),
                  })
                  .strict(),
                // Image block
                z
                  .object({
                    type: z.literal('image'),
                    image_url: z.string(),
                    alt_text: z.string(),
                  })
                  .strict(),
              ])
            )
            .describe(
              'Array of Slack Block Kit blocks for rich formatting. Supported types: section, header, divider, context, actions, image'
            ),
          text: z
            .string()
            .describe(
              'Fallback text for notifications (leave empty string if not needed)'
            ),
          threadTs: z
            .string()
            .describe(
              'Thread timestamp to reply in a thread (leave empty string if not replying to a thread)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendRichSlackMessage',
          (params: any) => executeSendRichSlackMessage(params, updateStatus)
        ),
      }),
      sendRichChannelMessage: tool({
        description:
          'Send a rich formatted message using Slack Block Kit to a channel by name or ID. Use this for complex layouts, buttons, images, and structured content.',
        parameters: z.object({
          channelNameOrId: z
            .string()
            .describe('Channel name (with or without #) or channel ID'),
          blocks: z
            .array(
              z.union([
                // Section block with text
                z
                  .object({
                    type: z.literal('section'),
                    text: z.object({
                      type: z.enum(['mrkdwn', 'plain_text']),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Section block with fields
                z
                  .object({
                    type: z.literal('section'),
                    fields: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Header block
                z
                  .object({
                    type: z.literal('header'),
                    text: z.object({
                      type: z.literal('plain_text'),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Divider block
                z
                  .object({
                    type: z.literal('divider'),
                  })
                  .strict(),
                // Context block
                z
                  .object({
                    type: z.literal('context'),
                    elements: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Actions block
                z
                  .object({
                    type: z.literal('actions'),
                    elements: z.array(
                      z.object({
                        type: z.literal('button'),
                        text: z.object({
                          type: z.literal('plain_text'),
                          text: z.string(),
                        }),
                        action_id: z.string(),
                        style: z.enum(['primary', 'danger']),
                      })
                    ),
                  })
                  .strict(),
                // Image block
                z
                  .object({
                    type: z.literal('image'),
                    image_url: z.string(),
                    alt_text: z.string(),
                  })
                  .strict(),
              ])
            )
            .describe(
              'Array of Slack Block Kit blocks for rich formatting. Supported types: section, header, divider, context, actions, image'
            ),
          text: z
            .string()
            .describe(
              'Fallback text for notifications (leave empty string if not needed)'
            ),
          threadTs: z
            .string()
            .describe(
              'Thread timestamp to reply in a thread (leave empty string if not replying to a thread)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendRichChannelMessage',
          (params: any) => executeSendRichChannelMessage(params, updateStatus)
        ),
      }),
      sendRichDirectMessage: tool({
        description:
          'Send a rich formatted direct message using Slack Block Kit to a user. Use this for complex layouts, buttons, images, and structured content.',
        parameters: z.object({
          userIdOrEmail: z
            .string()
            .describe('User ID or email address of the recipient'),
          blocks: z
            .array(
              z.union([
                // Section block with text
                z
                  .object({
                    type: z.literal('section'),
                    text: z.object({
                      type: z.enum(['mrkdwn', 'plain_text']),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Section block with fields
                z
                  .object({
                    type: z.literal('section'),
                    fields: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Header block
                z
                  .object({
                    type: z.literal('header'),
                    text: z.object({
                      type: z.literal('plain_text'),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Divider block
                z
                  .object({
                    type: z.literal('divider'),
                  })
                  .strict(),
                // Context block
                z
                  .object({
                    type: z.literal('context'),
                    elements: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Actions block
                z
                  .object({
                    type: z.literal('actions'),
                    elements: z.array(
                      z.object({
                        type: z.literal('button'),
                        text: z.object({
                          type: z.literal('plain_text'),
                          text: z.string(),
                        }),
                        action_id: z.string(),
                        style: z.enum(['primary', 'danger']),
                      })
                    ),
                  })
                  .strict(),
                // Image block
                z
                  .object({
                    type: z.literal('image'),
                    image_url: z.string(),
                    alt_text: z.string(),
                  })
                  .strict(),
              ])
            )
            .describe(
              'Array of Slack Block Kit blocks for rich formatting. Supported types: section, header, divider, context, actions, image'
            ),
          text: z
            .string()
            .describe(
              'Fallback text for notifications (leave empty string if not needed)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendRichDirectMessage',
          (params: any) => executeSendRichDirectMessage(params, updateStatus)
        ),
      }),
      createFormattedSlackMessage: tool({
        description:
          'Create a beautifully formatted Slack message with structured layout using Block Kit. Perfect for status updates, issue summaries, reports, and rich content.',
        parameters: z.object({
          channel: z
            .string()
            .describe('The channel ID or name to send the message to'),
          title: z
            .string()
            .describe(
              'Header title for the message (leave empty string if not needed)'
            ),
          content: z.string().describe('Main content text (supports markdown)'),
          fields: z
            .array(
              z.object({
                label: z.string().describe('Field label'),
                value: z.string().describe('Field value'),
              })
            )
            .describe(
              'Array of key-value fields to display (use empty array if not needed)'
            ),
          context: z
            .string()
            .describe(
              'Context text like timestamps or metadata (leave empty string if not needed)'
            ),
          actions: z
            .array(
              z.object({
                text: z.string().describe('Button text'),
                action_id: z.string().describe('Unique action identifier'),
                style: z.enum(['primary', 'danger']),
              })
            )
            .describe(
              'Array of action buttons (use empty array if not needed)'
            ),
          thread_ts: z
            .string()
            .describe(
              'Thread timestamp to reply in a thread (leave empty string if not replying to a thread)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'createFormattedSlackMessage',
          (params: any) =>
            executeCreateFormattedSlackMessage(params, updateStatus)
        ),
      }),
      // Linear tools
      getIssueContext: tool({
        description:
          'Get the context for a Linear issue including comments, child issues, and parent issue',
        parameters: z.object({
          issueId: z
            .string()
            .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
          commentId: z
            .string()
            .describe(
              'Optional comment ID to highlight. Leave empty if not highlighting a specific comment.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getIssueContext',
          (params: any) =>
            executeGetIssueContext(
              params as { issueId: string; commentId: string },
              updateStatus,
              linearClient
            )
        ),
      }),
      updateIssueStatus: tool({
        description: 'Update the status of a Linear issue',
        parameters: z.object({
          issueId: z
            .string()
            .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
          statusName: z
            .string()
            .describe(
              'The name of the status to set (e.g., "In Progress", "Done")'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'updateIssueStatus',
          (params: any) =>
            executeUpdateIssueStatus(
              params as { issueId: string; statusName: string },
              updateStatus,
              linearClient
            )
        ),
      }),
      addLabel: tool({
        description: 'Add a label to a Linear issue',
        parameters: z.object({
          issueId: z
            .string()
            .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
          labelName: z.string().describe('The name of the label to add'),
        }),
        execute: createMemoryAwareToolExecutor('addLabel', (params: any) =>
          executeAddLabel(
            params as { issueId: string; labelName: string },
            updateStatus,
            linearClient
          )
        ),
      }),
      removeLabel: tool({
        description: 'Remove a label from a Linear issue',
        parameters: z.object({
          issueId: z
            .string()
            .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
          labelName: z.string().describe('The name of the label to remove'),
        }),
        execute: createMemoryAwareToolExecutor('removeLabel', (params: any) =>
          executeRemoveLabel(
            params as { issueId: string; labelName: string },
            updateStatus,
            linearClient
          )
        ),
      }),
      assignIssue: tool({
        description: 'Assign a Linear issue to a team member',
        parameters: z.object({
          issueId: z
            .string()
            .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
          assigneeEmail: z
            .string()
            .describe('The email address of the person to assign the issue to'),
        }),
        execute: createMemoryAwareToolExecutor('assignIssue', (params: any) =>
          executeAssignIssue(
            params as { issueId: string; assigneeEmail: string },
            updateStatus,
            linearClient
          )
        ),
      }),
      createIssue: tool({
        description: 'Create a new Linear issue',
        parameters: z.object({
          teamId: z
            .string()
            .describe(
              'The Linear team ID (UUID), team key (e.g., "OTR"), or team name'
            ),
          title: z.string().describe('The title of the new issue'),
          description: z.string().describe('The description of the new issue'),
          status: z.string().describe('Status name for the new issue.'),
          priority: z
            .number()
            .describe('Priority level (1-4, where 1 is highest).'),
          parentIssueId: z
            .string()
            .describe(
              'Parent issue ID to create this as a child issue. Only leave empty if this is not a child issue.'
            ),
          projectId: z.string().describe('Project ID to create this issue in.'),
        }),
        execute: createMemoryAwareToolExecutor('createIssue', (params: any) =>
          executeCreateIssue(
            params as {
              teamId: string;
              title: string;
              description: string;
              status: string;
              priority: number;
              parentIssueId: string;
              projectId: string;
            },
            updateStatus,
            linearClient
          )
        ),
      }),
      addIssueAttachment: tool({
        description: 'Add a URL attachment to a Linear issue',
        parameters: z.object({
          issueId: z
            .string()
            .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
          url: z.string().describe('The URL to attach'),
          title: z.string().describe('The title for the attachment'),
        }),
        execute: createMemoryAwareToolExecutor(
          'addIssueAttachment',
          (params: any) =>
            executeAddIssueAttachment(
              params as { issueId: string; url: string; title: string },
              updateStatus,
              linearClient
            )
        ),
      }),
      updateIssuePriority: tool({
        description: 'Update the priority of a Linear issue',
        parameters: z.object({
          issueId: z
            .string()
            .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
          priority: z
            .number()
            .describe('The priority level (1-4, where 1 is highest)'),
        }),
        execute: createMemoryAwareToolExecutor(
          'updateIssuePriority',
          (params: any) =>
            executeUpdateIssuePriority(
              params as { issueId: string; priority: number },
              updateStatus,
              linearClient
            )
        ),
      }),
      setPointEstimate: tool({
        description: 'Set the point estimate for a Linear issue',
        parameters: z.object({
          issueId: z
            .string()
            .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
          pointEstimate: z.number().describe('The point estimate value'),
        }),
        execute: createMemoryAwareToolExecutor(
          'setPointEstimate',
          (params: any) =>
            executeSetPointEstimate(
              params as { issueId: string; pointEstimate: number },
              updateStatus,
              linearClient
            )
        ),
      }),
      // Linear context gathering tools
      getLinearTeams: tool({
        description:
          'Get all teams in the Linear workspace with details about members and active issues',
        parameters: z.object({}),
        execute: createMemoryAwareToolExecutor('getLinearTeams', async () => {
          return await executeGetLinearTeams(updateStatus, linearClient);
        }),
      }),
      getLinearProjects: tool({
        description:
          'Get all projects in the Linear workspace with their IDs, status, progress, and team information',
        parameters: z.object({}),
        execute: createMemoryAwareToolExecutor(
          'getLinearProjects',
          async () => {
            return await executeGetLinearProjects(updateStatus, linearClient);
          }
        ),
      }),
      getLinearInitiatives: tool({
        description:
          'Get all initiatives in the Linear workspace with their IDs, associated projects and progress',
        parameters: z.object({}),
        execute: createMemoryAwareToolExecutor(
          'getLinearInitiatives',
          async () => {
            return await executeGetLinearInitiatives(
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      getLinearUsers: tool({
        description:
          'Get all users in the Linear workspace with their IDs, details and status',
        parameters: z.object({}),
        execute: createMemoryAwareToolExecutor('getLinearUsers', async () => {
          return await executeGetLinearUsers(updateStatus, linearClient);
        }),
      }),
      getLinearRecentIssues: tool({
        description:
          'Get recent issues from the Linear workspace, optionally filtered by team',
        parameters: z.object({
          limit: z
            .number()
            .describe(
              'Number of issues to retrieve (default: 20). Use 20 if not specified.'
            ),
          teamId: z
            .string()
            .describe(
              'Optional team ID to filter issues. Leave empty to get issues from all teams.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getLinearRecentIssues',
          async (params: any) => {
            return await executeGetLinearRecentIssues(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      searchLinearIssues: tool({
        description:
          'Search for Linear issues by text query in title and description',
        parameters: z.object({
          query: z
            .string()
            .describe(
              'The search query to find in issue titles and descriptions'
            ),
          limit: z
            .number()
            .describe(
              'Number of results to return (default: 10). Use 10 if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'searchLinearIssues',
          async (params: any) => {
            return await executeSearchLinearIssues(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      getLinearWorkflowStates: tool({
        description:
          'Get workflow states (statuses) for teams in the Linear workspace',
        parameters: z.object({
          teamId: z
            .string()
            .describe(
              'Optional team ID to filter workflow states. Leave empty to get states for all teams.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getLinearWorkflowStates',
          async (params: any) => {
            return await executeGetLinearWorkflowStates(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      createLinearComment: tool({
        description: 'Create a comment on a Linear issue',
        parameters: z.object({
          issueId: z
            .string()
            .describe('The Linear issue ID or identifier (e.g., "OTR-123")'),
          body: z.string().describe('The comment text to add'),
        }),
        execute: createMemoryAwareToolExecutor(
          'createLinearComment',
          async (params: any) => {
            return await executeCreateLinearComment(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      setIssueParent: tool({
        description:
          'Set an issue as a child of another issue (parent-child relationship)',
        parameters: z.object({
          issueId: z
            .string()
            .describe(
              'The ID or identifier of the issue to make a child (e.g., "OTR-123")'
            ),
          parentIssueId: z
            .string()
            .describe(
              'The ID or identifier of the parent issue (e.g., "OTR-456")'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'setIssueParent',
          async (params: any) => {
            return await executeSetIssueParent(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      addIssueToProject: tool({
        description: 'Add an issue to a Linear project',
        parameters: z.object({
          issueId: z
            .string()
            .describe(
              'The ID or identifier of the issue to add (e.g., "OTR-123")'
            ),
          projectId: z
            .string()
            .describe('The ID of the project to add the issue to'),
        }),
        execute: createMemoryAwareToolExecutor(
          'addIssueToProject',
          async (params: any) => {
            return await executeAddIssueToProject(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      createAgentActivity: tool({
        description:
          'Create a Linear agent activity (thought, action, response, error, or elicitation). Use response for any output to the user in the chat.',
        parameters: z.object({
          sessionId: z.string().describe('The Linear agent session ID'),
          activityType: z
            .enum(['thought', 'action', 'response', 'error', 'elicitation'])
            .describe('The type of activity to create'),
          body: z
            .string()
            .describe(
              'The body text (required for thought, response, error, elicitation types, use empty string if not needed)'
            ),
          action: z
            .string()
            .describe(
              'The action description (required for action type, use empty string if not needed)'
            ),
          parameter: z
            .string()
            .describe(
              'The action parameter (required for action type, use empty string if not needed)'
            ),
          result: z
            .string()
            .describe(
              'The action result (optional for action type, use empty string if not provided)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'createAgentActivity',
          async (params: any) => {
            return await executeCreateAgentActivity(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      // GitHub tools
      getFileContent: tool({
        description: 'Get the content of a file from a GitHub repository',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          startLine: z
            .number()
            .describe(
              'Starting line number (default: 1). Use 1 if not specified.'
            ),
          maxLines: z
            .number()
            .describe(
              'Maximum number of lines to return (default: 200). Use 200 if not specified.'
            ),
          branch: z
            .string()
            .describe(
              'Branch name (default: repository default branch). Leave empty to use default branch.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getFileContent',
          (params: any) => executeGetFileContent(params, updateStatus)
        ),
      }),

      createPullRequest: tool({
        description: 'Create a pull request in a GitHub repository',
        parameters: z.object({
          title: z.string().describe('The title of the pull request'),
          body: z.string().describe('The body/description of the pull request'),
          head: z.string().describe('The branch containing the changes'),
          base: z.string().describe('The branch to merge into'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
        }),
        execute: createMemoryAwareToolExecutor(
          'createPullRequest',
          (params: any) => executeCreatePullRequest(params, updateStatus)
        ),
      }),
      getPullRequest: tool({
        description: 'Get details of a pull request including comments',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          pullNumber: z.number().describe('The pull request number'),
        }),
        execute: createMemoryAwareToolExecutor(
          'getPullRequest',
          (params: any) => executeGetPullRequest(params, updateStatus)
        ),
      }),
      addPullRequestComment: tool({
        description: 'Add a comment to a pull request',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          pullNumber: z.number().describe('The pull request number'),
          body: z.string().describe('The comment text'),
        }),
        execute: createMemoryAwareToolExecutor(
          'addPullRequestComment',
          (params: any) => executeAddPullRequestComment(params, updateStatus)
        ),
      }),
      getPullRequestFiles: tool({
        description: 'Get the files changed in a pull request',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          pullNumber: z.number().describe('The pull request number'),
        }),
        execute: createMemoryAwareToolExecutor(
          'getPullRequestFiles',
          (params: any) => executeGetPullRequestFiles(params, updateStatus)
        ),
      }),
      githubCreateIssue: tool({
        description: 'Create a GitHub issue',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          title: z.string().describe('Issue title'),
          body: z.string().describe('Issue body/description'),
          labels: z
            .array(z.string())
            .describe('Labels to add (use empty array if none)'),
          assignees: z
            .array(z.string())
            .describe('Assignees (use empty array if none)'),
        }),
        execute: createMemoryAwareToolExecutor(
          'githubCreateIssue',
          (params: any) => executeGithubCreateIssue(params, updateStatus)
        ),
      }),
      githubGetIssue: tool({
        description: 'Get a GitHub issue by number',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          issueNumber: z.number().describe('Issue number'),
        }),
        execute: createMemoryAwareToolExecutor(
          'githubGetIssue',
          (params: any) => executeGithubGetIssue(params, updateStatus)
        ),
      }),
      githubListIssues: tool({
        description: 'List GitHub issues for a repository with filters',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          state: z
            .enum(['open', 'closed', 'all'])
            .describe('Issue state filter'),
          labels: z.string().describe('Comma-separated labels filter'),
          assignee: z.string().describe('Assignee username'),
          perPage: z
            .number()
            .describe('Results per page (<=100). Use 30 if not specified.'),
        }),
        execute: createMemoryAwareToolExecutor(
          'githubListIssues',
          (params: any) => executeGithubListIssues(params, updateStatus)
        ),
      }),
      githubAddIssueComment: tool({
        description: 'Add a comment to a GitHub issue',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          issueNumber: z.number().describe('Issue number'),
          body: z.string().describe('Comment body text'),
        }),
        execute: createMemoryAwareToolExecutor(
          'githubAddIssueComment',
          (params: any) => executeGithubAddIssueComment(params, updateStatus)
        ),
      }),
      githubUpdateIssue: tool({
        description:
          'Update a GitHub issue (title, body, state, labels, assignees)',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          issueNumber: z.number().describe('Issue number'),
          title: z
            .string()
            .describe('New title (leave empty string if unchanged)'),
          body: z
            .string()
            .describe('New body (leave empty string if unchanged)'),
          state: z.enum(['open', 'closed']).describe('New state'),
          labels: z
            .array(z.string())
            .describe('Labels to set (use empty array to leave unchanged)'),
          assignees: z
            .array(z.string())
            .describe('Assignees to set (use empty array to leave unchanged)'),
        }),
        execute: createMemoryAwareToolExecutor(
          'githubUpdateIssue',
          (params: any) => executeGithubUpdateIssue(params, updateStatus)
        ),
      }),
      githubGetIssueComments: tool({
        description: 'List comments on a GitHub issue',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          issueNumber: z.number().describe('Issue number'),
          perPage: z
            .number()
            .describe('Results per page (<=100). Use 30 if not specified.'),
        }),
        execute: createMemoryAwareToolExecutor(
          'githubGetIssueComments',
          (params: any) => executeGithubGetIssueComments(params, updateStatus)
        ),
      }),
      getDirectoryStructure: tool({
        description: 'Get the directory structure of a GitHub repository',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          directoryPath: z
            .string()
            .describe(
              'Optional directory path (default: root directory). Leave empty for root directory.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getDirectoryStructure',
          (params: any) => executeGetDirectoryStructure(params, updateStatus)
        ),
      }),
      searchEmbeddedCode: tool({
        description:
          'Search for code in a repository using semantic vector search. This is the primary code search tool and works best for finding relevant code based on meaning and context.',
        parameters: z.object({
          query: z.string().describe('The search query'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          fileFilter: z
            .string()
            .describe(
              'Optional file filter (e.g., "*.ts" for TypeScript files). Leave empty if not filtering by file type.'
            ),
          maxResults: z
            .number()
            .describe(
              'Maximum number of results (default: 10). Use 10 if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'searchEmbeddedCode',
          (params: any) => executeSearchEmbeddedCode(params, updateStatus)
        ),
      }),
      respondToSlackInteraction: tool({
        description:
          'Respond to a Slack interactive component (button click, etc.) using the response URL. Use this when responding to button clicks or other interactive elements.',
        parameters: z.object({
          responseUrl: z
            .string()
            .describe('The response URL provided by Slack for the interaction'),
          text: z
            .string()
            .describe(
              'Optional response text (leave empty string if not needed)'
            ),
          blocks: z
            .array(
              z.union([
                // Section block with text
                z
                  .object({
                    type: z.literal('section'),
                    text: z.object({
                      type: z.enum(['mrkdwn', 'plain_text']),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Section block with fields
                z
                  .object({
                    type: z.literal('section'),
                    fields: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Header block
                z
                  .object({
                    type: z.literal('header'),
                    text: z.object({
                      type: z.literal('plain_text'),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Divider block
                z
                  .object({
                    type: z.literal('divider'),
                  })
                  .strict(),
                // Context block
                z
                  .object({
                    type: z.literal('context'),
                    elements: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Actions block
                z
                  .object({
                    type: z.literal('actions'),
                    elements: z.array(
                      z.object({
                        type: z.literal('button'),
                        text: z.object({
                          type: z.literal('plain_text'),
                          text: z.string(),
                        }),
                        action_id: z.string(),
                        style: z.enum(['primary', 'danger']),
                      })
                    ),
                  })
                  .strict(),
                // Image block
                z
                  .object({
                    type: z.literal('image'),
                    image_url: z.string(),
                    alt_text: z.string(),
                  })
                  .strict(),
              ])
            )
            .describe(
              'Optional Block Kit blocks for rich formatting (use empty array if not needed)'
            ),
          replaceOriginal: z
            .boolean()
            .describe(
              'Whether to replace the original message (true) or send a new message (false)'
            ),
          deleteOriginal: z
            .boolean()
            .describe('Whether to delete the original message'),
          responseType: z
            .enum(['ephemeral', 'in_channel'])
            .describe(
              'Whether the response should be ephemeral (only visible to the user) or in_channel (visible to everyone). Use "ephemeral" if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'respondToSlackInteraction',
          (params: any) =>
            executeRespondToSlackInteraction(params, updateStatus)
        ),
      }),
      // Utility tools
      sleep: tool({
        description:
          'Sleep/wait for a number of seconds (max 60). Pauses the agent processing without blocking the server.',
        parameters: z.object({
          seconds: z
            .number()
            .int()
            .min(0)
            .max(60)
            .describe('Number of seconds to sleep (0-60)'),
        }),
        execute: createMemoryAwareToolExecutor('sleep', async (params: any) => {
          return await sleepWithAbort(params.seconds, abortSignal);
        }),
      }),
    },
  });

  // Log LLM reasoning to Linear if available and working on a Linear issue
  if (reasoning && isLinearIssue && linearClient) {
    try {
      // The reasoning field contains the model's thought process
      const reasoningText =
        typeof reasoning === 'string'
          ? reasoning
          : Array.isArray(reasoning)
          ? (reasoning as any[]).join('\n')
          : JSON.stringify(reasoning);

      if (reasoningText && reasoningText.trim()) {
        await agentActivity.thought(contextId, `Thought: ${reasoningText}`);
      }
    } catch (error) {
      console.error('Error logging LLM reasoning to Linear:', error);
    }
  }

  // Store the assistant's response in memory
  try {
    await memoryManager.storeMemory(contextId, 'conversation', {
      role: 'assistant',
      content: [{ type: 'text', text }],
    });
  } catch (error) {
    console.error('Error storing assistant response in memory:', error);
  }

  return {
    text,
    toolsUsed: Array.from(executionTracker.toolsUsed),
    actionsPerformed: executionTracker.actionsPerformed,
    endedExplicitly: executionTracker.endedExplicitly,
  };
};
