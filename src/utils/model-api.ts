// Lines 1-157 of 157
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.js';

// Initialize Anthropic client
export const anthropic = new Anthropic({
  apiKey: env.CLAUDE_API_KEY,
});

export class ModelAPI {
  /**
   * Process a request through Claude with tool calling capability
   */
  async processWithTools(
    systemMessage: string,
    userMessages: any[],
    tools: any[]
  ): Promise<{
    response: any;
    toolCalls: any[];
    hasMoreToolCalls: boolean;
  }> {
    try {
      // Use Anthropic's streaming client
      const stream = anthropic.messages.stream({
        model: 'claude-3-7-sonnet-latest',
        max_tokens: 8192,
        system: systemMessage as any,
        messages: userMessages as any,
        tools: tools as any,
        thinking: {
          type: 'enabled',
          budget_tokens: 1024,
        },
      });

      // Store the complete response without any modifications
      const completeResponse: any[] = [];
      let lastLog = Date.now();
      let eventCount = 0;

      // Process the stream and build the complete response
      for await (const event of stream) {
        eventCount++;
        // Log progress every 5 seconds or every 20 events
        if (Date.now() - lastLog > 5000 || eventCount % 20 === 0) {
          console.log(`[Anthropic stream] Received event:`, event.type);
          lastLog = Date.now();
        }

        // Collect all events to reconstruct the exact original blocks
        if (event.type === 'content_block_start') {
          completeResponse[event.index] = { ...event.content_block };
        } else if (event.type === 'content_block_delta') {
          const block = completeResponse[event.index] || {
            type: event.delta.type,
          };

          if (event.delta.type === 'text_delta') {
            block.text = (block.text || '') + event.delta.text;
          } else if (event.delta.type === 'thinking_delta') {
            block.thinking = (block.thinking || '') + event.delta.thinking;
          } else if (event.delta.type === 'input_json_delta') {
            block.partial_json =
              (block.partial_json || '') + event.delta.partial_json;
          } else if (event.delta.type === 'signature_delta') {
            block.signature = event.delta.signature;
          }

          completeResponse[event.index] = block;
        }
      }

      // Clean up partial_json in tool_use blocks but leave everything else intact
      const finalResponse = completeResponse.map((block) => {
        if (block && block.type === 'tool_use' && block.partial_json) {
          // Parse the JSON if it's complete
          try {
            const input = JSON.parse(block.partial_json);
            return { ...block, input, partial_json: undefined };
          } catch (e) {
            // If JSON parsing fails, just return the block as is
            return block;
          }
        }
        return block;
      });

      // Extract tool use blocks
      const toolUseBlocks = finalResponse.filter(
        (block) => block && block.type === 'tool_use'
      );

      // Log tool use blocks
      if (toolUseBlocks.length > 0) {
        console.log(
          `\n[Tool Use] Found ${toolUseBlocks.length} tool use blocks:`
        );
        toolUseBlocks.forEach((block, index) => {
          console.log(`\n--- Tool Use ${index + 1} ---`);
          console.log(`Tool: ${block.name}`);
          console.log(`Input: ${JSON.stringify(block.input, null, 2)}`);
        });
      }

      // Log thinking blocks
      const thinkingBlocks = finalResponse.filter(
        (block) =>
          block &&
          (block.type === 'thinking' || block.type === 'redacted_thinking')
      );

      if (thinkingBlocks.length > 0) {
        console.log(
          `\n[Thinking Blocks] Found ${thinkingBlocks.length} thinking blocks:`
        );
        thinkingBlocks.forEach((block, index) => {
          if (block.type === 'thinking') {
            console.log(`\n--- Thinking Block ${index + 1} ---`);
            console.log(block.thinking);
          } else if (block.type === 'redacted_thinking') {
            console.log(`\n--- Redacted Thinking Block ${index + 1} ---`);
            console.log('(Content redacted for safety reasons)');
          }
        });
      }

      // Check if the model stopped due to having more tool calls
      const hasMoreToolCalls = toolUseBlocks.length > 0;

      return {
        response: finalResponse,
        toolCalls: toolUseBlocks,
        hasMoreToolCalls,
      };
    } catch (error) {
      console.error('Error processing with Claude API:', error);
      throw error;
    }
  }

  /**
   * Create a formatted tool result message to pass back to Claude
   */
  formatToolResultMessage(toolId: string, result: string): any {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolId,
          content: result,
        },
      ],
    };
  }
}
