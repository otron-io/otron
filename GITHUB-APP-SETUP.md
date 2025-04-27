# Setting up a GitHub App for Linear Agent

This guide will help you set up a GitHub App to use with the Linear Agent, which provides better permissions management and security than using a personal access token (PAT).

## Creating a GitHub App

1. Go to your GitHub account settings.
2. Select "Developer settings" from the left sidebar.
3. Click on "GitHub Apps" and then "New GitHub App".
4. Fill in the required information:
   - **GitHub App name**: Give your app a name (e.g., "Linear Agent")
   - **Homepage URL**: You can use your company URL or repository URL
   - **Callback URL**: Not required for this use case
   - **Webhook**: Uncheck "Active" as we don't need webhooks for this use case
5. Set the following permissions:
   - **Repository permissions**:
     - **Contents**: Read & write (to create branches and commits)
     - **Pull requests**: Read & write (to create PRs)
     - **Metadata**: Read-only (required)
6. Under "Where can this GitHub App be installed?", choose either:

   - "Only on this account" (recommended for personal use)
   - "Any account" (if you want to allow installation on other accounts)

7. Click "Create GitHub App".

## Generating a Private Key

After creating the app:

1. Click on "Generate a private key" button at the bottom of the page.
2. A `.pem` file will be downloaded. Keep this secure as it gives access to your GitHub App.
3. Open the file and copy its contents (including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`).

## Installing the App

1. On the GitHub App page, click "Install App" on the left sidebar.
2. Select the account where you want to install the app.
3. Choose which repositories to give the app access to:
   - "All repositories" (simplest option)
   - "Only select repositories" (more secure, but you'll need to update when adding new repos)
4. Click "Install".
5. Take note of the installation ID from the URL. It should look like: `https://github.com/settings/installations/12345678` where `12345678` is the installation ID.

## Updating Environment Variables

Add the following environment variables to your project's `.env` file:

```
# GitHub App credentials
GITHUB_APP_ID=12345                # App ID from the GitHub App page
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMII...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_INSTALLATION_ID=12345678  # From the installation URL

# Optional for OAuth flow
GITHUB_APP_CLIENT_ID=Iv1.abcd1234    # From the GitHub App page
GITHUB_APP_CLIENT_SECRET=abcdef1234  # From the GitHub App page
```

Note: For the private key, replace newlines with `\n` when adding to the .env file.

## Using the GitHub App

Once configured, the Linear Agent will automatically use your GitHub App for authentication when interacting with GitHub repositories, such as:

- Searching code
- Creating branches
- Committing changes
- Opening pull requests

The app will authenticate as itself and create installation tokens for specific repositories as needed.

## Advantages Over Personal Access Tokens

- **Better security**: GitHub Apps use short-lived tokens
- **Granular permissions**: Only request the permissions you need
- **Better visibility**: Easy to see which repos have the app installed
- **Higher rate limits**: GitHub Apps have higher rate limits than personal access tokens
