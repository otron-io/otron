import { LinearClient } from '@linear/sdk';
import { env } from '../env.js';

/**
 * Creates a Linear client with proper authentication
 */
export function createLinearClient(): LinearClient {
  // Use the client ID and secret from env variables
  if (!env.LINEAR_CLIENT_ID || !env.LINEAR_CLIENT_SECRET) {
    throw new Error(
      'LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET environment variables are required'
    );
  }

  // Create client with OAuth credentials
  return new LinearClient({
    apiKey: env.LINEAR_CLIENT_SECRET,
  });
}
