import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { addCorsHeaders } from './cors.js';
import { env } from './env.js';

/**
 * Middleware to protect routes with a simple password
 */
export function withPasswordProtection(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void>
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    // Get auth header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic');
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Decode the base64 auth header
    const credentials = Buffer.from(
      authHeader.split(' ')[1],
      'base64'
    ).toString('utf-8');
    const [username, password] = credentials.split(':');

    // Check if password matches
    if (password !== env.ADMIN_PASSWORD) {
      res.setHeader('WWW-Authenticate', 'Basic');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Authorized - proceed to handler
    return handler(req, res);
  };
}

/**
 * Middleware to protect API routes that should only be accessible from the app
 */
export function withInternalAccess(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void>
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    // Add CORS headers for cross-origin requests
    const isPreflight = addCorsHeaders(req, res);

    // If it was a preflight request, we already handled it
    if (isPreflight) {
      return;
    }

    // Check for the internal access token
    const token = req.headers['x-internal-token'] || req.query.token;

    // Simple internal token - app will include this token when making API requests
    if (token !== env.INTERNAL_API_TOKEN) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Internal API access only' });
    }

    // Authorized - proceed to handler
    return handler(req, res);
  };
}

/**
 * Verify Linear webhook signature
 */
export function verifyLinearWebhook(signature: string, body: string): boolean {
  try {
    const hmac = createHmac('sha256', env.WEBHOOK_SIGNING_SECRET);
    const digest = hmac.update(body).digest('hex');
    return signature === digest;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}
