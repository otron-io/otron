import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../lib/core/env.js';
import { withCORS } from '../lib/core/cors.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

/**
 * Health check API endpoint
 * Returns system health status including database connectivity
 */
async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const healthData = {
    status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
    uptime: process.uptime(),
    version: '0.0.1',
    environment: process.env.NODE_ENV || 'development',
    checks: {} as Record<string, { status: string; message: string }>,
  };

  try {
    // Test Redis connectivity
    const redisTestKey = 'health:test';
    const testValue = Date.now().toString();

    console.log('Redis health check - setting value:', testValue);
    await redis.set(redisTestKey, testValue, { ex: 10 }); // Expire in 10 seconds

    const retrievedValue = await redis.get(redisTestKey);
    console.log(
      'Redis health check - retrieved value:',
      retrievedValue,
      'type:',
      typeof retrievedValue
    );
    console.log(
      'Redis health check - comparison:',
      retrievedValue === testValue,
      retrievedValue,
      '===',
      testValue
    );

    // More robust comparison - handle string/number type mismatches
    const valuesMatch = String(retrievedValue) === String(testValue);

    if (valuesMatch && retrievedValue !== null) {
      healthData.checks.database = {
        status: 'healthy',
        message: 'Redis connection successful',
      };
    } else {
      healthData.checks.database = {
        status: 'unhealthy',
        message: `Redis read/write test failed. Set: ${testValue}, Got: ${retrievedValue}`,
      };
      healthData.status = 'degraded';
    }
  } catch (error) {
    console.error('Redis health check error:', error);
    healthData.checks.database = {
      status: 'unhealthy',
      message: `Redis connection failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
    healthData.status = 'unhealthy';
  }

  // Check environment variables
  const requiredEnvVars = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'INTERNAL_API_TOKEN',
  ];

  const missingEnvVars = requiredEnvVars.filter(
    (envVar) => !process.env[envVar]
  );

  if (missingEnvVars.length === 0) {
    healthData.checks.environment = {
      status: 'healthy',
      message: 'All required environment variables are set',
    };
  } else {
    healthData.checks.environment = {
      status: 'degraded',
      message: `Missing environment variables: ${missingEnvVars.join(', ')}`,
    };
    if (healthData.status === 'healthy') {
      healthData.status = 'degraded';
    }
  }

  // Check integrations (these are optional, so don't fail the health check)
  healthData.checks.linear = {
    status: env.LINEAR_CLIENT_ID ? 'healthy' : 'degraded',
    message: env.LINEAR_CLIENT_ID
      ? 'Linear configured'
      : 'Linear not configured',
  };

  healthData.checks.github = {
    status: env.GITHUB_APP_ID ? 'healthy' : 'degraded',
    message: env.GITHUB_APP_ID ? 'GitHub configured' : 'GitHub not configured',
  };

  healthData.checks.slack = {
    status: process.env.SLACK_BOT_TOKEN ? 'healthy' : 'degraded',
    message: process.env.SLACK_BOT_TOKEN
      ? 'Slack configured'
      : 'Slack not configured',
  };

  return res.status(200).json(healthData);
}

// Export with CORS protection
export default withCORS(handler);
