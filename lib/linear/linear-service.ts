/**
 * Linear OAuth service for handling authentication flow
 * Updated to support Linear Agents SDK with actor=app authentication
 */
export class LinearService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  /**
   * Generate the Linear OAuth authorization URL for agent installation
   * Uses actor=app for agent authentication with mentionable and assignable scopes
   */
  getAgentAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "read,write,app:assignable,app:mentionable", // New scopes for agent functionality
      actor: "app", // New actor type for agents
      state: state || this.generateState(),
    });

    return `https://linear.app/oauth/authorize?${params.toString()}`;
  }

  /**
   * Generate the Linear OAuth authorization URL (legacy user authentication)
   * Keep this for backwards compatibility if needed
   */
  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "read,write",
      state: state || this.generateState(),
    });

    return `https://linear.app/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * Updated to handle both user and agent token responses
   */
  async getAccessToken(code: string): Promise<{
    accessToken: string;
    appUserId: string;
    organizationId: string;
    actor: "user" | "app";
    scopes: string[];
  }> {
    const response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OAuth token exchange failed: ${errorText}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      appUserId: data.actor?.id || "unknown",
      organizationId: data.actor?.organization?.id || "unknown",
      actor: data.actor?.type || "user",
      scopes: data.scope?.split(",") || [],
    };
  }

  /**
   * Generate a secure random state parameter for OAuth
   */
  private generateState(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  /**
   * Validate that the token has the required agent scopes
   */
  static validateAgentScopes(scopes: string[]): boolean {
    const requiredScopes = [
      "read",
      "write",
      "app:assignable",
      "app:mentionable",
    ];
    return requiredScopes.every((scope) => scopes.includes(scope));
  }
}
