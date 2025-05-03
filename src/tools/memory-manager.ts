import { Redis } from '@upstash/redis';
import { env } from '../env.js';

// Memory system constants
export const MEMORY_EXPIRY = 60 * 60 * 24 * 90; // 90 days in seconds
export const MAX_MEMORIES_PER_ISSUE = 20; // Maximum number of memory entries per issue
export const MAX_MEMORY_ENTRIES_TO_INCLUDE = 5; // Maximum number of memory entries to include in a prompt

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
   * Retrieve memory entries for an issue from Redis
   */
  async retrieveMemories(
    issueId: string,
    memoryType: 'conversation' | 'action' | 'context',
    limit: number = MAX_MEMORY_ENTRIES_TO_INCLUDE
  ): Promise<any[]> {
    try {
      const memories = await redis.lrange(
        `memory:issue:${issueId}:${memoryType}`,
        0,
        limit - 1
      );

      return memories.map((item) => {
        // Check if item is already an object
        if (typeof item === 'object' && item !== null) {
          return item;
        }

        // Otherwise try to parse it as JSON
        try {
          return JSON.parse(item);
        } catch (error) {
          console.error(`Error parsing memory item: ${error}`);
          return {
            timestamp: Date.now(),
            type: memoryType,
            data: { error: 'Failed to parse memory data' },
          };
        }
      });
    } catch (error) {
      console.error(`Error retrieving memories for issue ${issueId}:`, error);
      return [];
    }
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
      agentType?: string;
    }
  ): Promise<void> {
    try {
      // Increment tool usage counters
      await redis.hincrby(`memory:tools:${toolName}:stats`, 'attempts', 1);
      if (success) {
        await redis.hincrby(`memory:tools:${toolName}:stats`, 'successes', 1);
      }

      // Track by agent type if provided
      if (context.agentType) {
        const agentType = context.agentType;
        // Increment agent-specific tool usage
        await redis.zincrby(`memory:tool_usage:${agentType}`, 1, toolName);
        await redis.expire(`memory:tool_usage:${agentType}`, MEMORY_EXPIRY);
      }

      // Store context for this specific tool usage
      await this.storeMemory(context.issueId, 'action', {
        tool: toolName,
        input: context.input,
        response: context.response,
        success,
        agentType: context.agentType || 'main',
      });

      // Update active issues list with timestamp
      await redis.zadd('memory:active_issues', {
        score: Date.now(),
        member: context.issueId,
      });
      await redis.expire('memory:active_issues', MEMORY_EXPIRY);
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
   * Retrieve previous conversations for context augmentation
   */
  async getPreviousConversations(issueId: string): Promise<string> {
    const memories = await this.retrieveMemories(issueId, 'conversation');

    if (memories.length === 0) {
      return '';
    }

    let contextString = '\n\nPREVIOUS CONVERSATIONS:\n';

    // Format each memory entry into a readable format for the context
    memories.forEach((memory, index) => {
      const timestamp = new Date(memory.timestamp).toISOString();
      contextString += `[${timestamp}] `;

      if (memory.data.role === 'assistant') {
        contextString += `Assistant: `;
        // Extract text blocks from the assistant's message
        const textBlocks = memory.data.content
          .filter((block: any) => block && block.type === 'text')
          .map((block: any) => block.text || '')
          .join('\n');
        contextString += `${textBlocks}\n`;
      } else if (memory.data.role === 'user') {
        contextString += `User: ${memory.data.content}\n`;
      }
    });

    return contextString;
  }

  /**
   * Get issue history and related activity
   */
  async getIssueHistory(issueId: string): Promise<string> {
    const actions = await this.retrieveMemories(issueId, 'action');

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

  /**
   * Store agent delegation in memory
   */
  async trackAgentDelegation(
    issueId: string,
    mainAgentId: string,
    targetAgentType: string,
    taskDescription: string
  ): Promise<void> {
    try {
      const delegationEntry = {
        timestamp: Date.now(),
        issueId,
        mainAgentId,
        targetAgentType,
        taskDescription,
      };

      // Store in sorted set for monitoring, newest first
      await redis.zadd('memory:agent_delegations', {
        score: Date.now(),
        member: JSON.stringify(delegationEntry),
      });
      await redis.expire('memory:agent_delegations', MEMORY_EXPIRY);

      // Store in issue-specific history
      await this.storeMemory(issueId, 'action', {
        type: 'agent_delegation',
        targetAgentType,
        taskDescription,
      });

      console.log(
        `Tracked delegation to ${targetAgentType} agent for issue ${issueId}`
      );
    } catch (error) {
      console.error(`Error tracking agent delegation:`, error);
    }
  }

  /**
   * Get the most recently used repository for an issue
   */
  async getMostUsedRepository(issueId: string): Promise<string | null> {
    try {
      const repositories = await redis.zrange(
        `memory:issue:${issueId}:repositories`,
        0,
        0,
        { rev: true }
      );

      if (repositories && repositories.length > 0) {
        return repositories[0] as string;
      }

      return null;
    } catch (error) {
      console.error(`Error getting most used repository:`, error);
      return null;
    }
  }
}

export const memoryManager = new MemoryManager();
