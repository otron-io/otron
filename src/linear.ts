import { LinearClient } from "@linear/sdk";

type AccessTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export class LinearService {
  private client: LinearClient | null = null;
  private accessToken: string | null = null;
  private appUserId: string | null = null;
  private organizationId: string | null = null;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string,
  ) {}

  public getAuthUrl(): string {
    return `https://linear.app/oauth/authorize?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(
      this.redirectUri,
    )}&response_type=code&scope=read,write,issues:create,comments:create,app:assignable,app:mentionable&actor=app`;
  }

  public async getAccessToken(code: string): Promise<{
    accessToken: string;
    appUserId: string;
    organizationId: string;
  }> {
    const formData = new URLSearchParams();
    formData.append("client_id", this.clientId);
    formData.append("client_secret", this.clientSecret);
    formData.append("redirect_uri", this.redirectUri);
    formData.append("code", code);
    formData.append("grant_type", "authorization_code");

    const response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OAuth error response: ${errorText}`);
      throw new Error(`Failed to get access token: ${response.statusText}`);
    }

    const data = (await response.json()) as AccessTokenResponse;
    this.accessToken = data.access_token;

    // Initialize the client with the access token
    this.client = new LinearClient({ accessToken: this.accessToken });

    // Get the app user ID and organization ID
    await this.fetchAppUserAndOrgInfo();

    return {
      accessToken: this.accessToken,
      appUserId: this.appUserId || "",
      organizationId: this.organizationId || "",
    };
  }

  public setStoredCredentials(accessToken: string, appUserId: string): void {
    this.accessToken = accessToken;
    this.appUserId = appUserId;
    this.client = new LinearClient({ accessToken: this.accessToken });
  }

  private async fetchAppUserAndOrgInfo(): Promise<void> {
    if (!this.client) {
      throw new Error("Linear client not initialized");
    }

    const viewer = await this.client.viewer;
    this.appUserId = viewer.id;

    // Fetch organization info
    const organization = await viewer.organization;
    if (organization) {
      this.organizationId = organization.id;
    }

  public async getIssue(issueId: string) {
    if (!this.client) {
      throw new Error("Linear client not initialized");
    }

    try {
      const issue = await this.client.issue(issueId);
      return issue;
    } catch (error) {
      console.error(`Error fetching issue ${issueId}:`, error);
      return null;
    }
  }

  }
}
