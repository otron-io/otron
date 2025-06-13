import Redis from 'ioredis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  password: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface RepositoryDefinition {
  id: string; // repository full name e.g. "otron-io/otron"
  embeddingStatus: 'pending' | 'in-progress' | 'completed' | 'failed';
  lastIndexedAt?: number;
  branch?: string;
}

const KEY_PREFIX = 'repo:def:';

function key(id: string) {
  return `${KEY_PREFIX}${id}`;
}

export async function saveRepositoryDefinition(def: RepositoryDefinition) {
  await redis.set(key(def.id), JSON.stringify(def));
}

export async function getRepositoryDefinition(id: string): Promise<RepositoryDefinition | null> {
  const raw = await redis.get(key(id));
  return raw ? (JSON.parse(raw) as RepositoryDefinition) : null;
}

export async function listRepositoryDefinitions(): Promise<RepositoryDefinition[]> {
  const keys = await redis.keys(`${KEY_PREFIX}*`);
  if (!keys.length) return [];
  const values = await redis.mget(...keys);
  return values.filter(Boolean).map((v) => JSON.parse(v!));
}
