/**
 * Linear OAuth service for handling authentication flow
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
   * Generate the Linear OAuth authorization URL
   */
  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'read,write',
      state: 'linear-oauth-state', // You might want to generate a random state for security
    });

    return `https://linear.app/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async getAccessToken(code: string): Promise<{
    accessToken: string;
    appUserId: string;
    organizationId: string;
  }> {
    const response = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OAuth token exchange failed: ${errorText}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      appUserId: data.actor?.id || 'unknown',
      organizationId: data.actor?.organization?.id || 'unknown',
    };
  }
}
