import { LinearClient } from "@linear/sdk";
import fetch from "node-fetch";

type AccessTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export class LinearService {
  private client: LinearClient | null = null;
  private accessToken: string | null = null;
  private appUserId: string | null = null;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string,
  ) {}

  public getAuthUrl(): string {
    return `https://linear.app/oauth/authorize?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(
      this.redirectUri,
    )}&response_type=code&scope=read,write,issues:create,comments:create&actor=app&prompt=consent&app:assignable=true&app:mentionable=true`;
  }

  public async getAccessToken(code: string): Promise<string> {
    const response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.statusText}`);
    }

    const data = (await response.json()) as AccessTokenResponse;
    this.accessToken = data.access_token;

    // Initialize the client with the access token
    this.client = new LinearClient({ accessToken: this.accessToken });

    // Get the app user ID
    await this.fetchAppUserId();

    return this.accessToken;
  }

  private async fetchAppUserId(): Promise<string> {
    if (!this.client) {
      throw new Error("Linear client not initialized");
    }

    const viewer = await this.client.viewer;
    this.appUserId = viewer.id;
    return this.appUserId;
  }

  public async respondToMention(issueId: string): Promise<void> {
    if (!this.client || !this.appUserId) {
      throw new Error("Linear client not initialized or app user ID not set");
    }

    await this.client.createComment({
      issueId,
      body: "hello, world",
    });
  }

  public async addReaction(
    commentId: string,
    emoji: string = "👋",
  ): Promise<void> {
    if (!this.client) {
      throw new Error("Linear client not initialized");
    }

    await this.client.createReaction({
      commentId,
      emoji,
    });
  }

  public async respondToComment(commentId: string): Promise<void> {
    if (!this.client) {
      throw new Error("Linear client not initialized");
    }

    // First get the comment details to get the issue ID
    const comment = await this.client.comment(commentId);
    if (!comment) {
      throw new Error("Comment not found");
    }

    const issue = await comment.issue;
    if (!issue) {
      throw new Error("Issue not found for comment");
    }

    await this.client.createComment({
      issueId: issue.id,
      body: "hello, world",
    });
  }
}
