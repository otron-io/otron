import { CoreMessage, generateText } from 'ai';
import { LinearClient } from '@linear/sdk';
import { openai } from '@ai-sdk/openai';
import { memoryManager } from '../../memory/memory-manager.js';
import {
  linearAgentSessionManager,
  agentActivity,
} from '../../linear/linear-agent-session-manager.js';
import { GenerationResult, SlackContext } from './types.js';
import { extractIssueIdFromContext } from '../context/context-extractor.js';
import { getRepositoryContext } from '../context/repository-context.js';
import { createToolRegistry } from '../tools/tool-registry.js';
import { createMemoryAwareToolExecutor } from '../tools/tool-executor.js';
import {
  createExecutionTracker,
  createExecutionStrategy,
} from '../utils/execution-tracker.js';

/**
 * Internal response generation function
 */
export async function generateResponseInternal(
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient,
  slackContext?: SlackContext,
  attemptNumber: number = 1,
  sessionId?: string,
  abortSignal?: AbortSignal
): Promise<GenerationResult> {
  // Track execution details for goal evaluation
  const executionTracker = createExecutionTracker();
  const executionStrategy = createExecutionStrategy();

  // Extract context ID for memory operations
  const contextId = extractIssueIdFromContext(messages, slackContext);
  const isLinearIssue = !!(contextId && !contextId.startsWith('slack:'));

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
getRawFileContent({
  file_path: "src/component.ts",
  repository: "owner/repo", 
  branch: "main",
  should_read_entire_file: true
})
\`\`\`

**For large files, read specific ranges:**
\`\`\`
getRawFileContent({
  file_path: "large-file.ts",
  repository: "owner/repo",
  branch: "main", 
  should_read_entire_file: false,
  start_line_one_indexed: 1,
  end_line_one_indexed_inclusive: 100
})
\`\`\`

### Editing Files (Line-Based Precision)
**Always read first, then edit with exact line numbers:**

\`\`\`
// 1. Read current content
getRawFileContent(...)

// 2. Make precise edits
replaceLines({
  file_path: "src/file.ts",
  repository: "owner/repo",
  branch: "feature-branch",
  start_line: 45,
  end_line: 47,
  new_content: "// Updated code here",
  commit_message: "Fix bug in function"
})
\`\`\`

## Error Recovery Rules
❌ **Don't retry same failing call** - Agent will be stuck in loops
✅ **Try different approaches:**
- File not found? Use searchEmbeddedCode to locate it
- Edit failed? Read current content first with getRawFileContent
- Tool error? Use alternative tool with different parameters
- No results? Expand search terms or use different search method

## Platform-Specific Guidelines

### Linear Operations
- Always include issue ID (e.g., "OTR-123") in tool calls
- Update status immediately for clear requests
- Add comments to document progress
- Use createAgentActivity for transparent logging

### GitHub Operations  
- Create branches before editing files
- Commit changes with descriptive messages
- Create PRs only after confirming commits exist
- Use precise line numbers for edits

### Slack Operations
- Respond in threads when appropriate
- Use reactions for quick acknowledgments
- Format messages clearly with proper structure

${
  repositoryContext
    ? `## Available Repositories
${repositoryContext}`
    : ''
}${
    memoryContext
      ? `## Context & History
${memoryContext}`
      : ''
  }## Remember
**Execute decisively, adapt intelligently**. Users expect immediate action on clear requests and smart problem-solving when tools fail.`;

  // Create tool executor factory with context
  const createToolExecutor = (toolName: string, executor: Function) =>
    createMemoryAwareToolExecutor(toolName, executor, {
      executionTracker,
      executionStrategy,
      sessionId,
      contextId,
      isLinearIssue,
      linearClient,
      slackContext,
      messages,
      abortSignal,
    });

  // Create tool registry
  const tools = createToolRegistry(createToolExecutor, updateStatus);

  // Generate response using AI
  const { text, reasoning } = await generateText({
    model: openai('gpt-4o'),
    system: systemPrompt,
    temperature: 0.8,
    messages,
    maxSteps: 30,
    abortSignal,
    tools,
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
}
