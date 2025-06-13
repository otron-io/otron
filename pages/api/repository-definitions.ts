import type { NextApiRequest, NextApiResponse } from 'next';
import {
  saveRepositoryDefinition,
  getRepositoryDefinition,
  listRepositoryDefinitions,
  RepositoryDefinition,
} from '../../lib/repository/definitions';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req;
  switch (method) {
    case 'GET': {
      const { id } = req.query;
      if (id && typeof id === 'string') {
        const def = await getRepositoryDefinition(id);
        if (!def) return res.status(404).json({ error: 'Not found' });
        return res.json(def);
      }
      const list = await listRepositoryDefinitions();
      return res.json(list);
    }
    case 'POST': {
      const body = req.body as RepositoryDefinition;
      if (!body?.id) return res.status(400).json({ error: 'id required' });
      await saveRepositoryDefinition(body);
      return res.status(201).json({ ok: true });
    }
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).end(`Method ${method} Not Allowed`);
  }
}
