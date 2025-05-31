import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { CoreMessage } from 'ai';

interface GoalEvaluationResult {
  isComplete: boolean;
  confidence: number; // 0-1 scale
  reasoning: string;
  missingActions?: string[];
  nextSteps?: string;
}

interface AgentExecutionSummary {
  toolsUsed: string[];
  actionsPerformed: string[];
  finalResponse: string;
  endedExplicitly: boolean;
}

interface RequestAnalysis {
  type:
    | 'casual_conversation'
    | 'information_request'
    | 'task_execution'
    | 'issue_management'
    | 'code_development';
  complexity: 'simple' | 'moderate' | 'complex';
  requiresTools: boolean;
  platform: 'slack' | 'linear' | 'github' | 'unknown';
  urgency: 'low' | 'medium' | 'high';
}

/**
 * Evaluates whether the agent has successfully completed its intended goal
 */
export class GoalEvaluator {
  /**
   * Analyze the user's request to understand its type and requirements
   */
  private async analyzeRequest(
    messages: CoreMessage[],
    executionSummary: AgentExecutionSummary
  ): Promise<RequestAnalysis> {
    const userRequest = this.extractUserRequest(messages);
    const fullContext = this.extractFullContext(messages);

    try {
      const { text } = await generateText({
        model: openai('gpt-4.1-mini'),
        system: `You are an AI request analyzer. Analyze the user's request to understand its type and requirements.

CONTEXT:
${fullContext}

USER'S REQUEST:
${userRequest}

AGENT'S EXECUTION:
- Tools used: ${executionSummary.toolsUsed.join(', ')}
- Actions performed: ${executionSummary.actionsPerformed.join('; ')}

Categorize this request and respond with a JSON object:
{
  "type": "casual_conversation" | "information_request" | "task_execution" | "issue_management" | "code_development",
  "complexity": "simple" | "moderate" | "complex",
  "requiresTools": boolean,
  "platform": "slack" | "linear" | "github" | "unknown",
  "urgency": "low" | "medium" | "high"
}

Guidelines:
- casual_conversation: greetings, small talk, general chat (hi, hello, how are you, etc.)
- information_request: asking for information, status updates, explanations
- task_execution: specific actions like sending messages, updating statuses, creating items
- issue_management: Linear issue operations (create, update, assign, comment)
- code_development: coding tasks, PR creation, file modifications

- simple: basic one-step actions or responses
- moderate: multi-step but straightforward tasks
- complex: requires planning, multiple tools, or complex logic

- requiresTools: true if the request inherently needs tool usage to be complete
- platform: where the interaction is happening or where action is needed
- urgency: based on language used and context`,
        messages: [
          {
            role: 'user',
            content: 'Analyze this request.',
          },
        ],
        temperature: 0,
      });

      return JSON.parse(text) as RequestAnalysis;
    } catch (error) {
      console.error('Error analyzing request:', error);
      // Fallback analysis
      return {
        type:
          userRequest.length < 20 && /^(hi|hello|hey|sup)/i.test(userRequest)
            ? 'casual_conversation'
            : 'task_execution',
        complexity: 'simple',
        requiresTools: !/^(hi|hello|hey|sup|thanks|thank you)$/i.test(
          userRequest.trim()
        ),
        platform: 'unknown',
        urgency: 'medium',
      };
    }
  }

  /**
   * Evaluate if the agent's execution successfully achieved the initial goal
   */
  async evaluateGoalCompletion(
    initialContext: CoreMessage[],
    executionSummary: AgentExecutionSummary,
    attemptNumber: number = 1
  ): Promise<GoalEvaluationResult> {
    // First, analyze the request to understand what type of interaction this is
    const requestAnalysis = await this.analyzeRequest(
      initialContext,
      executionSummary
    );

    // Extract the user's request/goal from the initial context
    const userRequest = this.extractUserRequest(initialContext);
    const fullContext = this.extractFullContext(initialContext);

    // For casual conversations, be very lenient
    if (requestAnalysis.type === 'casual_conversation') {
      return {
        isComplete: true,
        confidence: 0.95,
        reasoning:
          'This is a casual conversation. The agent appropriately responded to the greeting/casual message.',
      };
    }

    // For simple information requests that don't require tools, check if agent provided a response
    if (
      requestAnalysis.type === 'information_request' &&
      !requestAnalysis.requiresTools
    ) {
      return {
        isComplete: executionSummary.finalResponse.length > 0,
        confidence: 0.9,
        reasoning:
          executionSummary.finalResponse.length > 0
            ? 'Information request answered with appropriate response.'
            : 'Information request not answered - no response provided.',
      };
    }

    // For more complex tasks, use detailed evaluation
    return await this.performDetailedEvaluation(
      userRequest,
      fullContext,
      executionSummary,
      requestAnalysis,
      attemptNumber
    );
  }

  /**
   * Perform detailed evaluation for complex tasks
   */
  private async performDetailedEvaluation(
    userRequest: string,
    fullContext: string,
    executionSummary: AgentExecutionSummary,
    requestAnalysis: RequestAnalysis,
    attemptNumber: number
  ): Promise<GoalEvaluationResult> {
    const evaluationPrompt = `
FULL CONVERSATION CONTEXT:
${fullContext}

USER'S SPECIFIC REQUEST:
${userRequest}

REQUEST ANALYSIS:
- Type: ${requestAnalysis.type}
- Complexity: ${requestAnalysis.complexity}
- Requires Tools: ${requestAnalysis.requiresTools}
- Platform: ${requestAnalysis.platform}
- Urgency: ${requestAnalysis.urgency}`;

    try {
      const { text } = await generateText({
        model: openai('gpt-4.1-mini'),
        system: `You are an AI goal completion evaluator. Your job is to determine if an AI agent has successfully completed the user's request.

AGENT'S EXECUTION SUMMARY:
- Tools used: ${executionSummary.toolsUsed.join(', ')}
- Actions performed: ${executionSummary.actionsPerformed.join('; ')}
- Final response: ${executionSummary.finalResponse}
- Ended explicitly: ${executionSummary.endedExplicitly}
- Attempt number: ${attemptNumber}

EVALUATION GUIDELINES:

**Be Context-Aware:**
- Consider the type of request and platform
- Understand that different requests have different completion criteria
- Don't expect tool usage for requests that don't need it

**For Different Request Types:**

1. **Casual Conversation:** Almost always complete if agent responded appropriately
2. **Information Requests:** Complete if information was provided (tools optional)
3. **Task Execution:** Must use appropriate tools and complete the requested action
4. **Issue Management:** Must interact with Linear appropriately (status updates, comments, etc.)
5. **Code Development:** Must write/modify code, create branches, potentially create PRs

**Tool Usage Expectations:**
- Slack conversations: Should use Slack tools to respond (sendSlackMessage, etc.)
- Linear issues: Should use Linear tools for updates (updateIssueStatus, createLinearComment, etc.)
- Code tasks: Should use GitHub tools (createBranch, createOrUpdateFile, etc.)
- Information only: Tools may not be required if just providing information

**Red Flags (likely incomplete):**
- User asked for specific action but no tools were used when tools were clearly needed
- Code task requested but no files were modified
- Issue management requested but no Linear tools used
- User asked to send a message somewhere but no communication tools used

**Green Flags (likely complete):**
- Appropriate tools used for the request type
- User's specific ask was addressed
- Logical sequence of actions taken
- Agent communicated results appropriately

**Be Reasonably Lenient:**
- Don't require perfection, focus on core objectives
- Consider that the agent may have valid reasons for its approach
- If the agent used relevant tools and addressed the request, it's likely complete
- Don't fail for minor omissions unless they're critical to the request

**Special Considerations:**
- If attempt number > 1, be more lenient as the agent is already trying to fix issues
- Consider the complexity level - simple tasks should be easier to complete
- Platform context matters - Slack conversations have different completion criteria than code tasks

Respond with a JSON object containing:
{
  "isComplete": boolean,
  "confidence": number (0-1),
  "reasoning": "detailed explanation of why this is complete or incomplete",
  "missingActions": ["action1", "action2"] (only if incomplete and specific actions are missing),
  "nextSteps": "what should be done next" (only if incomplete)
}`,
        messages: [
          {
            role: 'user',
            content: evaluationPrompt,
          },
        ],
        temperature: 0.1, // Low temperature for consistent evaluation
      });

      // Parse the JSON response
      const result = JSON.parse(text) as GoalEvaluationResult;

      // Validate the result
      if (
        typeof result.isComplete !== 'boolean' ||
        typeof result.confidence !== 'number' ||
        typeof result.reasoning !== 'string'
      ) {
        throw new Error('Invalid evaluation result format');
      }

      // Apply additional heuristics to prevent false negatives
      result.confidence = this.adjustConfidenceWithHeuristics(
        result,
        requestAnalysis,
        executionSummary,
        attemptNumber
      );

      return result;
    } catch (error) {
      console.error('Error evaluating goal completion:', error);

      // Improved fallback evaluation
      return this.createFallbackEvaluation(
        requestAnalysis,
        executionSummary,
        attemptNumber
      );
    }
  }

  /**
   * Apply heuristics to adjust confidence and prevent false negatives
   */
  private adjustConfidenceWithHeuristics(
    result: GoalEvaluationResult,
    requestAnalysis: RequestAnalysis,
    executionSummary: AgentExecutionSummary,
    attemptNumber: number
  ): number {
    let adjustedConfidence = result.confidence;

    // Boost confidence for casual conversations
    if (requestAnalysis.type === 'casual_conversation' && result.isComplete) {
      adjustedConfidence = Math.max(adjustedConfidence, 0.95);
    }

    // Boost confidence if tools were used appropriately for the request type
    if (
      requestAnalysis.requiresTools &&
      executionSummary.toolsUsed.length > 0
    ) {
      adjustedConfidence += 0.1;
    }

    // Boost confidence on retry attempts if some progress was made
    if (attemptNumber > 1 && executionSummary.toolsUsed.length > 0) {
      adjustedConfidence += 0.15;
    }

    // Boost confidence if agent used execution planning tools (shows good strategy)
    const planningTools = ['createExecutionPlan', 'checkExecutionProgress'];
    const usedPlanningTools = executionSummary.toolsUsed.some((tool) =>
      planningTools.includes(tool)
    );
    if (usedPlanningTools) {
      adjustedConfidence += 0.1;
    }

    // Boost confidence if agent shows good action-to-analysis ratio
    const searchTools = executionSummary.toolsUsed.filter((tool) =>
      [
        'searchEmbeddedCode',
        'searchLinearIssues',
        'searchSlackMessages',
      ].includes(tool)
    ).length;
    const actionTools = executionSummary.toolsUsed.filter((tool) =>
      [
        'createOrUpdateFile',
        'insertAtLine',
        'replaceLines',
        'deleteLines',
        'appendToFile',
        'prependToFile',
        'findAndReplace',
        'insertAfterPattern',
        'insertBeforePattern',
        'applyMultipleEdits',
        'createBranch',
        'createPullRequest',
        'updateIssueStatus',
        'createLinearComment',
        'sendSlackMessage',
        'sendChannelMessage',
        'sendDirectMessage',
      ].includes(tool)
    ).length;

    if (actionTools > 0 && searchTools <= 5) {
      adjustedConfidence += 0.05; // Reward balanced execution
    }

    // Reduce confidence if no tools were used when they were clearly needed
    if (
      requestAnalysis.requiresTools &&
      executionSummary.toolsUsed.length === 0
    ) {
      adjustedConfidence -= 0.2;
    }

    // Reduce confidence if agent used too many search tools without action (analysis paralysis)
    if (
      searchTools > 6 &&
      actionTools === 0 &&
      requestAnalysis.type === 'code_development'
    ) {
      adjustedConfidence -= 0.15;
    }

    return Math.min(Math.max(adjustedConfidence, 0), 1);
  }

  /**
   * Create a fallback evaluation when the main evaluation fails
   */
  private createFallbackEvaluation(
    requestAnalysis: RequestAnalysis,
    executionSummary: AgentExecutionSummary,
    attemptNumber: number
  ): GoalEvaluationResult {
    // For casual conversations, assume success
    if (requestAnalysis.type === 'casual_conversation') {
      return {
        isComplete: true,
        confidence: 0.9,
        reasoning:
          'Fallback evaluation: Casual conversation detected, assuming successful interaction.',
      };
    }

    // For other requests, use conservative logic
    const hasUsedTools = executionSummary.toolsUsed.length > 0;
    const toolsWereNeeded = requestAnalysis.requiresTools;

    const isComplete = !toolsWereNeeded || hasUsedTools;

    return {
      isComplete,
      confidence: isComplete ? 0.7 : 0.3,
      reasoning: `Fallback evaluation: ${
        isComplete
          ? 'Agent appears to have addressed the request appropriately.'
          : 'Agent may not have fully completed the requested task.'
      } Tools used: ${hasUsedTools}, Tools needed: ${toolsWereNeeded}`,
      missingActions: isComplete
        ? []
        : ['Review and complete the original request'],
      nextSteps: isComplete
        ? undefined
        : 'Retry with focus on using appropriate tools for the task.',
    };
  }

  /**
   * Extract the user's main request from the message history
   */
  private extractUserRequest(messages: CoreMessage[]): string {
    // Find the last user message (most recent request)
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === 'user') {
        if (typeof message.content === 'string') {
          return message.content;
        } else if (Array.isArray(message.content)) {
          return message.content
            .map((part) => ('text' in part ? part.text : ''))
            .join(' ');
        }
      }
    }

    return 'No clear user request found';
  }

  /**
   * Extract full conversation context for better understanding
   */
  private extractFullContext(messages: CoreMessage[]): string {
    return messages
      .map((message) => {
        const content =
          typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
            ? message.content
                .map((part) => ('text' in part ? part.text : ''))
                .join(' ')
            : '';
        return `${message.role}: ${content}`;
      })
      .join('\n');
  }

  /**
   * Generate feedback for the agent based on incomplete goal evaluation
   */
  generateRetryFeedback(
    evaluation: GoalEvaluationResult,
    attemptNumber: number
  ): string {
    const feedback = `🔄 **Goal Completion Review - Attempt ${attemptNumber}**

**Evaluation Result:** The previous attempt did not fully complete the intended goal.

**Reasoning:** ${evaluation.reasoning}

**Confidence Level:** ${Math.round(evaluation.confidence * 100)}%

${
  evaluation.missingActions && evaluation.missingActions.length > 0
    ? `**Missing Actions:**
${evaluation.missingActions.map((action) => `- ${action}`).join('\n')}`
    : ''
}

${evaluation.nextSteps ? `**Next Steps:** ${evaluation.nextSteps}` : ''}

**Instructions for this retry:**
1. Review what was accomplished in the previous attempt
2. Focus on completing the missing actions identified above
3. Ensure you fully address the original user request
4. Use appropriate tools to accomplish the remaining tasks
5. Consider the context and type of request when choosing your approach

Please continue from where the previous attempt left off and complete the goal.`;

    return feedback;
  }
}

export const goalEvaluator = new GoalEvaluator();
