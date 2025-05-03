import { LinearClient } from '@linear/sdk';

export class LinearService {
  private linearClient: LinearClient;

  constructor(apiKey: string) {
    this.linearClient = new LinearClient({ apiKey });
  }

  async getIssue(issueId: string): Promise<LinearIssue | null> {
    try {
      const response = await this.linearClient.issue(issueId);
      return response;
    } catch (error) {
      console.error(`Error fetching issue ${issueId}:`, error);
      return null;
    }
  }

  // ... existing methods ...
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  state: {
    name: string;
  };
  priority: number;
  labels: {
    nodes: {
      id: string;
      name: string;
    }[];
  };
  assignee: {
    id: string;
    name: string;
    email: string;
  } | null;
}