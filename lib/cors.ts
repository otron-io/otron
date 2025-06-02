import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from './env.js';

/**
 * Add CORS headers to allow cross-origin requests
 */
export function addCorsHeaders(req: VercelRequest, res: VercelResponse) {
  // Allow requests from the marketing site and development environments
  const allowedOrigins = [
    env.FRONTEND_URL || ['https://otron.io', 'https://www.otron.io'],
  ];

  const origin = req.headers.origin;
  let allowOrigin = false;

  if (origin) {
    // Check exact matches first
    if (
      allowedOrigins.some(
        (allowed) => typeof allowed === 'string' && allowed === origin
      )
    ) {
      allowOrigin = true;
    }

    // Check regex patterns
    if (!allowOrigin) {
      allowOrigin = allowedOrigins.some(
        (allowed) => allowed instanceof RegExp && allowed.test(origin)
      );
    }
  }

  if (allowOrigin && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Allow any origin for now during development (you can restrict this in production)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Internal-Token'
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // Indicates that this was a preflight request
  }

  return false; // Not a preflight request
}

/**
 * Middleware wrapper to add CORS headers to any handler
 */
export function withCORS(handler: Function) {
  return async (req: VercelRequest, res: VercelResponse) => {
    // Add CORS headers
    const isPreflight = addCorsHeaders(req, res);

    // If it was a preflight request, we already handled it
    if (isPreflight) {
      return;
    }

    // Continue to the actual handler
    return handler(req, res);
  };
}
