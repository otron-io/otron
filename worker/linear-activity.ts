import { getLinearAccessToken } from "./linear-auth.js";

/**
 * Post agent activity directly to a Linear agent session using the GraphQL API.
 * Reads the Linear access token from Redis (same OAuth token the Vercel side uses).
 */

const LINEAR_API = "https://api.linear.app/graphql";

let cachedToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_CACHE_MS = 5 * 60 * 1000; // Refresh from Redis every 5 min

async function getToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && now - tokenFetchedAt < TOKEN_CACHE_MS) return cachedToken;

  cachedToken = await getLinearAccessToken();
  tokenFetchedAt = now;
  return cachedToken;
}

async function graphql(query: string, variables: Record<string, unknown>) {
  const token = await getToken();
  if (!token) return null;

  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Linear GraphQL error (${res.status}):`, text);
    return null;
  }

  return res.json();
}

const CREATE_ACTIVITY = `
  mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
      agentActivity { id }
    }
  }
`;

export async function emitThought(sessionId: string, body: string) {
  await graphql(CREATE_ACTIVITY, {
    input: {
      agentSessionId: sessionId,
      content: { type: "action", action: body, parameter: "" },
    },
  });
}

export async function emitAction(
  sessionId: string,
  action: string,
  parameter: string,
  result?: string
) {
  await graphql(CREATE_ACTIVITY, {
    input: {
      agentSessionId: sessionId,
      content: {
        type: "action",
        action,
        parameter,
        ...(result ? { result } : {}),
      },
    },
  });
}

export async function emitResponse(sessionId: string, body: string) {
  await graphql(CREATE_ACTIVITY, {
    input: {
      agentSessionId: sessionId,
      content: { type: "response", body },
    },
  });
}

export async function emitError(sessionId: string, body: string) {
  await graphql(CREATE_ACTIVITY, {
    input: {
      agentSessionId: sessionId,
      content: { type: "error", body },
    },
  });
}

/**
 * Complete the Linear agent session.
 */
export async function completeSession(sessionId: string) {
  await emitResponse(sessionId, "Claude Code worker finished.");
}
