import type { CoreMessage } from "ai";

// Interface for queued messages during agent processing
export interface QueuedMessage {
  timestamp: number;
  type: "created" | "prompted" | "stop";
  content: string;
  sessionId: string;
  issueId: string;
  userId?: string;
  metadata?: any;
}

// Interface for tracking active sessions
export interface ActiveSession {
  sessionId: string;
  contextId: string;
  startTime: number;
  platform: "slack" | "linear" | "github" | "general";
  status: "initializing" | "planning" | "gathering" | "acting" | "completing";
  currentTool?: string;
  toolsUsed: string[];
  actionsPerformed: string[];
  messages: CoreMessage[];
  metadata?: {
    issueId?: string;
    channelId?: string;
    threadTs?: string;
    userId?: string;
  };
}

// Repository definition interface
export interface RepoDefinition {
  id: string;
  name: string;
  description: string;
  purpose: string;
  githubUrl: string;
  owner: string;
  repo: string;
  isActive: boolean;
  tags: string[];
  contextDescription: string;
  createdAt: number;
  updatedAt: number;
}

// Response generation result interface
export interface GenerationResult {
  text: string;
  toolsUsed: string[];
  actionsPerformed: string[];
  endedExplicitly: boolean;
}

// Execution tracking interface
export interface ExecutionTracker {
  toolsUsed: Set<string>;
  actionsPerformed: string[];
  endedExplicitly: boolean;
  recentToolCalls: string[];
}

// Execution strategy tracking interface
export interface ExecutionStrategy {
  phase: "planning" | "gathering" | "acting" | "completing";
  toolUsageCounts: Map<string, number>;
  searchOperations: number;
  readOperations: number;
  analysisOperations: number;
  actionOperations: number;
  hasStartedActions: boolean;
  shouldForceAction: boolean;
}

// Context extraction parameters
export interface SlackContext {
  channelId: string;
  threadTs?: string;
}

// Generate response parameters
export interface GenerateResponseParams {
  messages: CoreMessage[];
  updateStatus?: (status: string) => void;
  linearClient?: any; // LinearClient type
  slackContext?: SlackContext;
  abortSignal?: AbortSignal;
  agentSessionId?: string;
}
