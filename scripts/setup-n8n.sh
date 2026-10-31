#!/usr/bin/env bash
# One-time wiring of Convex <-> n8n for local development.
#   1. generates the two signing secrets (once; kept in .env.n8n, chmod 600, git-ignored)
#   2. sets them on your Convex deployment
#   3. imports them into n8n as encrypted JWT credentials
#   4. imports the four workflows
# Usage: ./scripts/setup-n8n.sh https://<your-public-n8n-url>
set -euo pipefail
cd "$(dirname "$0")/.."

N8N_PUBLIC_URL="${1:?usage: setup-n8n.sh https://your-public-n8n-url}"
N8N_PUBLIC_URL="${N8N_PUBLIC_URL%/}"

umask 077
if [ ! -f .env.n8n ]; then
  {
    echo "N8N_ENCRYPTION_KEY=$(openssl rand -hex 24)"
    echo "CONVEX_TO_N8N_SECRET=$(openssl rand -hex 32)"
    echo "N8N_TO_CONVEX_SECRET=$(openssl rand -hex 32)"
  } > .env.n8n
  echo "Wrote .env.n8n (keep it out of git)"
fi
set -a; . ./.env.n8n; set +a

echo "Setting Convex env vars…"
npx convex env set CONVEX_TO_N8N_SECRET "$CONVEX_TO_N8N_SECRET" >/dev/null
npx convex env set N8N_TO_CONVEX_SECRET "$N8N_TO_CONVEX_SECRET" >/dev/null
npx convex env set N8N_LOAN_EVENT_WEBHOOK_URL "$N8N_PUBLIC_URL/webhook/lendloop/loan-event" >/dev/null

echo "Importing n8n credentials…"
CREDS=$(node -e '
  const c = (id, name, secret) => ({ id, name, type: "jwtAuth", data: { keyType: "passphrase", secret, algorithm: "HS256" } });
  console.log(JSON.stringify([
    c("LendLoopVerifyIn1", "LendLoop – verify Convex → n8n", process.env.CONVEX_TO_N8N_SECRET),
    c("LendLoopSignOut01", "LendLoop – sign n8n → Convex", process.env.N8N_TO_CONVEX_SECRET),
  ]));')
# Pipe through stdin into the container so the secret never lands in the repo or image.
echo "$CREDS" | docker compose exec -T n8n sh -c 'umask 077; cat > /tmp/c.json && n8n import:credentials --input=/tmp/c.json; rm -f /tmp/c.json'

echo "Importing workflows…"
docker compose exec -T n8n n8n import:workflow --separate --input=/lendloop/workflows

cat <<EOF

Done. Two manual steps in the n8n UI (http://localhost:5678):
  1. Data tables -> create "lendloop_outbox" (dedupeKey, kind, recipientRef, channel, message, loanId: all string)
     and "lendloop_errors" (executionId, workflow, node, message: all string), then pick them in the
     data-table nodes of the workflows.
  2. In "LendLoop – Signed call to Convex" set convexSiteUrl to your Convex HTTP actions URL
     ($(grep NEXT_PUBLIC_CONVEX_SITE_URL .env.local 2>/dev/null | cut -d= -f2 || echo 'https://<deployment>.convex.site')),
     then publish the error handler first, then the other three workflows.
EOF
