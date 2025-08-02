// Main response generation export
export { generateResponse } from './core/response-generator.js';

// Re-export session management functions for backward compatibility
export {
  generateSessionId,
  storeActiveSession,
  updateActiveSession,
  removeActiveSession,
  getActiveSessionForIssue,
} from './session/session-manager.js';

// Re-export message queue functions for backward compatibility
export {
  queueMessageForSession,
  getQueuedMessages,
} from './session/message-queue.js';

// Export types
export type {
  QueuedMessage,
  ActiveSession,
  RepoDefinition,
  GenerationResult,
  ExecutionTracker,
  ExecutionStrategy,
  SlackContext,
  GenerateResponseParams,
} from './core/types.js';

// Export utility functions
export {
  createExecutionTracker,
  createExecutionStrategy,
  getExecutionSummary,
} from './utils/execution-tracker.js';

export { createCleanupFunction } from './utils/cleanup.js';

// Export context functions
export {
  extractIssueIdFromContext,
  determinePlatform,
} from './context/context-extractor.js';

export { getRepositoryContext } from './context/repository-context.js';
