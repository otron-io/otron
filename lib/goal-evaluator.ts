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

/**
 * Evaluates whether the agent has successfully completed its intended goal
 */
export class GoalEvaluator {
  /**
   * Evaluate if the agent's execution successfully achieved the initial goal
   */
  async evaluateGoalCompletion(
    initialContext: CoreMessage[],
    executionSummary: AgentExecutionSummary,
    attemptNumber: number = 1
  ): Promise<GoalEvaluationResult> {
    // Extract the user's request/goal from the initial context
    const userRequest = this.extractUserRequest(initialContext);

    // Create evaluation prompt
    const evaluationPrompt = `You are an AI goal completion evaluator. Your job is to determine if an AI agent has successfully completed the user's request.

USER'S ORIGINAL REQUEST:
${userRequest}

AGENT'S EXECUTION SUMMARY:
- Tools used: ${executionSummary.toolsUsed.join(', ')}
- Actions performed: ${executionSummary.actionsPerformed.join('; ')}
- Final response: ${executionSummary.finalResponse}
- Ended explicitly: ${executionSummary.endedExplicitly}
- Attempt number: ${attemptNumber}

EVALUATION CRITERIA:
1. Did the agent address the core request?
2. Were appropriate actions taken?
3. Is the task logically complete?
4. Are there obvious missing steps?

For development/coding tasks, consider:
- Was code actually written/modified if requested?
- Were files created/updated as needed?
- Was a branch created if working on an issue?
- Was a PR created if the work is complete?

For issue management tasks, consider:
- Was the issue status updated appropriately?
- Were comments added if needed?
- Was the issue assigned if requested?

For communication tasks, consider:
- Were messages sent to the right channels/people?
- Was the information conveyed clearly?

Be reasonably lenient - don't require perfection, but ensure core objectives are met.

Note: The agents responses do not go to the user. It can only communicate via the tools it has access to.
If the user is just casually chatting with the agent, you can assume the goal was achieved if the agent responded in a helpful way.

Respond with a JSON object containing:
{
  "isComplete": boolean,
  "confidence": number (0-1),
  "reasoning": "detailed explanation",
  "missingActions": ["action1", "action2"] (if incomplete),
  "nextSteps": "what should be done next" (if incomplete)
}`;

    try {
      const { text } = await generateText({
        model: openai('o4-mini'),
        system:
          'You are a precise goal completion evaluator. Always respond with valid JSON.',
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

      return result;
    } catch (error) {
      console.error('Error evaluating goal completion:', error);

      // Fallback evaluation - be conservative
      return {
        isComplete:
          executionSummary.endedExplicitly &&
          executionSummary.toolsUsed.length > 0,
        confidence: 0.5,
        reasoning:
          'Evaluation failed, using fallback logic. Agent used tools and ended explicitly.',
        missingActions: [],
        nextSteps: 'Manual review recommended due to evaluation error.',
      };
    }
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
4. Do not end prematurely - complete all necessary steps
5. Use appropriate tools to accomplish the remaining tasks

Please continue from where the previous attempt left off and complete the goal.`;

    return feedback;
  }
}

export const goalEvaluator = new GoalEvaluator();
