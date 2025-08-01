import { CoreMessage, generateText, tool } from 'ai';
import { z } from 'zod';
import {
  // Exa search tools
  executeExaSearch,
  executeExaCrawlContent,
  executeExaFindSimilar,
} from './exa/exa-utils.js';
import {
  // New line-based file editing tools
  executeReplaceLines,
  executeInsertLines,
  executeDeleteLines,
} from './file-editing-tools.js';
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
  executeSendSlackMessage,
  executeSendDirectMessage,
  executeSendChannelMessage,
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
  executeCreateBranch,
  executeCreatePullRequest,
  executeGetPullRequest,
  executeAddPullRequestComment,
  executeGetPullRequestFiles,
  executeGetDirectoryStructure,
  executeGetRepositoryStructure,
  executeDeleteFile,
  executeCreateFile,
  // GitHub branch management tools
  executeResetBranchToHead,
  // GitHub file reading tools
  executeGetRawFileContent,
  executeReadRelatedFiles,
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
  const MAX_RETRY_ATTEMPTS = 2;
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

        // Log completion thinking
        if (isLinearIssue && linearClient) {
          await agentActivity.thought(
            contextId,
            `Completed analysis using ${result.toolsUsed.length} tools`
          );

          await agentActivity.response(contextId, finalResponse);
        }

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

  // Create streamlined system prompt focused on core capabilities and flexibility
  const systemPrompt = `You are Otron, an AI agent that operates across Slack, Linear, and GitHub. You execute tasks immediately and communicate results effectively.

## Core Strategy: Think → Act → Adapt
**Be smart, not repetitive**. When tools fail, pivot to alternatives rather than retrying the same approach.

## Request Classification & Immediate Actions

### Administrative Tasks (Execute Immediately)
- **Linear estimates**: "Set estimate to 5" → use setPointEstimate(issueId, 5)
- **Status updates**: "Mark as in progress" → use updateIssueStatus(issueId, "In Progress")  
- **Label management**: "Add bug label" → use addLabel(issueId, "bug")
- **Assignments**: "Assign to me" → use assignIssue(issueId, userEmail)
- **Comments**: "Add comment X" → use createLinearComment(issueId, "X")

### Information Requests (Respond Directly)
- **Status queries**: Check current state and report back
- **Code questions**: Read relevant files and provide answers
- **Project updates**: Summarize current state from Linear/GitHub
- **Help requests**: Provide specific guidance based on context

### Development Tasks (Strategic Workflow)
- **Bug fixes**: Analyze → Create branch → Read files → Fix → Commit → PR → Update Linear
- **Feature implementation**: Plan → Branch → Code → Test → PR → Document
- **Code reviews**: Read PR → Analyze changes → Comment with feedback

## File Operations (Critical Patterns)

### Reading Files Strategically
**Start with entire file for small files (<200 lines):**
\`\`\`
{file_path: "file.ts", repository: "owner/repo", should_read_entire_file: true}
\`\`\`

**For large files, read specific sections you need:**
\`\`\`
{file_path: "file.ts", repository: "owner/repo", should_read_entire_file: false, start_line_one_indexed: 1, end_line_one_indexed_inclusive: 200}
\`\`\`

**CRITICAL: If file reading fails, do NOT retry the same parameters:**
- ❌ **Never**: Call getRawFileContent with identical parameters multiple times
- ✅ **Instead**: Try searchEmbeddedCode, getDirectoryStructure, or report what you tried

**Note**: You are limited to reading 200 lines at a time. Just specify the next start and end line if you want to read more.

### Editing Files  
**Always read the target section first:**
1. Read file to understand current content
2. Identify exact text to replace
3. Make precise changes:
\`\`\`
{file_path: "file.ts", old_string: "exact current code", new_string: "replacement code", replace_all: false, commit_message: "Descriptive message"}
\`\`\`

**For multiple similar changes, use replace_all:**
\`\`\`
{file_path: "file.ts", old_string: "oldVariableName", new_string: "newVariableName", replace_all: true, commit_message: "Rename variable"}
\`\`\`

**Note**: Once you know what to do, make the change. Don't read files repeatedly, nothing will change.

## Strategic Error Recovery (CRITICAL)

### When File Operations Fail (ANTI-LOOP PROTECTION)
❌ **NEVER DO**: Retry the exact same getRawFileContent call multiple times
❌ **NEVER DO**: Make the same file request with identical parameters
❌ **NEVER DO**: Repeat failed operations hoping for different results

✅ **IMMEDIATELY DO**: Switch to alternative approaches:
- **getRawFileContent fails** → Use searchEmbeddedCode to find relevant code
- **File not found** → Use getDirectoryStructure to explore repository
- **Permission/network errors** → Report the issue and suggest manual verification
- **Any repeated failure** → Stop and explain what you tried, ask for guidance

**RULE**: If a tool fails twice with the same parameters, STOP using that tool and explain the issue.

### When Search Tools Fail
❌ **Don't do**: Keep searching with the same terms
✅ **Do**: Expand your approach:
- Try broader search terms
- Check repository structure  
- Use alternative repositories if applicable
- Report what you tried and suggest next steps

### General Failure Strategy
- **Don't repeat the same failing approach**
- **Try alternative tools/parameters**  
- **Report what you tried and why it failed**
- **Ask for clarification when needed**

## Platform-Specific Communication

### Slack Responses
**Simple updates**: Use sendSlackMessage for quick status updates
**Rich content**: Use sendRichSlackMessage for:
- Status reports with structured data
- Code snippets with formatting
- Interactive buttons/actions

**Reactions**: Use addSlackReaction for:
- Acknowledgment (✅, 👍)
- Status indication (⏳, ❌, 🎉)
- Quick responses without text

### Linear Communication
**Always update Linear after completing tasks:**
- Comment with results: "Completed X, changed Y, next steps Z"
- Update status appropriately
- Link to relevant PRs/commits

### GitHub Integration
**PR Creation**: Always include:
- Descriptive title
- Detailed body with changes
- Link to Linear issue
- Clear commit messages
- After opening a PR, review the PR and make sure it is correct.

## Development Workflow Patterns

### Bug Fix Workflow
1. **Understand**: Read issue description and related files
2. **Locate**: Search codebase for relevant components (use searchEmbeddedCode)
3. **Branch**: Create feature branch with descriptive name
4. **Fix**: Make minimal, targeted changes
7. **PR**: Create with proper description
8. **Review**: Review the PR and make sure it is correct.
9. **Update**: Comment in Linear with resolution

### Feature Implementation
1. **Plan**: Analyze requirements and identify files to modify
2. **Branch**: Create with clear naming (feature/issue-description)
3. **Implement**: Break into logical changes (each use of a file edit tool is a commit)
5. **Document**: Update relevant documentation
6. **PR**: Comprehensive description with testing notes
7. **Review**: Review the PR and make sure it is correct.
8. **Follow-up**: Update Linear and notify stakeholders

### Example Workflow
1. **User request**: "Add a button to open the link in a new tab"
2. **Understand**: Find the required files with code search
3. **Locate**: Get the files required and target the specific lines
4. **Branch**: Create a new branch for the changes
5. **Implement**: Make the changes using the code editing tools on your branch.
7. **Document**: Update relevant documentation
8. **PR**: Comprehensive description with testing notes
9. **Review**: Review the PR and make sure it is correct.
11. **Follow-up**: Update Linear and notify stakeholders

## Context Awareness & Memory

### Repository Context
- **Default repo**: Ask user if repository unclear from context
- **Branch awareness**: Use appropriate branch for changes
- **File structure**: Understand project layout before making changes

### Conversation Memory
- **Reference previous interactions** when relevant
- **Build on earlier context** without re-explaining
- **Track task progress** across multiple interactions

### Multi-Platform Context
- **Slack thread awareness**: Maintain context in threaded conversations
- **Linear issue tracking**: Connect GitHub work to Linear issues
- **Cross-platform updates**: Notify all relevant channels of important changes

## API Failures & Communication Issues

### API Failures
- **Rate limits**: Wait and retry with exponential backoff
- **Authentication issues**: Report to user, suggest re-authentication
- **Service unavailable**: Try alternative tools or defer to later

### Communication Failures
- **Slack delivery issues**: Try alternative channels or direct messages
- **Linear API errors**: Use GitHub comments as fallback
- **Partial failures**: Report what succeeded and what needs retry

## Current Context
- **Session**: ${sessionId || 'unknown'}
- **Date**: ${new Date().toISOString().split('T')[0]}

${repositoryContext ? `${repositoryContext}` : ''}${
    memoryContext ? `## Previous Context\n${memoryContext}\n` : ''
  }${
    slackContext
      ? `## Current Slack Context
- **Channel**: ${slackContext.channelId}${
          slackContext.threadTs
            ? `\n- **Thread**: ${slackContext.threadTs}`
            : ''
        }
`
      : ''
  }## Remember
**Execute decisively, adapt intelligently**. Users expect immediate action on clear requests and smart problem-solving when tools fail.`;

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
              await agentActivity.response(
                contextId,
                '🛑 **Otron is immediately stopping all operations** as requested. Processing has been terminated.'
              );

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
      const readTools = [
        'getFileContent',
        'getRawFileContent',
        'readRelatedFiles',
        'getIssueContext',
      ];
      const actionTools = [
        'createFile',
        'editCode',
        'addCode',
        'removeCode',
        'editUrl',
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
    model: openai.responses('o3'),
    providerOptions: {
      openai: {
        reasoningEffort: 'high',
        reasoningSummary: 'auto', // Enable reasoning summaries to capture LLM thought process
      },
    },
    system: systemPrompt,
    temperature: 0.8,
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

      // Slack tools
      sendSlackMessage: tool({
        description: 'Send a message to a Slack channel or thread',
        parameters: z.object({
          channel: z.string().describe('The channel ID to send the message to'),
          text: z.string().describe('The message text to send'),
          threadTs: z
            .string()
            .describe(
              'Optional thread timestamp to reply in a thread. Leave empty if not replying to a thread.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendSlackMessage',
          (params: any) => executeSendSlackMessage(params, updateStatus)
        ),
      }),
      sendDirectMessage: tool({
        description: 'Send a direct message to a Slack user',
        parameters: z.object({
          userIdOrEmail: z
            .string()
            .describe('User ID or email address of the recipient'),
          text: z.string().describe('The message text to send'),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendDirectMessage',
          (params: any) => executeSendDirectMessage(params, updateStatus)
        ),
      }),
      sendChannelMessage: tool({
        description: 'Send a message to a Slack channel by name or ID',
        parameters: z.object({
          channelNameOrId: z
            .string()
            .describe('Channel name (with or without #) or channel ID'),
          text: z.string().describe('The message text to send'),
          threadTs: z
            .string()
            .describe(
              'Optional thread timestamp to reply in a thread. Leave empty if not replying to a thread.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendChannelMessage',
          (params: any) => executeSendChannelMessage(params, updateStatus)
        ),
      }),
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
      createBranch: tool({
        description: 'Create a new branch in a GitHub repository',
        parameters: z.object({
          branch: z.string().describe('The name of the new branch'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          baseBranch: z
            .string()
            .describe(
              'Base branch to create from (default: repository default branch). Leave empty to use default branch.'
            ),
        }),
        execute: createMemoryAwareToolExecutor('createBranch', (params: any) =>
          executeCreateBranch(params, updateStatus)
        ),
      }),
      createFile: tool({
        description:
          'Create a new file in a GitHub repository (for new files only)',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          content: z.string().describe('The file content'),
          message: z.string().describe('Commit message'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to commit to'),
        }),
        execute: createMemoryAwareToolExecutor('createFile', (params: any) =>
          executeCreateFile(params, updateStatus)
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
      getRepositoryStructure: tool({
        description:
          'Get the enhanced repository structure using the repository manager (supports caching and embedding-aware features, only works for embedded repositories)',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          path: z
            .string()
            .describe(
              'Optional directory path to explore (default: root directory). Leave empty for root directory.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getRepositoryStructure',
          (params: any) => executeGetRepositoryStructure(params, updateStatus)
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

      deleteFile: tool({
        description:
          'Delete a file from the repository. Use this when you need to remove files that are no longer needed.',
        parameters: z.object({
          path: z
            .string()
            .describe('The file path in the repository to delete'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to delete the file from'),
          message: z.string().describe('Commit message for the deletion'),
        }),
        execute: createMemoryAwareToolExecutor('deleteFile', (params: any) =>
          executeDeleteFile(params, updateStatus)
        ),
      }),
      resetBranchToHead: tool({
        description:
          'Reset a branch to the head of another branch (or the default branch). This will force update the branch to match the target branch exactly.',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to reset'),
          baseBranch: z
            .string()
            .describe(
              'The branch to reset to (defaults to the repository default branch)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'resetBranchToHead',
          (params: any) => executeResetBranchToHead(params, updateStatus)
        ),
      }),
      // Foolproof file reading tool
      getRawFileContent: tool({
        description:
          'Read file content from a GitHub repository. Returns raw, unformatted source code. Automatically handles large files by chunking into 200-line sections.',
        parameters: z.object({
          file_path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          should_read_entire_file: z
            .boolean()
            .describe(
              'Whether to read the entire file. Defaults to false. If true, reads up to 1500 lines total.'
            ),
          start_line_one_indexed: z
            .number()
            .describe(
              'The one-indexed line number to start reading from (inclusive). Required if should_read_entire_file is false.'
            ),
          end_line_one_indexed_inclusive: z
            .number()
            .describe(
              'The one-indexed line number to end reading at (inclusive). Required if should_read_entire_file is false.'
            ),
          branch: z
            .string()
            .describe(
              'Branch to read from. Leave empty to use default branch.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getRawFileContent',
          (params: any) =>
            executeGetRawFileContent({ ...params, sessionId }, updateStatus)
        ),
      }),
      readRelatedFiles: tool({
        description:
          'Read multiple related files for a given file, including imports, tests, and type definitions.',
        parameters: z.object({
          mainPath: z
            .string()
            .describe('The main file path to find related files for'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          includeImports: z
            .boolean()
            .describe(
              'Include imported files (default: true). Use true if not specified.'
            ),
          includeTests: z
            .boolean()
            .describe(
              'Include test files (default: true). Use true if not specified.'
            ),
          includeTypes: z
            .boolean()
            .describe(
              'Include type definition files (default: true). Use true if not specified.'
            ),
          maxFiles: z
            .number()
            .describe(
              'Maximum number of related files to read (default: 10). Use 10 if not specified.'
            ),
          branch: z
            .string()
            .describe(
              'Branch to read from (defaults to default branch). Leave empty to use default branch.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'readRelatedFiles',
          (params: any) => executeReadRelatedFiles(params, updateStatus)
        ),
      }),
      // Line-based file editing tool - replaces specific line ranges
      replaceLines: tool({
        description:
          'Replace specific line ranges with new content. Uses precise line numbers instead of unreliable string matching.',
        parameters: z.object({
          file_path: z.string().describe('The path to the file to modify'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z
            .string()
            .describe(
              'Branch to edit (required - specify the exact branch name)'
            ),
          start_line: z
            .number()
            .int()
            .min(1)
            .describe('First line to replace (1-indexed)'),
          end_line: z
            .number()
            .int()
            .min(1)
            .describe('Last line to replace (1-indexed, inclusive)'),
          new_content: z
            .string()
            .describe('New content to replace the line range with'),
          commit_message: z.string().describe('Commit message for the change'),
        }),
        execute: createMemoryAwareToolExecutor('replaceLines', (params: any) =>
          executeReplaceLines(params, updateStatus)
        ),
      }),
      // Line-based insertion tool - insert content at specific line numbers
      insertLines: tool({
        description:
          'Insert new content at a specific line number. Uses precise line positioning instead of unreliable context matching.',
        parameters: z.object({
          file_path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z
            .string()
            .describe(
              'Branch to edit (required - specify the exact branch name)'
            ),
          line_number: z
            .number()
            .int()
            .min(1)
            .describe(
              'Line number where to insert content (1-indexed). Use 1 for start of file, or totalLines+1 for end of file'
            ),
          new_content: z.string().describe('The new content to insert'),
          commit_message: z.string().describe('Commit message for the change'),
        }),
        execute: createMemoryAwareToolExecutor('insertLines', (params: any) =>
          executeInsertLines(params, updateStatus)
        ),
      }),
      // Line-based deletion tool - delete specific line ranges
      deleteLines: tool({
        description:
          'Delete specific line ranges from a file. Uses precise line numbers for safe, predictable deletion.',
        parameters: z.object({
          file_path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z
            .string()
            .describe(
              'Branch to edit (required - specify the exact branch name)'
            ),
          start_line: z
            .number()
            .int()
            .min(1)
            .describe('First line to delete (1-indexed)'),
          end_line: z
            .number()
            .int()
            .min(1)
            .describe('Last line to delete (1-indexed, inclusive)'),
          commit_message: z.string().describe('Commit message for the change'),
        }),
        execute: createMemoryAwareToolExecutor('deleteLines', (params: any) =>
          executeDeleteLines(params, updateStatus)
        ),
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
