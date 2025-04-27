import { openai } from '@ai-sdk/openai';
import type { Issue, LinearClient } from '@linear/sdk';
import { generateText } from 'ai';

const model = openai('gpt-4.1.1-mini');

// Function to get context about an issue
export async function getIssueContext(
  issue: Issue,
  linearClient: LinearClient
): Promise<string> {
  // Get team
  const team = await issue.team;

  // Get comments (just a few recent ones)
  const comments = await issue.comments({ first: 3 });
  const commentData = comments.nodes
    .map((c) => `${c.user?.name || 'Unknown'}: ${c.body}`)
    .join('\n\n');

  // Build simple context string
  let context = `Issue: ${issue.identifier} - ${issue.title}
Team: ${team ? team.name : 'Unknown'}
Priority: ${getPriorityText(issue.priority)}
State: ${issue?.state?.name || 'Unknown'}
Description: ${issue.description || 'No description provided'}
`;

  // Add comments if any
  if (commentData) {
    context += `\nRecent comments:\n${commentData}`;
  }

  return context;
}

// Function to respond to messages based on context
export async function respondToMessage(
  question: string,
  context: string
): Promise<string> {
  const { text } = await generateText({
    model,
    prompt: `You're a helpful assistant for a project management tool. Respond in a natural, brief and helpful way to this question:

CONTEXT:
${context}

QUESTION:
${question}

Guidelines:
- Keep responses short and conversational (2-4 sentences)
- Be friendly and helpful
- Avoid formal language or jargon
- Don't use phrases like "As an AI assistant"
- Focus on practical advice`,
    temperature: 0.7,
    maxTokens: 400,
  });

  return text;
}

// Helper function to get a readable priority text
function getPriorityText(priority: number | null): string {
  switch (priority) {
    case 0:
      return 'No Priority';
    case 1:
      return 'Urgent';
    case 2:
      return 'High';
    case 3:
      return 'Medium';
    case 4:
      return 'Low';
    default:
      return 'Unknown';
  }
}
