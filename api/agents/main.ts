import { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';

// Initialize Redis client
const redis = new Redis(process.env.REDIS_URL!);

// JWT secret key from environment variable
const JWT_SECRET = process.env.JWT_SECRET!;

// Verify JWT token middleware
const verifyToken = (token: string): boolean => {
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch (error) {
    return false;
  }
};

// Generate JWT token for inter-agent communication
export const generateAgentToken = (): string => {
  return jwt.sign({ type: 'agent' }, JWT_SECRET, { expiresIn: '1h' });
};

// Main orchestrator endpoint handler
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify authentication
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    switch (req.method) {
      case 'GET':
        // Health check
        return res.status(200).json({ status: 'healthy' });

      case 'POST':
        // Handle agent orchestration
        const { action, data } = req.body;
        
        // Store data in Redis with TTL
        if (action === 'store') {
          await redis.setex(`memory:${data.key}`, 3600, JSON.stringify(data.value));
          return res.status(200).json({ success: true });
        }

        // Retrieve data from Redis
        if (action === 'retrieve') {
          const value = await redis.get(`memory:${data.key}`);
          return res.status(200).json({ value: value ? JSON.parse(value) : null });
        }

        return res.status(400).json({ error: 'Invalid action' });

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in main agent handler:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
