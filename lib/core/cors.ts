import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from './env.js';

/**
 * Add CORS headers to allow cross-origin requests
 */
export function addCorsHeaders(req: VercelRequest, res: VercelResponse) {
  // Allow requests from the marketing site and development environments
  const allowedOrigins = [
    // Development environments
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4173',
    'https://localhost:5173',
    'https://localhost:3000',
    'https://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4173',

    // Production domains
    'https://otron.io',
    'https://www.otron.io',
  ];

  // Add the frontend URL from environment variable if it exists
  if (env.FRONTEND_URL) {
    allowedOrigins.push(env.FRONTEND_URL);
  }

  // Also allow common Vercel deployment patterns for the marketing site
  const vercelPatterns = [
    /^https:\/\/.*-marketing.*\.vercel\.app$/,
    /^https:\/\/marketing.*\.vercel\.app$/,
    /^https:\/\/.*\.vercel\.app$/,
  ];

  const origin = req.headers.origin;

  // Debug logging
  console.log('CORS Debug:', {
    origin,
    allowedOrigins,
    frontendUrl: env.FRONTEND_URL,
    nodeEnv: process.env.NODE_ENV,
  });

  // Check if origin is allowed
  let isAllowed = false;

  if (origin) {
    // Check exact string matches
    if (allowedOrigins.includes(origin)) {
      isAllowed = true;
      console.log('Origin allowed by exact match:', origin);
    } else {
      // Check regex patterns for Vercel deployments
      isAllowed = vercelPatterns.some((pattern) => pattern.test(origin));
      if (isAllowed) {
        console.log('Origin allowed by regex pattern:', origin);
      }
    }
  }

  if (isAllowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // For development, be more permissive
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      console.log('Using permissive CORS for development');
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      console.log('Origin not allowed, using fallback:', origin);
      res.setHeader('Access-Control-Allow-Origin', 'https://otron.io');
    }
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
