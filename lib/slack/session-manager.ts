// Simple per-thread session manager for Slack
// Ensures only one active generation per Slack contextId (channelId:threadTs)

type SessionRecord = {
  abortController: AbortController;
  startedAt: number;
};

const activeSessions = new Map<string, SessionRecord>();

export function makeSlackContextId(channelId: string, threadTs?: string) {
  return `slack:${channelId}${threadTs ? `:${threadTs}` : ""}`;
}

// Start (or restart) a session for a given contextId. If an existing session
// is running, abort it and replace with a new controller.
export function startSlackSession(contextId: string): AbortController {
  const existing = activeSessions.get(contextId);
  if (existing) {
    try {
      existing.abortController.abort();
    } catch {}
  }
  const abortController = new AbortController();
  activeSessions.set(contextId, { abortController, startedAt: Date.now() });
  return abortController;
}

// End a session only if the provided controller matches the current one
export function endSlackSession(
  contextId: string,
  controller: AbortController
) {
  const current = activeSessions.get(contextId);
  if (current && current.abortController === controller) {
    activeSessions.delete(contextId);
  }
}

export function isSlackSessionActive(contextId: string): boolean {
  return activeSessions.has(contextId);
}

// Abort an active session for a given contextId, if present.
// Returns true if a session was found (and abort was signaled), false otherwise.
export function abortSlackSession(contextId: string): boolean {
  const current = activeSessions.get(contextId);
  if (!current) return false;
  try {
    current.abortController.abort();
  } catch {}
  return true;
}
