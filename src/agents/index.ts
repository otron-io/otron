// Agents index file
// Export all agent types from this central location

import { MainAgent } from './main-agent.js';
import { DevAgent } from './dev-agent.js';
import { LinearAgent } from './linear-agent.js';

export { MainAgent, DevAgent, LinearAgent };

// Agent types for type checking
export type AgentType = 'main' | 'dev' | 'linear';
