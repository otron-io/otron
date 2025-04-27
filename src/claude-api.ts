import fetch from 'node-fetch';

type ClaudeModelType =
  | 'claude-3.7-sonnet'
  | 'claude-3.5-sonnet'
  | 'claude-3.5-haiku';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class ClaudeService {
  private apiKey: string;
  private baseUrl = 'https://api.anthropic.com/v1/messages';
  private defaultModel: ClaudeModelType = 'claude-3.7-sonnet';

  constructor(apiKey: string, model?: ClaudeModelType) {
    this.apiKey = apiKey;
    if (model) {
      this.defaultModel = model;
    }
  }

  /**
   * Analyze code and generate a technical report
   */
  async analyzeCode(
    codeSnippets: Array<{ path: string; content: string }>,
    context: string,
    issue: { title: string; description: string }
  ): Promise<string> {
    const messages: ClaudeMessage[] = [
      {
        role: 'user',
        content: `# Technical Analysis Request

## Issue Information
Title: ${issue.title}
Description: ${issue.description}

## Context
${context}

## Codebase Files
${codeSnippets
  .map(
    (snippet, index) => `### File ${index + 1}: ${snippet.path}
\`\`\`
${snippet.content}
\`\`\`
`
  )
  .join('\n')}

Please analyze the provided code snippets in relation to the described issue and provide a technical report with:

1. A high-level summary of the issue
2. The root cause analysis 
3. Specific problematic code patterns
4. Recommended fixes with code examples
5. Implementation plan with specific file changes needed

Format your response as Markdown with appropriate sections and code blocks.`,
      },
    ];

    const response = await this.callClaudeAPI(messages);
    return this.extractTextContent(response);
  }

  /**
   * Generate implementation code based on an analysis
   */
  async generateImplementation(
    analysisReport: string,
    codeSnippets: Array<{ path: string; content: string }>,
    issue: { title: string; description: string }
  ): Promise<Array<{ path: string; content: string; message: string }>> {
    const messages: ClaudeMessage[] = [
      {
        role: 'user',
        content: `# Implementation Request

## Issue Information
Title: ${issue.title}
Description: ${issue.description}

## Technical Analysis
${analysisReport}

## Current Code
${codeSnippets
  .map(
    (snippet) => `### ${snippet.path}
\`\`\`
${snippet.content}
\`\`\`
`
  )
  .join('\n')}

Based on the technical analysis, please implement the necessary changes to fix the issue. For each file that needs to be modified:

1. Provide the full updated file content
2. Explain the changes made
3. Suggest a commit message

Format your response as a JSON array where each item has:
- path: The file path
- content: The complete updated file content 
- message: A clear commit message for this change

Example:
\`\`\`json
[
  {
    "path": "src/example.ts",
    "content": "// Updated file content...",
    "message": "Fix null reference in example.ts"
  }
]
\`\`\``,
      },
    ];

    const response = await this.callClaudeAPI(messages, 'claude-3.7-sonnet');
    const responseText = this.extractTextContent(response);

    // Extract the JSON array from the response
    const jsonMatch =
      responseText.match(/```json\n([\s\S]*?)\n```/) ||
      responseText.match(/```\n([\s\S]*?)\n```/) ||
      responseText.match(/\[([\s\S]*?)\]/);

    if (jsonMatch && jsonMatch[1]) {
      try {
        let jsonText = jsonMatch[1];
        // If it's not a complete array, wrap it
        if (!jsonText.trim().startsWith('[')) {
          jsonText = `[${jsonText}]`;
        }
        return JSON.parse(jsonText);
      } catch (error) {
        console.error('Failed to parse JSON response:', error);
        throw new Error(
          'Could not parse implementation JSON from Claude response'
        );
      }
    }

    throw new Error(
      'Could not extract implementation details from Claude response'
    );
  }

  /**
   * Review code changes before submitting a PR
   */
  async reviewChanges(
    originalFiles: Array<{ path: string; content: string }>,
    updatedFiles: Array<{ path: string; content: string }>,
    issue: { title: string; description: string }
  ): Promise<string> {
    const messages: ClaudeMessage[] = [
      {
        role: 'user',
        content: `# Code Review Request

## Issue Information
Title: ${issue.title}
Description: ${issue.description}

## Changes Made
${updatedFiles
  .map((file, index) => {
    const originalFile = originalFiles.find((f) => f.path === file.path);
    return `### ${file.path}
  
**Original:**
\`\`\`
${originalFile?.content || 'New file'}
\`\`\`

**Updated:**
\`\`\`
${file.content}
\`\`\`
`;
  })
  .join('\n\n')}

Please review these changes and provide:

1. A summary of the changes made
2. Any potential issues or bugs introduced
3. Suggestions for improvements
4. Overall assessment (approve/request changes)

Format your response as a concise Markdown document.`,
      },
    ];

    const response = await this.callClaudeAPI(messages);
    return this.extractTextContent(response);
  }

  /**
   * Core method to call the Claude API
   */
  private async callClaudeAPI(
    messages: ClaudeMessage[],
    model: ClaudeModelType = this.defaultModel
  ): Promise<ClaudeResponse> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${errorText}`);
      }

      return (await response.json()) as ClaudeResponse;
    } catch (error) {
      console.error('Error calling Claude API:', error);
      throw error;
    }
  }

  /**
   * Helper to extract text content from Claude response
   */
  private extractTextContent(response: ClaudeResponse): string {
    if (
      response.content &&
      Array.isArray(response.content) &&
      response.content.length > 0
    ) {
      return response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    }
    return '';
  }
}
