import { Redis } from '@upstash/redis';
import { env } from '../env.js';

// Memory system constants
export const MEMORY_EXPIRY = 60 * 60 * 24 * 90; // 90 days in seconds
export const MAX_MEMORIES_PER_ISSUE = 50; // Increased to store more history
export const MAX_MEMORY_ENTRIES_TO_INCLUDE = 8; // Slightly increased for better context
export const MAX_CONTEXT_LENGTH = 2000; // Maximum characters for memory context
export const CONVERSATION_SUMMARY_THRESHOLD = 15; // Summarize if more than 15 messages

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

export class MemoryManager {
  /**
   * Store a memory entry for an issue in Redis
   */
  async storeMemory(
    issueId: string,
    memoryType: 'conversation' | 'action' | 'context',
    data: any
  ): Promise<void> {
    try {
      // Create a memory entry with timestamp and data
      const memoryEntry = {
        timestamp: Date.now(),
        type: memoryType,
        data,
        // Add relevance scoring for future retrieval
        relevanceScore: this.calculateRelevanceScore(data, memoryType),
      };

      // Store in Redis list, newest first
      await redis.lpush(
        `memory:issue:${issueId}:${memoryType}`,
        JSON.stringify(memoryEntry)
      );

      // Trim the list to prevent unlimited growth
      await redis.ltrim(
        `memory:issue:${issueId}:${memoryType}`,
        0,
        MAX_MEMORIES_PER_ISSUE - 1
      );

      // Set expiration for the key
      await redis.expire(
        `memory:issue:${issueId}:${memoryType}`,
        MEMORY_EXPIRY
      );

      console.log(`Stored ${memoryType} memory for issue ${issueId}`);
    } catch (error) {
      console.error(`Error storing memory for issue ${issueId}:`, error);
    }
  }

  /**
   * Calculate relevance score for memory entries
   */
  private calculateRelevanceScore(data: any, memoryType: string): number {
    let score = 1.0;

    // Higher score for certain types of content
    if (memoryType === 'action') {
      score += 0.5; // Actions are generally more important
    }

    if (typeof data.content === 'string') {
      const content = data.content.toLowerCase();

      // Higher score for messages with important keywords
      const importantKeywords = [
        'error',
        'bug',
        'issue',
        'problem',
        'fix',
        'urgent',
        'critical',
        'deploy',
        'release',
        'merge',
        'review',
        'approve',
        'block',
        'decision',
        'meeting',
        'deadline',
        'priority',
      ];

      const keywordMatches = importantKeywords.filter((keyword) =>
        content.includes(keyword)
      ).length;

      score += keywordMatches * 0.2;

      // Higher score for longer, more detailed messages
      if (content.length > 100) score += 0.3;
      if (content.length > 300) score += 0.2;
    }

    return Math.min(score, 3.0); // Cap at 3.0
  }

  /**
   * Retrieve relevant memory entries using smart filtering
   */
  async retrieveRelevantMemories(
    issueId: string,
    memoryType: 'conversation' | 'action' | 'context',
    currentContext?: string,
    limit: number = MAX_MEMORY_ENTRIES_TO_INCLUDE
  ): Promise<any[]> {
    try {
      // Get more memories than we need for filtering
      const allMemories = await redis.lrange(
        `memory:issue:${issueId}:${memoryType}`,
        0,
        MAX_MEMORIES_PER_ISSUE - 1
      );

      const parsedMemories = allMemories
        .map((item) => {
          try {
            return typeof item === 'object' ? item : JSON.parse(item);
          } catch (error) {
            console.error(`Error parsing memory item: ${error}`);
            return null;
          }
        })
        .filter(Boolean);

      if (parsedMemories.length === 0) return [];

      // Score memories based on relevance to current context
      const scoredMemories = parsedMemories.map((memory) => ({
        ...memory,
        contextRelevance: this.calculateContextRelevance(
          memory,
          currentContext
        ),
      }));

      // Sort by combined relevance and recency
      scoredMemories.sort((a, b) => {
        const scoreA =
          (a.relevanceScore || 1) +
          (a.contextRelevance || 0) +
          ((Date.now() - a.timestamp) / (1000 * 60 * 60 * 24)) * -0.1; // Recent bonus
        const scoreB =
          (b.relevanceScore || 1) +
          (b.contextRelevance || 0) +
          ((Date.now() - b.timestamp) / (1000 * 60 * 60 * 24)) * -0.1;
        return scoreB - scoreA;
      });

      // Return top relevant memories
      return scoredMemories.slice(0, limit);
    } catch (error) {
      console.error(`Error retrieving memories for issue ${issueId}:`, error);
      return [];
    }
  }

  /**
   * Calculate how relevant a memory is to the current context
   */
  private calculateContextRelevance(
    memory: any,
    currentContext?: string
  ): number {
    if (!currentContext || !memory.data?.content) return 0;

    const memoryContent =
      typeof memory.data.content === 'string'
        ? memory.data.content.toLowerCase()
        : JSON.stringify(memory.data.content).toLowerCase();

    const contextWords = currentContext.toLowerCase().split(/\s+/);
    const memoryWords = memoryContent.split(/\s+/);

    // Simple word overlap scoring
    const commonWords = contextWords.filter(
      (word) => word.length > 3 && memoryWords.includes(word)
    );

    return Math.min(commonWords.length * 0.1, 1.0);
  }

  /**
   * Retrieve memory entries for an issue from Redis (legacy method)
   */
  async retrieveMemories(
    issueId: string,
    memoryType: 'conversation' | 'action' | 'context',
    limit: number = MAX_MEMORY_ENTRIES_TO_INCLUDE
  ): Promise<any[]> {
    // Use the new smart retrieval method
    return this.retrieveRelevantMemories(issueId, memoryType, undefined, limit);
  }

  /**
   * Store tool usage statistics
   */
  async trackToolUsage(
    toolName: string,
    success: boolean,
    context: {
      issueId: string;
      input: any;
      response: string;
    }
  ): Promise<void> {
    try {
      // Increment tool usage counters
      await redis.hincrby(`memory:tools:${toolName}:stats`, 'attempts', 1);
      if (success) {
        await redis.hincrby(`memory:tools:${toolName}:stats`, 'successes', 1);
      }

      // Store context for this specific tool usage
      await this.storeMemory(context.issueId, 'action', {
        tool: toolName,
        input: context.input,
        response: context.response.substring(0, 500), // Limit response length
        success,
      });
    } catch (error) {
      console.error(`Error tracking tool usage for ${toolName}:`, error);
    }
  }

  /**
   * Add relationships to the memory system
   */
  async storeRelationship(
    relationshipType: string,
    entity1: string,
    entity2: string
  ): Promise<void> {
    try {
      // Store bidirectional relationships
      await redis.sadd(`memory:${relationshipType}:${entity1}`, entity2);
      await redis.expire(
        `memory:${relationshipType}:${entity1}`,
        MEMORY_EXPIRY
      );
    } catch (error) {
      console.error(`Error storing relationship ${relationshipType}:`, error);
    }
  }

  /**
   * Retrieve previous conversations with smart context management
   */
  async getPreviousConversations(
    issueId: string,
    currentContext?: string
  ): Promise<string> {
    const memories = await this.retrieveRelevantMemories(
      issueId,
      'conversation',
      currentContext
    );

    if (memories.length === 0) {
      return '';
    }

    // Check if we need to summarize due to length
    const totalMemories = await redis.llen(
      `memory:issue:${issueId}:conversation`
    );

    let contextString = '';

    if (totalMemories > CONVERSATION_SUMMARY_THRESHOLD) {
      contextString += '\n\nCONVERSATION SUMMARY:\n';
      contextString += await this.generateConversationSummary(issueId);
      contextString += '\n\nRECENT RELEVANT MESSAGES:\n';
    } else {
      contextString += '\n\nPREVIOUS CONVERSATIONS:\n';
    }

    // Format relevant memory entries
    let currentLength = contextString.length;

    for (const memory of memories) {
      const timestamp = new Date(memory.timestamp).toISOString();
      let entryText = `[${timestamp}] `;

      if (memory.data.role === 'assistant') {
        entryText += `Assistant: `;
        const textBlocks = memory.data.content
          .filter((block: any) => block && block.type === 'text')
          .map((block: any) => block.text || '')
          .join('\n');
        entryText += `${textBlocks}\n`;
      } else if (memory.data.role === 'user') {
        entryText += `User: ${memory.data.content}\n`;
      }

      // Check if adding this entry would exceed our context limit
      if (currentLength + entryText.length > MAX_CONTEXT_LENGTH) {
        contextString += '[... additional context truncated for brevity ...]\n';
        break;
      }

      contextString += entryText;
      currentLength += entryText.length;
    }

    return contextString;
  }

  /**
   * Generate a summary of older conversations
   */
  private async generateConversationSummary(issueId: string): Promise<string> {
    try {
      // Get older memories (beyond what we show in detail)
      const olderMemories = await redis.lrange(
        `memory:issue:${issueId}:conversation`,
        MAX_MEMORY_ENTRIES_TO_INCLUDE,
        CONVERSATION_SUMMARY_THRESHOLD + 5
      );

      if (olderMemories.length === 0) return '';

      // Simple summarization - count topics and key themes
      const topics = new Map<string, number>();
      const users = new Set<string>();
      let totalMessages = 0;

      for (const memoryStr of olderMemories) {
        try {
          const memory =
            typeof memoryStr === 'object' ? memoryStr : JSON.parse(memoryStr);
          totalMessages++;

          if (memory.data?.content) {
            const content =
              typeof memory.data.content === 'string'
                ? memory.data.content
                : JSON.stringify(memory.data.content);

            // Extract potential topics (simple keyword extraction)
            const words = content.toLowerCase().match(/\b\w{4,}\b/g) || [];
            words.forEach((word: string) => {
              if (
                ![
                  'this',
                  'that',
                  'with',
                  'from',
                  'they',
                  'were',
                  'been',
                  'have',
                ].includes(word)
              ) {
                topics.set(word, (topics.get(word) || 0) + 1);
              }
            });

            // Track users
            if (memory.data.role === 'user') {
              const userMatch = content.match(/Message from user (\w+)/);
              if (userMatch) users.add(userMatch[1]);
            }
          }
        } catch (error) {
          // Skip malformed entries
        }
      }

      // Generate summary
      const topTopics = Array.from(topics.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([topic]) => topic);

      return `Earlier conversation (${totalMessages} messages) involved ${
        users.size
      } participants discussing: ${topTopics.join(', ')}`;
    } catch (error) {
      console.error('Error generating conversation summary:', error);
      return 'Earlier conversation history available but could not be summarized.';
    }
  }

  /**
   * Get issue history and related activity
   */
  async getIssueHistory(issueId: string): Promise<string> {
    const actions = await this.retrieveRelevantMemories(issueId, 'action');

    if (actions.length === 0) {
      return '';
    }

    let historyString = '\n\nPREVIOUS ACTIONS:\n';

    // Format each action entry
    actions.forEach((action, index) => {
      const timestamp = new Date(action.timestamp).toISOString();
      historyString += `[${timestamp}] Tool: ${action.data.tool}, Success: ${action.data.success}\n`;
    });

    return historyString;
  }

  /**
   * Get related issues based on similarity or past relationships
   */
  async getRelatedIssues(issueId: string, linearClient: any): Promise<string> {
    try {
      // Get files associated with this issue
      const relatedFiles = await redis.smembers(`memory:issue:file:${issueId}`);

      // Find other issues that touched the same files
      let relatedIssues = new Set<string>();

      for (const file of relatedFiles) {
        const issues = await redis.smembers(`memory:file:issue:${file}`);
        // Add to set to avoid duplicates
        issues.forEach((issue) => {
          if (issue !== issueId) {
            relatedIssues.add(issue);
          }
        });
      }

      if (relatedIssues.size === 0) {
        return '';
      }

      // Get issue details for related issues (just the most recent 3)
      const relatedIssueArray = Array.from(relatedIssues).slice(0, 3);
      let relatedIssueDetails = '\n\nRELATED ISSUES:\n';

      for (const relatedIssueId of relatedIssueArray) {
        try {
          // Try to get the issue from Linear
          const relatedIssue = await linearClient.issue(relatedIssueId);
          relatedIssueDetails += `- ${relatedIssue.identifier}: ${relatedIssue.title}\n`;
        } catch (error) {
          // If we can't get the issue, just add the ID
          relatedIssueDetails += `- Issue ID: ${relatedIssueId}\n`;
        }
      }

      return relatedIssueDetails;
    } catch (error) {
      console.error(`Error retrieving related issues for ${issueId}:`, error);
      return '';
    }
  }

  /**
   * Store topic expertise for repositories and components
   */
  async storeCodeKnowledge(
    repository: string,
    path: string,
    topic: string
  ): Promise<void> {
    try {
      // Extract component from path (e.g., src/components/users -> components/users)
      const parts = path.split('/');
      let component = '';

      if (parts.length >= 2) {
        // Try to identify meaningful component (skip very generic paths like 'src')
        const skipParts = ['src', 'lib', 'app', 'main'];
        for (let i = 0; i < parts.length - 1; i++) {
          if (!skipParts.includes(parts[i])) {
            component = parts.slice(i, i + 2).join('/');
            break;
          }
        }

        // If no component found, use the directory
        if (!component && parts.length > 1) {
          component = parts[parts.length - 2];
        }
      }

      if (component) {
        // Associate the topic with this component
        await redis.zincrby(
          `memory:component:${repository}:${component}:topics`,
          1,
          topic
        );
        // Set expiry
        await redis.expire(
          `memory:component:${repository}:${component}:topics`,
          MEMORY_EXPIRY
        );
      }
    } catch (error) {
      console.error(
        `Error storing code knowledge for ${repository}:${path}:`,
        error
      );
    }
  }

  /**
   * Get knowledge about a repository's most accessed files
   */
  async getRepositoryKnowledge(repository: string): Promise<string> {
    try {
      // Get most frequently accessed files for this repository
      const fileScores = await redis.zrange(
        `memory:repository:${repository}:files`,
        0,
        9,
        {
          rev: true,
          withScores: true,
        }
      );

      if (!fileScores || fileScores.length === 0) {
        return '';
      }

      // Convert to array of files (handling new structure)
      const files: string[] = [];
      for (const entry of fileScores) {
        if (typeof entry === 'string') {
          files.push(entry);
        }
      }

      // We'll include this knowledge directly
      return (
        `\n\nREPOSITORY KNOWLEDGE (${repository}):\n` +
        `Key files: ${files.join(', ')}\n` +
        `Remember to consider repository structure and patterns when making changes.`
      );
    } catch (error) {
      console.error(
        `Error getting repository knowledge for ${repository}:`,
        error
      );
      return '';
    }
  }
}

export const memoryManager = new MemoryManager();
