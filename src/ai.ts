import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { LinearClient } from "@linear/sdk";

const model = openai("gpt-4.1-mini");

// Function to analyze an issue and identify missing information
export async function analyzeIssue(issueContext: string): Promise<string> {
  const { text } = await generateText({
    model,
    prompt: `As an assistant for a Linear project management tool, analyze this issue for missing information:

${issueContext}

Identify gaps in these areas:
1. Acceptance criteria
2. Technical specifications
3. User personas/roles
4. Environment details
5. Dependencies
6. Required resources

FORMAT YOUR RESPONSE:
- Use Markdown formatting
- Start with a brief summary
- List missing information by category
- Suggest what information would be most valuable to add
- Keep your analysis concise and actionable`,
    temperature: 0.2,
    maxTokens: 1000,
  });

  return text;
}

// Function to get comprehensive context about an issue
export async function getIssueContext(
  issue: any,
  linearClient: LinearClient,
): Promise<string> {
  // Get related entities
  const team = await issue.team;

  // Get comments
  const comments = await issue.comments({ first: 10 });
  const commentData = comments.nodes
    .map(
      (c: any) =>
        `${c.user?.name || "Unknown"} (${new Date(c.createdAt).toLocaleString()}): ${c.body}`,
    )
    .join("\n\n");

  // Get labels
  const labels =
    issue.labels?.nodes?.map((l: any) => l.name).join(", ") || "None";

  // Build context string
  let context = `# Issue Information
ID: ${issue.identifier}
Title: ${issue.title}
Description: ${issue.description || "No description provided"}
Team: ${team ? team.name : "Unknown"}
Priority: ${getPriorityText(issue.priority)}
State: ${issue.state?.name || "Unknown"}
Labels: ${labels}
Created: ${new Date(issue.createdAt).toLocaleString()}
`;

  // Add related issues if any
  try {
    const relations = await issue.relations();
    if (relations.nodes.length > 0) {
      context += "\n## Related Issues:\n";
      for (const relation of relations.nodes) {
        const relatedIssue = relation.relatedIssue;
        context += `- ${relatedIssue.identifier}: ${relatedIssue.title}\n`;
      }
    }
  } catch (error) {
    // Ignore errors fetching relations
  }

  // Add subtasks if any
  try {
    const children = await issue.children();
    if (children.nodes.length > 0) {
      context += "\n## Subtasks:\n";
      for (const child of children.nodes) {
        context += `- ${child.identifier}: ${child.title} (${child.state?.name || "Unknown"})\n`;
      }
    }
  } catch (error) {
    // Ignore errors fetching subtasks
  }

  // Add comments if any
  if (commentData) {
    context += "\n## Comments:\n" + commentData;
  }

  return context;
}

// Function to answer user questions based on issue context
export async function answerUserQuestion(
  question: string,
  issueContext: string,
): Promise<string> {
  const { text } = await generateText({
    model,
    prompt: `As an assistant for the Linear project management tool, answer this question about an issue:

ISSUE CONTEXT:
${issueContext}

USER QUESTION:
${question}

Guidelines for your response:
- Be helpful, concise, and specific
- Only use information from the provided context
- If you're unsure or the context doesn't contain relevant information, say so
- Format your response with Markdown when helpful
- Don't mention that you're an AI assistant
- Focus on practical answers that move work forward
- Don't hallucinate information not found in the context`,
    temperature: 0.3,
    maxTokens: 1000,
  });

  return text;
}

// Function to summarize an issue
export async function summarizeIssue(issueContext: string): Promise<string> {
  const { text } = await generateText({
    model,
    prompt: `Summarize this Linear issue concisely:

${issueContext}

Create a summary that:
- Captures the core purpose of the issue
- Mentions key technical details
- Notes any important dependencies
- Highlights decisions or considerations
- Uses bullet points for clarity`,
    temperature: 0.2,
    maxTokens: 600,
  });

  return text;
}

// Helper function to get a readable priority text
function getPriorityText(priority: number | null): string {
  switch (priority) {
    case 0:
      return "No Priority";
    case 1:
      return "Urgent";
    case 2:
      return "High";
    case 3:
      return "Medium";
    case 4:
      return "Low";
    default:
      return "Unknown";
  }
}

// Function to generate refinement questions for an issue
export async function generateRefinementQuestions(
  issueContext: string,
): Promise<string> {
  const { text } = await generateText({
    model,
    prompt: `As an assistant for Linear, generate questions to help refine this issue:

${issueContext}

Create 3-5 targeted questions that would help:
- Clarify requirements
- Define technical specifications
- Identify potential edge cases
- Establish acceptance criteria
- Uncover hidden dependencies

Format as a numbered list with brief context for each question.`,
    temperature: 0.4,
    maxTokens: 800,
  });

  return text;
}

// Function to suggest labels for an issue
export async function suggestLabels(
  issueContext: string,
  availableLabels: string[],
): Promise<string[]> {
  const labelsString = availableLabels.join(", ");

  const { text } = await generateText({
    model,
    prompt: `Based on this issue description, suggest appropriate labels from the available list:

ISSUE:
${issueContext}

AVAILABLE LABELS:
${labelsString}

Return only the names of 1-3 most relevant labels as a comma-separated list. Do not add any labels that don't exist in the available labels list.`,
    temperature: 0.1,
    maxTokens: 100,
  });

  return text.split(",").map((label) => label.trim());
}
