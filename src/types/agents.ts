export type AgentType = 'dev' | 'linear' | 'main';

export interface AgentStatus {
  id: string;
  type: AgentType;
  status: 'active' | 'busy' | 'error' | 'offline';
  currentTask?: string;
  lastActive: Date;
  metrics: {
    tasksCompleted: number;
    averageResponseTime: number;
    errorRate: number;
  };
}

export interface Task {
  id: string;
  type: string;
  source: string;
  priority: number;
  payload: any;
  assignedAgent?: string;
  status: 'pending' | 'inProgress' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookPayload {
  source: string;
  event: string;
  data: any;
}

export interface MemoryUpdate {
  agentId: string;
  key: string;
  value: any;
  timestamp: Date;
}
