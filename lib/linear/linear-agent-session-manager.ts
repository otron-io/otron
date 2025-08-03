import type { LinearClient } from "@linear/sdk";

/**
 * Agent Activity Types as defined by Linear Agents SDK
 */
export interface AgentActivityContent {
  type: "thought" | "elicitation" | "action" | "response" | "error";
}

export interface ThoughtActivity extends AgentActivityContent {
  type: "thought";
  body: string;
}

export interface ElicitationActivity extends AgentActivityContent {
  type: "elicitation";
  body: string;
}

export interface ActionActivity extends AgentActivityContent {
  type: "action";
  action: string;
  parameter: string;
  result?: string;
}

export interface ResponseActivity extends AgentActivityContent {
  type: "response";
  body: string;
}

export interface ErrorActivity extends AgentActivityContent {
  type: "error";
  body: string;
}

export type ActivityContent =
  | ThoughtActivity
  | ElicitationActivity
  | ActionActivity
  | ResponseActivity
  | ErrorActivity;

/**
 * Agent Session States as defined by Linear Agents SDK
 */
export type AgentSessionState =
  | "pending"
  | "active"
  | "error"
  | "awaitingInput"
  | "complete";

/**
 * Interface for agent session data
 */
export interface AgentSessionData {
  sessionId: string;
  issueId: string;
  state: AgentSessionState;
  activities: ActivityContent[];
  startTime: number;
  lastActivity?: number;
}

/**
 * Linear Agent Session Manager
 * Replaces LinearLogger with proper Agent Sessions and Activities using Linear's new Agents SDK
 */
class LinearAgentSessionManager {
  private static instance: LinearAgentSessionManager;
  private linearClient?: LinearClient;
  private activeSessions = new Map<string, AgentSessionData>();

  private constructor() {}

  static getInstance(): LinearAgentSessionManager {
    if (!LinearAgentSessionManager.instance) {
      LinearAgentSessionManager.instance = new LinearAgentSessionManager();
    }
    return LinearAgentSessionManager.instance;
  }

  setLinearClient(client: LinearClient) {
    this.linearClient = client;
  }

  /**
   * Create or get an existing agent session for an issue
   */
  async getOrCreateSession(
    issueIdOrIdentifier: string,
  ): Promise<string | null> {
    if (!this.linearClient) {
      console.warn("LinearAgentSessionManager: No Linear client available");
      return null;
    }

    try {
      // Get the actual issue ID
      const issue = await this.linearClient.issue(issueIdOrIdentifier);
      if (!issue) {
        console.error(
          `LinearAgentSessionManager: Issue ${issueIdOrIdentifier} not found`,
        );
        return null;
      }

      // Check if we already have an active session for this issue
      const existingSession = Array.from(this.activeSessions.values()).find(
        (session) =>
          session.issueId === issue.id && session.state !== "complete",
      );

      if (existingSession) {
        return existingSession.sessionId;
      }

      // Note: In a real implementation, you would create the session via Linear's API
      // For now, we'll create a local session and assume Linear will create the actual session
      // when the first activity is emitted
      const sessionId = `session-${issue.id}-${Date.now()}`;

      const sessionData: AgentSessionData = {
        sessionId,
        issueId: issue.id,
        state: "pending",
        activities: [],
        startTime: Date.now(),
      };

      this.activeSessions.set(sessionId, sessionData);

      return sessionId;
    } catch (error) {
      console.error(
        "LinearAgentSessionManager: Error creating session:",
        error,
      );
      return null;
    }
  }

  /**
   * Emit a thought activity
   */
  async emitThought(sessionId: string, message: string): Promise<void> {
    const activity: ThoughtActivity = {
      type: "thought",
      body: message,
    };

    await this.emitActivity(sessionId, activity);
  }

  /**
   * Emit an elicitation activity (request for user input)
   */
  async emitElicitation(sessionId: string, message: string): Promise<void> {
    const activity: ElicitationActivity = {
      type: "elicitation",
      body: message,
    };

    await this.emitActivity(sessionId, activity);
  }

  /**
   * Emit an action activity (tool invocation)
   */
  async emitAction(
    sessionId: string,
    action: string,
    parameter: string,
    result?: string,
  ): Promise<void> {
    const activity: ActionActivity = {
      type: "action",
      action,
      parameter,
      result,
    };

    await this.emitActivity(sessionId, activity);
  }

  /**
   * Emit a response activity (final result)
   */
  async emitResponse(sessionId: string, message: string): Promise<void> {
    const activity: ResponseActivity = {
      type: "response",
      body: message,
    };

    await this.emitActivity(sessionId, activity);
  }

  /**
   * Emit an error activity
   */
  async emitError(sessionId: string, message: string): Promise<void> {
    const activity: ErrorActivity = {
      type: "error",
      body: message,
    };

    await this.emitActivity(sessionId, activity);
  }

  /**
   * Generic method to emit any activity to Linear
   */
  private async emitActivity(
    sessionId: string,
    content: ActivityContent,
  ): Promise<void> {
    if (!this.linearClient) {
      console.warn(
        "LinearAgentSessionManager: No Linear client available, skipping activity",
      );
      return;
    }

    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        console.error(
          `LinearAgentSessionManager: Session ${sessionId} not found`,
        );
        return;
      }

      // Update local session
      session.activities.push(content);
      session.lastActivity = Date.now();

      // Update session state based on activity type
      if (content.type === "error") {
        session.state = "error";
      } else if (content.type === "elicitation") {
        session.state = "awaitingInput";
      } else if (content.type === "response") {
        session.state = "complete";
      } else {
        session.state = "active";
      }

      // Log to console for debugging
      const logMessage = this.formatActivityForConsole(
        content,
        session.issueId,
      );
      console.log(logMessage);

      // Emit to Linear using the Agents SDK
      try {
        // Try to use the new createAgentActivity method if available
        if ("createAgentActivity" in this.linearClient) {
          await (this.linearClient as any).createAgentActivity({
            agentSessionId: sessionId,
            content: content,
          });
        } else {
          // Fallback to GraphQL mutation if the SDK method doesn't exist yet
          const mutation = `
            mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
              agentActivityCreate(input: $input) {
                success
                agentActivity {
                  id
                }
              }
            }
          `;

          const variables = {
            input: {
              agentSessionId: sessionId,
              content: content,
            },
          };

          const response = await (this.linearClient as any).client.request(
            mutation,
            variables,
          );

          if (!response.agentActivityCreate?.success) {
            throw new Error("Failed to create agent activity via GraphQL");
          }
        }
      } catch (linearError) {
        // If we can't emit to Linear, log the error and fail
        console.error(
          "LinearAgentSessionManager: Failed to emit activity to Linear:",
          linearError,
        );
        throw linearError;
      }
    } catch (error) {
      console.error(
        "LinearAgentSessionManager: Error emitting activity:",
        error,
      );
    }
  }

  /**
   * Register an existing session ID (from webhook) with issue mapping
   */
  registerExistingSession(sessionId: string, issueId: string): void {
    const sessionData: AgentSessionData = {
      sessionId,
      issueId,
      state: "pending",
      activities: [],
      startTime: Date.now(),
    };

    this.activeSessions.set(sessionId, sessionData);
  }

  /**
   * Format activity for console logging
   */
  private formatActivityForConsole(
    content: ActivityContent,
    issueId: string,
  ): string {
    const timestamp = new Date().toLocaleString();
    const prefix = `[Linear Agent ${issueId}]`;

    switch (content.type) {
      case "thought":
        return `${prefix} THOUGHT: ${content.body}`;
      case "elicitation":
        return `${prefix} ELICITATION: ${content.body}`;
      case "action": {
        const result = content.result ? ` → ${content.result}` : "";
        return `${prefix} ACTION: ${content.action}(${content.parameter})${result}`;
      }
      case "response":
        return `${prefix} RESPONSE: ${content.body}`;
      case "error":
        return `${prefix} ERROR: ${content.body}`;
      default:
        return `${prefix} ACTIVITY: ${JSON.stringify(content)}`;
    }
  }

  /**
   * Complete a session
   */
  async completeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.state = "complete";
      // Optionally remove from active sessions after some time
      setTimeout(
        () => {
          this.activeSessions.delete(sessionId);
        },
        30 * 60 * 1000,
      ); // Remove after 30 minutes
    }
  }

  /**
   * Get session data
   */
  getSession(sessionId: string): AgentSessionData | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Clear all sessions (for cleanup)
   */
  clearAllSessions(): void {
    this.activeSessions.clear();
  }
}

// Export singleton instance
export const linearAgentSessionManager =
  LinearAgentSessionManager.getInstance();

// Helper function to parse action messages into action/parameter format
const parseActionMessage = (
  message: string,
): { action: string; parameter: string } => {
  // Look for patterns like "toolName: details" or "doing something..."
  const colonMatch = message.match(/^([^:]+):\s*(.+)$/);
  if (colonMatch) {
    return { action: colonMatch[1].trim(), parameter: colonMatch[2].trim() };
  }

  // Look for patterns like "getting something..." or "searching for..."
  const verbMatch = message.match(
    /^(getting|searching|reading|creating|updating|deleting|analyzing|processing)\s+(.+)$/i,
  );
  if (verbMatch) {
    return { action: verbMatch[1], parameter: verbMatch[2] };
  }

  // Default: treat whole message as action with empty parameter
  return { action: message, parameter: "" };
};

// Convenience functions that replace the old logToLinearIssue functions
export const agentActivity = {
  thought: async (issueIdOrIdentifier: string, message: string) => {
    const sessionId =
      await linearAgentSessionManager.getOrCreateSession(issueIdOrIdentifier);
    if (sessionId) {
      // Convert thought to action for better Linear display
      const { action, parameter } = parseActionMessage(message);
      await linearAgentSessionManager.emitAction(sessionId, action, parameter);
    }
  },

  elicitation: async (issueIdOrIdentifier: string, message: string) => {
    const sessionId =
      await linearAgentSessionManager.getOrCreateSession(issueIdOrIdentifier);
    if (sessionId) {
      await linearAgentSessionManager.emitElicitation(sessionId, message);
    }
  },

  action: async (
    issueIdOrIdentifier: string,
    action: string,
    parameter: string,
    result?: string,
  ) => {
    const sessionId =
      await linearAgentSessionManager.getOrCreateSession(issueIdOrIdentifier);
    if (sessionId) {
      await linearAgentSessionManager.emitAction(
        sessionId,
        action,
        parameter,
        result,
      );
    }
  },

  response: async (issueIdOrIdentifier: string, message: string) => {
    const sessionId =
      await linearAgentSessionManager.getOrCreateSession(issueIdOrIdentifier);
    if (sessionId) {
      await linearAgentSessionManager.emitResponse(sessionId, message);
    }
  },

  error: async (issueIdOrIdentifier: string, message: string) => {
    const sessionId =
      await linearAgentSessionManager.getOrCreateSession(issueIdOrIdentifier);
    if (sessionId) {
      // Convert error to action for consistency
      await linearAgentSessionManager.emitAction(
        sessionId,
        "❌ Error",
        message,
      );
    }
  },
};

// Direct session ID functions for webhook handlers that already have the session ID
export const agentActivityDirect = {
  thought: async (sessionId: string, message: string) => {
    // Convert thought to action for better Linear display
    const { action, parameter } = parseActionMessage(message);
    await linearAgentSessionManager.emitAction(sessionId, action, parameter);
  },

  elicitation: async (sessionId: string, message: string) => {
    await linearAgentSessionManager.emitElicitation(sessionId, message);
  },

  action: async (
    sessionId: string,
    action: string,
    parameter: string,
    result?: string,
  ) => {
    await linearAgentSessionManager.emitAction(
      sessionId,
      action,
      parameter,
      result,
    );
  },

  response: async (sessionId: string, message: string) => {
    await linearAgentSessionManager.emitResponse(sessionId, message);
  },

  error: async (sessionId: string, message: string) => {
    // Convert error to action for consistency
    await linearAgentSessionManager.emitAction(sessionId, "❌ Error", message);
  },
};

// Backwards compatibility functions that map to agent activities
export const logToLinearIssue = {
  info: (issueId: string, message: string, context?: string) =>
    agentActivity.thought(
      issueId,
      context ? `${message} (${context})` : message,
    ),

  warn: (issueId: string, message: string, context?: string) =>
    agentActivity.thought(
      issueId,
      `⚠️ ${context ? `${message} (${context})` : message}`,
    ),

  error: (issueId: string, message: string, context?: string) =>
    agentActivity.error(issueId, context ? `${message} (${context})` : message),

  debug: (issueId: string, message: string, context?: string) =>
    agentActivity.thought(
      issueId,
      `🔍 ${context ? `${message} (${context})` : message}`,
    ),
};
