# Authentication Setup for Linear Agent

This document describes the basic authentication setup for the Linear Agent application's endpoints.

## Authentication Methods

The application uses three different authentication methods:

1. **Basic Authentication**: Simple username/password authentication for admin-only interfaces
2. **Internal API Token**: Secures API endpoints that should only be called from within the application
3. **Webhook Verification**: Verifies that webhook calls are coming from Linear

## Protected Endpoints

| Endpoint           | Authentication Type  | Description                              |
| ------------------ | -------------------- | ---------------------------------------- |
| `/`                | None                 | Public landing page                      |
| `/health`          | None                 | Health check endpoint                    |
| `/webhook`         | Webhook Verification | Linear webhook receiver                  |
| `/oauth/callback`  | None                 | OAuth callback for Linear authorization  |
| `/api/embed-repo`  | Internal API Token   | Repository embedding API endpoint        |
| `/api/code-search` | Internal API Token   | Code search API endpoint                 |
| `/pages/embed`     | Basic Authentication | Admin interface for repository embedding |

## Environment Variables

The following environment variables need to be set for authentication to work:

```env
# Authentication for admin interfaces
ADMIN_PASSWORD=your_secure_password_here

# Internal API security
INTERNAL_API_TOKEN=your_internal_token_here

# Linear webhook verification (already in use)
WEBHOOK_SIGNING_SECRET=your_linear_webhook_secret
```

## How Authentication Works

### Basic Authentication (Admin UI)

The admin UI at `/pages/embed` is protected with HTTP Basic Authentication. When accessing this page,
you'll be prompted for a username and password. Any username will work, but the password must match
the `ADMIN_PASSWORD` environment variable.

### Internal API Protection

The API endpoints `/api/embed-repo` and `/api/code-search` are protected with an internal token.
This token is automatically added to API requests made from the admin UI. If you need to call these
endpoints directly, include the token in your requests:

```
# As a header
X-Internal-Token: your_internal_token_here

# Or as a query parameter
/api/code-search?token=your_internal_token_here&repository=...
```

### Webhook Verification

The `/webhook` endpoint verifies that incoming requests are from Linear by checking the signature
in the `linear-signature` header using the `WEBHOOK_SIGNING_SECRET` value.

## Security Notes

1. This is a basic authentication setup - for production environments, consider more robust security measures
2. Always use strong, unique passwords and tokens
3. The internal token is included in the HTML of the admin UI - this is acceptable since the admin UI itself is password-protected
