import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CoreMessage } from 'ai';

// Mock OpenAI
vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn(() => 'mocked-openai-model'),
}));

// Mock AI SDK
vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

describe('Goal Evaluator', () => {
  let goalEvaluator: any;
  let mockGenerateText: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const aiModule = await import('ai');
    mockGenerateText = aiModule.generateText as any;

    const { goalEvaluator: ge } = await import(
      '../../../lib/ai/goal-evaluator.js'
    );
    goalEvaluator = ge;
  });

  describe('evaluateGoalCompletion', () => {
    it('should evaluate completed goal', async () => {
      const messages: CoreMessage[] = [
        { role: 'user', content: 'Update issue TEST-123 status to Done' },
      ];

      const executionResult = {
        toolsUsed: ['updateIssueStatus'],
        actionsPerformed: ['Updated issue TEST-123 status to Done'],
        finalResponse: 'Successfully updated issue TEST-123 status to Done',
        endedExplicitly: false,
      };

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          isComplete: true,
          confidence: 0.95,
          reasoning:
            'The goal was successfully completed. The issue status was updated as requested.',
        }),
      });

      const result = await goalEvaluator.evaluateGoalCompletion(
        messages,
        executionResult
      );

      expect(result.isComplete).toBe(true);
      expect(result.confidence).toBe(0.95);
      expect(result.reasoning).toContain('successfully completed');
      expect(mockGenerateText).toHaveBeenCalledOnce();
    });

    it('should evaluate incomplete goal', async () => {
      const messages: CoreMessage[] = [
        { role: 'user', content: 'Create a pull request for the feature' },
      ];

      const executionResult = {
        toolsUsed: ['searchEmbeddedCode'],
        actionsPerformed: ['Searched for related code'],
        finalResponse: 'Found some relevant code files',
        endedExplicitly: false,
      };

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          isComplete: false,
          confidence: 0.3,
          reasoning:
            'The goal was not completed. A pull request was requested but not created.',
        }),
      });

      const result = await goalEvaluator.evaluateGoalCompletion(
        messages,
        executionResult
      );

      expect(result.isComplete).toBe(false);
      expect(result.confidence).toBe(0.3);
      expect(result.reasoning).toContain('not completed');
    });

    it('should evaluate partially completed goal', async () => {
      const messages: CoreMessage[] = [
        {
          role: 'user',
          content: 'Fix the bug in the authentication system and create a PR',
        },
      ];

      const executionResult = {
        toolsUsed: ['searchEmbeddedCode', 'getRawFileContent', 'replaceLines'],
        actionsPerformed: [
          'Searched code',
          'Read auth files',
          'Fixed bug in auth.ts',
        ],
        finalResponse:
          'Fixed the authentication bug, but still need to create the PR',
        endedExplicitly: false,
      };

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          isComplete: false,
          confidence: 0.6,
          reasoning:
            'Partially completed. Bug was fixed but pull request was not created.',
        }),
      });

      const result = await goalEvaluator.evaluateGoalCompletion(
        messages,
        executionResult
      );

      expect(result.isComplete).toBe(false);
      expect(result.confidence).toBe(0.6);
      expect(result.reasoning).toContain('Partially completed');
    });

    it('should handle evaluation errors gracefully', async () => {
      const messages: CoreMessage[] = [
        { role: 'user', content: 'Test message' },
      ];

      const executionResult = {
        toolsUsed: [],
        actionsPerformed: [],
        finalResponse: 'Test response',
        endedExplicitly: false,
      };

      mockGenerateText.mockRejectedValue(new Error('OpenAI API error'));

      const result = await goalEvaluator.evaluateGoalCompletion(
        messages,
        executionResult
      );

      // Should return a default evaluation when AI fails
      expect(result.isComplete).toBe(false);
      expect(result.confidence).toBeLessThan(0.5);
      expect(result.reasoning).toContain('error');
    });

    it('should handle malformed AI response', async () => {
      const messages: CoreMessage[] = [
        { role: 'user', content: 'Test message' },
      ];

      const executionResult = {
        toolsUsed: ['testTool'],
        actionsPerformed: ['test action'],
        finalResponse: 'Test response',
        endedExplicitly: false,
      };

      mockGenerateText.mockResolvedValue({
        text: 'Invalid JSON response',
      });

      const result = await goalEvaluator.evaluateGoalCompletion(
        messages,
        executionResult
      );

      // Should return a default evaluation when JSON parsing fails
      expect(result.isComplete).toBe(false);
      expect(result.confidence).toBeLessThan(0.5);
      expect(result.reasoning).toContain('parse');
    });
  });
});
