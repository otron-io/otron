import type { ExecutionStrategy, ExecutionTracker } from "../core/types.js";

/**
 * Create a new execution tracker instance
 */
export function createExecutionTracker(): ExecutionTracker {
  return {
    toolsUsed: new Set<string>(),
    actionsPerformed: [],
    endedExplicitly: false,
    recentToolCalls: [],
  };
}

/**
 * Create a new execution strategy instance
 */
export function createExecutionStrategy(): ExecutionStrategy {
  return {
    phase: "planning",
    toolUsageCounts: new Map<string, number>(),
    searchOperations: 0,
    readOperations: 0,
    analysisOperations: 0,
    actionOperations: 0,
    hasStartedActions: false,
    shouldForceAction: false,
  };
}

/**
 * Get execution summary for logging
 */
export function getExecutionSummary(
  tracker: ExecutionTracker,
  strategy: ExecutionStrategy,
): string {
  const totalOperations =
    strategy.searchOperations +
    strategy.readOperations +
    strategy.analysisOperations +
    strategy.actionOperations;

  return [
    `Phase: ${strategy.phase}`,
    `Total operations: ${totalOperations}`,
    `Tools used: ${tracker.toolsUsed.size}`,
    `Actions performed: ${tracker.actionsPerformed.length}`,
    `Search: ${strategy.searchOperations}`,
    `Read: ${strategy.readOperations}`,
    `Analysis: ${strategy.analysisOperations}`,
    `Action: ${strategy.actionOperations}`,
  ].join(" | ");
}
