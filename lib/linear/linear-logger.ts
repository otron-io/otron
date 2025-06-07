import { LinearClient } from '@linear/sdk';

interface OtronLogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  context?: string;
}

class LinearLogger {
  private static instance: LinearLogger;
  private linearClient?: LinearClient;
  private logCache = new Map<string, string>(); // issueId -> log comment ID

  private constructor() {}

  static getInstance(): LinearLogger {
    if (!LinearLogger.instance) {
      LinearLogger.instance = new LinearLogger();
    }
    return LinearLogger.instance;
  }

  setLinearClient(client: LinearClient) {
    this.linearClient = client;
  }

  /**
   * Log a message to a Linear issue
   */
  async logToIssue(
    issueIdOrIdentifier: string,
    message: string,
    level: 'info' | 'warn' | 'error' | 'debug' = 'info',
    context?: string
  ): Promise<void> {
    if (!this.linearClient) {
      console.warn(
        'LinearLogger: No Linear client available, skipping Linear log'
      );
      return;
    }

    try {
      // Also log to console
      const logMessage = `[Linear ${issueIdOrIdentifier}] ${message}`;
      if (context) {
        console.log(`${logMessage} (${context})`);
      } else {
        console.log(logMessage);
      }

      // Get or create the main Otron Log comment
      const logCommentId = await this.getOrCreateLogComment(
        issueIdOrIdentifier
      );

      if (!logCommentId) {
        console.error('LinearLogger: Failed to get or create log comment');
        return;
      }

      // Create the log entry
      const logEntry: OtronLogEntry = {
        timestamp: new Date().toISOString(),
        message,
        level,
        context,
      };

      // Format the log message
      const formattedMessage = this.formatLogMessage(logEntry);

      // Add as a reply to the log comment thread
      await this.linearClient.createComment({
        issueId: await this.getIssueId(issueIdOrIdentifier),
        body: formattedMessage,
        parentId: logCommentId,
      });
    } catch (error) {
      console.error('LinearLogger: Error logging to Linear issue:', error);
    }
  }

  /**
   * Log multiple messages at once
   */
  async logMultipleToIssue(
    issueIdOrIdentifier: string,
    messages: Array<{
      message: string;
      level?: 'info' | 'warn' | 'error' | 'debug';
      context?: string;
    }>
  ): Promise<void> {
    for (const { message, level = 'info', context } of messages) {
      await this.logToIssue(issueIdOrIdentifier, message, level, context);
    }
  }

  /**
   * Get or create the main "Otron Log" comment for an issue
   */
  private async getOrCreateLogComment(
    issueIdOrIdentifier: string
  ): Promise<string | null> {
    if (!this.linearClient) return null;

    try {
      // Check cache first
      if (this.logCache.has(issueIdOrIdentifier)) {
        return this.logCache.get(issueIdOrIdentifier)!;
      }

      const issue = await this.linearClient.issue(issueIdOrIdentifier);
      if (!issue) {
        console.error(`LinearLogger: Issue ${issueIdOrIdentifier} not found`);
        return null;
      }

      // Get existing comments to check for Otron Log
      const comments = await issue.comments({ first: 50 });

      // Look for existing Otron Log comment
      const existingLogComment = comments.nodes.find(
        (comment) =>
          comment.body.startsWith('🤖 **Otron Log**') && !comment.parent
      );

      if (existingLogComment) {
        this.logCache.set(issueIdOrIdentifier, existingLogComment.id);
        return existingLogComment.id;
      }

      // Create new Otron Log comment
      const logHeaderBody = `🤖 **Otron Log**

This comment thread tracks Otron's work on this issue. All activities, research, and code changes will be logged here.

---
**Started:** ${new Date().toISOString()}
**Issue:** ${issue.identifier} - ${issue.title}`;

      const newLogComment = await this.linearClient.createComment({
        issueId: issue.id,
        body: logHeaderBody,
      });

      const createdComment = await newLogComment.comment;
      if (createdComment) {
        this.logCache.set(issueIdOrIdentifier, createdComment.id);
        return createdComment.id;
      }

      return null;
    } catch (error) {
      console.error(
        'LinearLogger: Error getting or creating log comment:',
        error
      );
      return null;
    }
  }

  /**
   * Get the actual issue ID from identifier
   */
  private async getIssueId(issueIdOrIdentifier: string): Promise<string> {
    if (!this.linearClient) throw new Error('No Linear client available');

    const issue = await this.linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      throw new Error(`Issue ${issueIdOrIdentifier} not found`);
    }
    return issue.id;
  }

  /**
   * Format a log message for Linear
   */
  private formatLogMessage(entry: OtronLogEntry): string {
    const timestamp = new Date(entry.timestamp).toLocaleString();
    const levelEmoji = {
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      debug: '🔍',
    }[entry.level];

    let message = `${levelEmoji} **${timestamp}**\n${entry.message}`;

    if (entry.context) {
      message += `\n*Context: ${entry.context}*`;
    }

    return message;
  }

  /**
   * Clear the cache for an issue (useful when issue is resolved)
   */
  clearCache(issueIdOrIdentifier: string): void {
    this.logCache.delete(issueIdOrIdentifier);
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.logCache.clear();
  }
}

// Export singleton instance
export const linearLogger = LinearLogger.getInstance();

// Convenience functions for common log levels
export const logToLinearIssue = {
  info: (issueId: string, message: string, context?: string) =>
    linearLogger.logToIssue(issueId, message, 'info', context),

  warn: (issueId: string, message: string, context?: string) =>
    linearLogger.logToIssue(issueId, message, 'warn', context),

  error: (issueId: string, message: string, context?: string) =>
    linearLogger.logToIssue(issueId, message, 'error', context),

  debug: (issueId: string, message: string, context?: string) =>
    linearLogger.logToIssue(issueId, message, 'debug', context),
};
