import { AgentStatus, AgentType, MemoryUpdate, Task, WebhookPayload } from '../types/agents';

export class MainOrchestrator {
  private agentStatuses: Map<string, AgentStatus> = new Map();
  private taskQueue: Task[] = [];
  private readonly redisClient: any; // TODO: Add proper Redis client type

  constructor(redisClient: any) {
    this.redisClient = redisClient;
  }

  async handleWebhook(source: string, payload: WebhookPayload): Promise<void> {
    try {
      // Create a task from the webhook
      const task: Task = {
        id: `task-${Date.now()}`,
        type: payload.event,
        source,
        priority: this.calculateTaskPriority(payload),
        payload: payload.data,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Determine optimal agent for the task
      const targetAgent = await this.determineOptimalAgent(task);
      if (targetAgent) {
        await this.delegateTask(task, targetAgent);
      } else {
        this.taskQueue.push(task);
      }
    } catch (error) {
      console.error('Error handling webhook:', error);
      throw error;
    }
  }

  async delegateTask(task: Task, targetAgent: AgentType): Promise<void> {
    try {
      // Update task status
      task.status = 'inProgress';
      task.assignedAgent = targetAgent;
      task.updatedAt = new Date();

      // Store task assignment in Redis
      await this.redisClient.hSet(
        `task:${task.id}`,
        {
          ...task,
          updatedAt: task.updatedAt.toISOString()
        }
      );

      // Update agent status
      const agentStatus = this.agentStatuses.get(targetAgent);
      if (agentStatus) {
        agentStatus.status = 'busy';
        agentStatus.currentTask = task.id;
        agentStatus.lastActive = new Date();
        this.agentStatuses.set(targetAgent, agentStatus);
      }

      // TODO: Implement actual agent invocation logic
      console.log(`Delegating task ${task.id} to agent ${targetAgent}`);
    } catch (error) {
      console.error('Error delegating task:', error);
      throw error;
    }
  }

  async getAgentStatus(agentId: string): Promise<AgentStatus | null> {
    return this.agentStatuses.get(agentId) || null;
  }

  async updateSharedMemory(memoryUpdate: MemoryUpdate): Promise<void> {
    try {
      await this.redisClient.hSet(
        `memory:${memoryUpdate.agentId}`,
        memoryUpdate.key,
        JSON.stringify({
          value: memoryUpdate.value,
          timestamp: memoryUpdate.timestamp.toISOString()
        })
      );
    } catch (error) {
      console.error('Error updating shared memory:', error);
      throw error;
    }
  }

  private calculateTaskPriority(payload: WebhookPayload): number {
    // TODO: Implement sophisticated priority calculation based on:
    // - Event type
    // - Source importance
    // - Content analysis
    // - Time sensitivity
    return 3; // Default medium priority
  }

  private async determineOptimalAgent(task: Task): Promise<AgentType | null> {
    // Simple initial implementation
    // TODO: Enhance with more sophisticated agent selection logic
    const availableAgents = Array.from(this.agentStatuses.entries())
      .filter(([_, status]) => status.status === 'active')
      .map(([id]) => id as AgentType);

    if (availableAgents.length === 0) return null;

    // Basic task type to agent mapping
    if (task.source === 'github') return 'dev';
    if (task.source === 'linear') return 'linear';

    return availableAgents[0];
  }
}
