import { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';

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

// Development agent endpoint handler
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
        // Handle development tasks
        const { action, data } = req.body;
        
        // Implement development agent specific logic here
        return res.status(200).json({ success: true });

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in dev agent handler:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
