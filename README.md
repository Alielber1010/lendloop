# LendLoop

**Borrow what you need. Lend what you don't.**

LendLoop is a neighbourhood tool-lending board. Neighbours list tools they're happy to lend, request to borrow each other's tools for a date range, and get notifications and overdue reminders that run through n8n.

- **Live demo:** https://lendloop-henna.vercel.app (Clerk development instance: sign up with any email)
- **Stack:** Next.js 16 (App Router), Clerk, Convex, n8n (self-hosted), TypeScript
- **Look and feel:** the *Virtual Cafe* design system (Woodhouse theme): its colour tokens, Pixelify Sans, Silkscreen and Work Sans type, and its Avatar Engine, which gives every neighbour a stable pixel avatar seeded from an opaque id

---

## What it does

| Signed out | Signed in |
|---|---|
| Tagline, a read-only shelf of available tools (**name and category only**), and a "Sign in to lend or borrow" button (Clerk) | **All tools**, with availability and a category filter · **My listings** (create, edit, delete) · **My requests** (as borrower, cancel while pending) · **Incoming requests** (as lender: approve, decline, mark returned) · **Inbox** (notifications delivered by n8n) · **Admin** (admins only) |

Each loan card shows its recent automation activity, for example *"Overdue reminder sent (in-app), 2 days ago"* or *"Lender notified (in-app), 5 minutes ago"*.

## Architecture

```
 Browser (Next.js + Clerk)
   │  Clerk JWT ("convex" template: names only, no email)
   ▼
 Convex ───────────────── queries / mutations: every permission check lives here
   │  mutation commits status change + outbox row (automationEvents) in ONE transaction
   │  scheduler → action `automation.deliver`
   │      POST  /webhook/lendloop/loan-event     Authorization: Bearer <HS256 JWT, key A>
   ▼
 n8n (self-hosted on a VPS, behind Cloudflare Tunnel)
   ├─ 1 · Request notification   webhook → verify JWT + body hash → compose → deliver (mock) → write back
   ├─ 2 · Overdue reminders      daily 09:00 → fetch overdue → per loan: remind (mock) → write status back
   ├─ 3 · Error handler          Error Trigger → log to data table → report to Convex
   └─ 0 · Signed call to Convex  shared sub-workflow: serialize → SHA-256 → sign JWT (key B) → POST, 4 retries
   │
   ▼  POST https://<deployment>.convex.site/automation/{notification|overdue-loans|reminder|error}
 Convex HTTP actions: verify signature, then idempotent internal mutations
```

**Data model** (`convex/schema.ts`): `users` (role, trustedLender), `tools`, `loans` (with a `toolName` snapshot so history survives a deleted listing), `automationEvents` (the outbox), `loanActivity` (what automation did, keyed for idempotency), `notifications` (the in-app inbox), `automationErrors`.

**Loan lifecycle:** `requested → approved → returned`, or `requested → declined | cancelled`. "Upcoming", "on loan" and "overdue" are derived from the dates, never stored, so they can't drift. Each transition queues exactly one event:

| Event | Notified |
|---|---|
| `loan.requested`, `loan.cancelled` | lender |
| `loan.approved`, `loan.declined`, `loan.returned` | borrower |

## Roles and access control

Access is enforced **in Convex functions** (`convex/lib/auth.ts`, `convex/tools.ts`, `convex/loans.ts`, `convex/admin.ts`). The UI only hides buttons.

| Action | user | admin |
|---|---|---|
| Create a listing | ✓ | ✓ |
| Edit or delete a listing | own only | own only |
| Remove **any** listing | | ✓ (`admin.removeTool`; pending requests are auto-declined and the borrowers notified) |
| Request to borrow | not your own tool | same |
| Approve, decline, mark returned | lender of that loan only | same (admins moderate; they don't act for lenders) |
| Cancel a request | borrower of that loan only | same |
| View all loans, users, automation health | | ✓ |
| Mark a lender "Trusted Lender" | | ✓ |

Design choices:
- **The role lives in Convex**, not in Clerk metadata, so permission checks never depend on a claim the client could influence.
- **Admin can't be granted from the browser.** Admins are bootstrapped by Clerk user id (`LENDLOOP_ADMIN_IDS`; ids can't be claimed the way an email can) or promoted with the internal mutation `npx convex run users:setRole '{"clerkId":"user_…","role":"admin"}'`.
- **"Not found" and "not yours" return the same error**, so ids can't be probed.
- **Inputs are validated on the server:** enum validators for category and condition, trimmed and length-bounded text, date format and range checks (no past starts, at most 30 days, no overlap with an approved loan, one pending request per borrower per tool), and a cap of 50 listings per user.
- **The public query returns name and category only.** Owner, description and availability are never sent to signed-out visitors.

These rules were exercised end to end with two real Clerk users (see *Verification* below).

## n8n integration

### Workflows (`n8n/workflows/*.json`)

1. **Request notification**: a webhook with JWT auth (rejects unsigned requests before any execution starts), then *Read signed claims*, *Hash received body*, and *Body matches signature?* (body hash, `iss`, `aud`, and `jti === eventId`). Next, *Compose message*, *Deliver (mock: log to outbox)*, *Write delivery back to Convex*, and *Respond 200 `{"ok":true}`*. A mismatch gets a 401.
2. **Overdue reminders**: a daily schedule calls *Fetch overdue loans (signed)*, then for each loan *Compose reminder* and *Send reminder (mock)*, which writes `sent` back to Convex. If the send fails, the node's error output writes `failed` back instead, so a failed reminder is still recorded on the loan.
3. **Error handler**: the error workflow of 1 and 2. It logs the failed run to the n8n data table `lendloop_errors` and reports it (signed) to Convex, where it appears under *Admin → Automation health*.
4. **Signed call to Convex**: one sub-workflow for every n8n → Convex call. It is restricted to the three workflows above (`callerPolicy: workflowsFromAList`).

**The delivery channel is a mock:** "sending" means upserting a row into the n8n data table `lendloop_outbox` (keyed by `notify:<eventId>` or `reminder:<loan>:<date>`). The write-back then puts the message in the recipient's in-app inbox. To switch to a real channel, replace that one node with Email, Slack or Discord. Everything else stays the same.

### Securing both directions

- **Signatures:** each request carries `Authorization: Bearer <JWT>`, signed with **HMAC-SHA256 (HS256)**. The claims include `bodySha256`, the hash of the exact request body, so the signature covers the payload, not just the sender. `exp` is 5 minutes, `iss`/`aud` are fixed, and `alg` must be `HS256` (no `none`). Convex compares with `crypto.subtle.verify`, which runs in constant time.
- **Why a JWT rather than a bare `X-Signature` header:** n8n can sign and verify JWTs with its built-in JWT node and an **encrypted credential**. A raw HMAC in n8n would need the secret in a Code node or `$env`, and from there it leaks into exported workflow JSON or execution data.
- **One key per direction:** `CONVEX_TO_N8N_SECRET` (n8n credential *LendLoop – verify Convex → n8n*) and `N8N_TO_CONVEX_SECRET` (*LendLoop – sign n8n → Convex*). A leak in one direction can't forge traffic in the other, and `iss`/`aud` stop a token being replayed back at its sender.
- **No secrets in code or JSON:** Convex reads them from deployment env vars and n8n from credentials. The exported workflows reference credentials only by name. `scripts/setup-n8n.sh` generates the secrets into a git-ignored, mode-600 file and pipes them into n8n over stdin.
- **Bounded input:** Convex rejects bodies over 16 KB. A well-signed request about an unknown event or loan gets `422`, never a write.
- **n8n can't redirect messages:** the recipient of a notification comes from Convex's own outbox row, not from anything n8n sends back. Reminder keys must match `reminder:<that loan>:<today or yesterday>`.

### Idempotency

| Write-back | Key | Effect of a retry |
|---|---|---|
| Notification delivered | `notify:<eventId>` | No second notification or activity row |
| Reminder sent | `reminder:<loanId>:<YYYY-MM-DD>` | At most one reminder per loan per day. Convex also leaves out loans already reminded today, so re-running the schedule sends nothing new |
| Reminder failed | `reminder:…:failed` | Recorded once |
| Workflow error | n8n `executionId` | Recorded once |

The n8n side is idempotent too: the mock "send" is an **upsert** on the same keys.

### Reliability and failure visibility

- **Outbox pattern:** the status change and its event row commit in the same Convex transaction, so an event exists exactly when the change happened. Delivery runs in a scheduled action.
- **Convex → n8n retries:** exponential backoff at 30 s, 2 min, 8 min and 32 min, then the event is marked `failed` and shown on the loan ("Notification failed after 5 tries") and in Admin. A Convex cron re-queues any event whose scheduled run never happened.
- **A 2xx alone isn't trusted:** Convex counts an event as delivered only when the workflow's final node answers `{"ok":true}`. n8n answers an empty 200 when a run dies midway, and that case is retried.
- **n8n → Convex retries:** the HTTP node retries 4 times, 5 s apart. A final failure fails the run, which fires the error workflow. Failed executions keep their data (`saveDataErrorExecution: all`).

## Data minimisation

- The **Clerk → Convex token** carries first name, last name and username, **no email**. The UI shows "Maya L.", never a full surname or contact details.
- The **webhook payload to n8n** carries only: event id and type, loan id, status and dates, tool name, the recipient's opaque Convex id, first name plus initial, and role, and the other party's first name plus initial. No emails, no descriptions, no other loans.
- The **overdue endpoint** returns per loan only: loan id, reminder key, borrower's opaque id and short name, tool name, end date and days overdue.
- **Signed-out visitors** see tool name and category only.
- n8n keeps **14 days** of execution data (`EXECUTIONS_DATA_MAX_AGE=336` in the compose file).

## Local setup

Prerequisites: Node 20+, Docker, a Convex account and a Clerk account (Clerk's keyless mode also works for a first run).

```bash
git clone https://github.com/Alielber1010/lendloop && cd lendloop
npm install

# 1. Convex: creates a dev deployment and writes NEXT_PUBLIC_CONVEX_URL(+_SITE_URL) to .env.local
npx convex dev --once

# 2. Clerk: create an application, then Dashboard → Integrations → Convex → Activate
#    (or create a JWT template named "convex" with aud = "convex")
#    Add the Clerk keys to .env.local (see .env.example), then:
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
npx convex env set LENDLOOP_ADMIN_IDS user_xxx            # optional: your Clerk user id

# 3. n8n: local container plus a public tunnel so Convex cloud can reach the webhook
echo "N8N_ENCRYPTION_KEY=$(openssl rand -hex 24)" > .env.n8n && chmod 600 .env.n8n
docker compose --profile tunnel up -d
docker compose logs tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
./scripts/setup-n8n.sh https://<that-url>   # secrets → Convex env + n8n credentials, imports workflows
#    then the two manual steps it prints (create the 2 data tables, set convexSiteUrl, publish)

# 4. Run the app
npm run dev           # http://localhost:3000   (keep `npx convex dev` running in another tab)
```

Handy commands:

```bash
N8N_TO_CONVEX_SECRET=… node scripts/check-signing.mjs https://<deployment>.convex.site  # signature tests
npx convex run seed:overdueLoan '{"lenderClerkId":"user_…","borrowerClerkId":"user_…"}' # demo overdue loan
npx convex run users:setRole '{"clerkId":"user_…","role":"admin"}'
```

### Environment variables

| Where | Name | Purpose |
|---|---|---|
| `.env.local` (Next.js) | `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex endpoints (written by `convex dev`) |
| | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk |
| Convex env (`npx convex env set`) | `CLERK_JWT_ISSUER_DOMAIN` | Issuer the Clerk JWTs are checked against |
| | `LENDLOOP_ADMIN_IDS` | Comma-separated Clerk user ids that start as admin |
| | `N8N_LOAN_EVENT_WEBHOOK_URL` | n8n webhook for loan events (unset = events marked `skipped`) |
| | `CONVEX_TO_N8N_SECRET` / `N8N_TO_CONVEX_SECRET` | The two signing keys (32 random bytes, hex) |
| n8n credentials | *LendLoop – verify Convex → n8n*, *LendLoop – sign n8n → Convex* | Same two keys, as encrypted `jwtAuth` credentials |
| `.env.n8n` (git-ignored) | `N8N_ENCRYPTION_KEY` | Encrypts n8n credentials at rest |

## Verification

Run against the deployed stack (Convex cloud plus n8n on the VPS):

- **Access control:** with two real Clerk users, every cross-user action was denied: approving someone else's request, editing or deleting their listing, admin queries and mutations, borrowing your own tool.
- **Signatures:** valid → 200. Missing, wrong key, tampered body, expired, or wrong audience → 401, in both directions.
- **Retries:** the first deliveries got a 401 because of a bug in the workflow. After the fix, Convex's backoff redelivered them, and each event produced exactly one notification.
- **Idempotency:** running the overdue workflow twice gave one reminder.
- **Failure path:** a correctly signed event that Convex doesn't know failed the write-back after retries. The error workflow logged it and it appeared in *Admin → Automation health*.

## What I'd change for production

- **Separate Convex prod and dev deployments** and a Clerk production instance with its own domain. Deploy with `npx convex deploy` in CI before `next build`.
- **A real channel:** swap the mock node for email (Resend or SES) or Slack. That needs the recipient's email, so I'd have Convex send a short-lived, single-use lookup token instead of the address, or let n8n fetch the address from a signed endpoint just in time. Add per-user notification preferences and unsubscribe.
- **Key rotation:** accept a `kid` header with two active keys during rotation, and keep the secrets in a manager (Doppler, 1Password or Vault) instead of `.env` files.
- **Replay protection:** today a captured request can be replayed within its 5-minute window, which is harmless only because every write is idempotent. I'd store seen `jti`s for the token lifetime.
- **Scale:** availability is computed per tool per query (fine for a street, not a city). I'd denormalise the current loan onto the tool, paginate the lists, and use `@convex-dev/aggregate` for admin counts.
- **n8n:** queue mode with Redis and a worker, Postgres instead of SQLite, a pinned image, backups of the n8n volume, and webhook rate-limiting at Cloudflare. Alert on the error workflow (Slack or PagerDuty), not just log it.
- **Product:** time zones per neighbourhood (dates are UTC calendar days today), photos, reviews, handover chat, and abuse reporting on listings.
- **Tests:** unit tests for `lib/signing.ts` and the loan rules with `convex-test`, and Playwright for the main flows in CI.

## Repository layout

```
convex/            schema, queries/mutations, HTTP routes, outbox + retries, cron, seed
  lib/auth.ts      viewer / requireViewer / requireAdmin, profile upsert
  lib/signing.ts   HS256 sign/verify bound to the body hash
  lib/loanRules.ts outbox enqueue, overlap check, closing open requests
src/app/           landing page + (app) routes: board, listings, requests, incoming, admin
src/components/    ToolCard, LoanCard, NotificationBell, PixelAvatar
src/lib/cafe/      Avatar Engine from the Virtual Cafe design system
n8n/workflows/     exported workflows (no secrets)
scripts/           setup-n8n.sh, check-signing.mjs
docker-compose.yml local n8n (+ optional Cloudflare quick tunnel)
```
