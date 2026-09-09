# External configuration needed

Everything below is optional for local development of most features - the app
builds and runs without any of it; affected features degrade with clear
messages. Provisioning steps live in [SETUP.md](SETUP.md); every variable is
documented in [.env.example](../.env.example); `GET /api/health` reports live
status (missing vars + DB reachability).

## 1. Supabase project (required for auth + data)
`.env.local` currently points at the previous project's credentials (carried
over from the earlier Talent Classroom effort - its schema conflicts with this
platform's). Create a fresh free-tier project at https://supabase.com and:

1. Set in `.env.local`:
 ```
 NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
 NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
 ```
2. Apply migrations in order - `0001_tenancy.sql` → `0002_academy_domain.sql`
 → `0003_knowledge_engine.sql` → `0004_billing.sql` (SQL editor or
 `npm run db:push`; details + RLS verification in SETUP.md §3-4).
3. Enable Realtime broadcast (default on) - live classroom sync uses it.

First user: sign up with "New academy" → becomes CEO; invite everyone else
from Academy → Add Student / invites.

## 2. AI provider key (Knowledge Engine vision + AI Assistant)
The provider is pluggable (`src/lib/ai` - `AI_PROVIDER=anthropic|openai`,
anthropic default):

- `/api/knowledge/process` - vision pass that finds chess diagrams in
 PDFs/scans and reconstructs FENs. **PGN uploads work without any key.**
- `/api/assistant` - coach chat (lesson plans, position explanations,
 analytics summaries).

Get a key at https://console.anthropic.com and set `ANTHROPIC_API_KEY` in
`.env.local` (and in Vercel project env for production). Without it, PDF/image
jobs fail with a clear error and the assistant returns 422; everything else
works. (`AI_PROVIDER=openai` + `OPENAI_API_KEY` also works, images only -
PDF input currently needs the Anthropic provider.)

## 3. Google OAuth (optional login method)
Supabase Dashboard → Authentication → Providers → Google: needs a Google
Cloud OAuth client ID/secret. Email/password works without it; the "Continue
with Google" button errors until configured.

## 4. Payment gateway - Razorpay (implemented, needs keys)
Billing is provider-agnostic (`src/lib/billing`); the **mock gateway** works
with zero credentials and **Razorpay is built in** (`razorpay.ts`, Payment
Links). To go live:

1. Set `BILLING_PROVIDER=razorpay` + `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
 / `RAZORPAY_WEBHOOK_SECRET` (dashboard.razorpay.com).
2. Point a Razorpay webhook (payment_link.paid, payment.captured,
 payment.failed) at `<site>/api/webhooks/razorpay`.
3. Set `SUPABASE_SERVICE_ROLE_KEY` so webhooks can settle invoices without a
 user session.

Other gateways: one more module implementing the 4-method `BillingProvider`
interface, registered in `billingProvider()`.

## 5. Email (production auth mail)
Supabase Auth sends confirmation/reset email on its built-in (rate-limited)
sender. For production, configure custom SMTP in Supabase Dashboard → Auth →
SMTP - no app env var.

## 5a. n8n failure/fallback webhook (WhatsApp delivery)
When a live class fails, `POST /api/failures/classroom` records the failure,
picks the class's fallback meeting link, and hands the session details to n8n,
which delivers the link to the parent/student over WhatsApp. n8n is the
delivery arm only - the platform decides whether to notify (15-minute dedupe
window) and which link to send.

```
N8N_FALLBACK_WEBHOOK_URL=https://<your-n8n>/webhook/chess-fallback
N8N_FALLBACK_WEBHOOK_TOKEN=<optional shared secret, sent as x-webhook-token>
```

Without `N8N_FALLBACK_WEBHOOK_URL` the failure is still recorded and shown on
the CEO dashboard, and the endpoint reports `not_configured` - it never claims
a message was delivered. The n8n workflow itself needs a WhatsApp provider
(Twilio/Meta Cloud API/Gupshup) configured on the n8n side; those credentials
live there, not here.

**Lead acquisition no longer runs through n8n.** TeleCRM owns that
(docs/telecrm-setup.md); the old `/api/webhooks/leads` n8n ingestion endpoint
has been removed.

## 6a. TURN server (reliable cross-network video)
Classroom video (`src/components/class/mesh-video-room.tsx`) is peer-to-peer
over STUN only. STUN fails silently in one direction for participants behind
symmetric NAT/strict firewalls - the "I see myself but not the other person"
report. Set:
```
NEXT_PUBLIC_TURN_URLS=turn:your-turn-host:3478,turns:your-turn-host:5349
NEXT_PUBLIC_TURN_USERNAME=...
NEXT_PUBLIC_TURN_CREDENTIAL=...
```
Free/cheap options: Cloudflare Calls TURN, metered.ca free tier, or
self-hosted `coturn`. Without it, video still works whenever both sides have
an open enough network path (most home/office wifi); it silently degrades to
one-way or no video on stricter networks otherwise.

## 6. Vercel (deploy)
`vercel` CLI or GitHub integration; set the env vars above in the project.
Free tier suffices (no server-side engine: Stockfish runs client-side as WASM;
video is Jitsi's free meet.jit.si - override with `NEXT_PUBLIC_JITSI_DOMAIN`
to self-host; realtime is Supabase). Point uptime monitoring at `/api/health`.

## 7. Analytics / monitoring (Future per enterprise_system_architecture.md)
PostHog (product analytics + feedback widget) and Sentry (error monitoring)
are classified Future; reserved env names are listed in `.env.example` so
deploys can set them ahead of the SDK landing.
