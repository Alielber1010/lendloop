import type { AuthConfig } from "convex/server";

// Clerk issues a JWT from its "convex" template (aud = "convex").
// CLERK_JWT_ISSUER_DOMAIN is set on the Convex deployment, e.g. https://your-app.clerk.accounts.dev
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
