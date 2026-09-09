# Enterprise System Architecture

**Project:** chess-platform — a B2B (multi-tenant) chess-academy operating system.
**Stack:** Next.js 16 (App Router, RSC) · Supabase (Postgres + RLS, Auth, Realtime, Storage) ·
Stockfish 17.1 WASM (client) · P2P mesh WebRTC for classroom A/V (LiveKit / Jitsi kept as
swap-in alternatives) · Vercel hosting · Razorpay billing · n8n for lead/WhatsApp automation.
**Status of this document:** authoritative reference for how the system is wired and where it
must evolve. It consolidates and supersedes the scattered guidance in
`docs/ARCHITECTURE_V2.md`, `docs/ARCHITECTURAL_REVIEW.md`, `docs/PRODUCTION_READINESS.md`, and
`docs/telecrm-architecture.md` — read those for detail; read this for the shape.

**Inputs it was written against:** the 22 building blocks in
[`proyecto26/system-design-skills`](https://github.com/proyecto26/system-design-skills)
(caching, messaging/streaming, rate limiting, decoupling, data-storage, scaling, observability,
resilience) and the six production requirements from *"How to not get hacked when vibe coding an
app"* (Erik Cupsa): **rate limits · RLS so users see only their own data · never expose API keys ·
cache repeated requests with Redis · move heavy tasks (email / AI / PDF parsing) to async jobs ·
load test before launching.** §2.1 tracks compliance with all six.

## How to read this

- **[EXISTS]** — shipped and running today.
- **[GAP]** — a named weakness, cross-referenced to `docs/PRODUCTION_READINESS.md` blocker IDs.
- **[ADD-WHEN]** — a change we should make, with the concrete trigger that makes it worth doing.

The guiding rule is **right-sizing**: this is an all-serverless app on Vercel + Supabase with a
verified ceiling around **90 concurrent live classes** (the Supabase Realtime 200-connection wall,
2 connections/class). Recommendations that assume Kafka, self-hosted Redis workers, a service
mesh, or a multi-region active-active database are **explicitly rejected** as premature. The
architecture we want is the *smallest* one that is correct, decoupled, and has a clean upgrade
path — not the biggest one that looks enterprise.

---

## 1. System context

### 1.1 What the system is

A single Next.js application serving four roles (`ceo`, `manager`, `coach`, `student`) across many
**academies** (tenants). One deployment, one database, one codebase. Tenancy is enforced in the
database by Row Level Security keyed on `academy_id`, never by application code alone.

### 1.2 Deployment topology

```
                       ┌─────────────────────────────────────────────┐
   Browser  ───────────▶  Vercel Edge (WAF, DDoS, TLS, static/CDN)   │
   (React,   HTTPS      │        │                                    │
    Stockfish WASM,     │        ▼                                    │
    chessground,        │  Next.js on Vercel (serverless functions)   │
    mesh WebRTC)        │   • RSC page renders (session-gated)        │
        │               │   • Route Handlers  /api/*                  │
        │               │   • Server Actions                          │
        │               │   • proxy.ts (session refresh + route gate) │
        │               └───────┬───────────────┬────────────────────┘
        │                       │               │
        │  Realtime WS          │ Postgres wire │  server-only secrets
        │  (broadcast +         │ (RLS: anon    │  (service role, AI keys,
        │   postgres_changes)   │  key + JWT)   │   Razorpay, LiveKit)
        ▼                       ▼               ▼
 ┌──────────────┐      ┌──────────────────────────────────────────┐
 │ Supabase     │      │ Supabase Postgres                        │
 │ Realtime     │◀────▶│  • RLS policies (the security boundary)  │
 │ (WS fan-out) │      │  • pg_cron (demo expiry, future drains)  │
 └──────────────┘      │  • RPCs (SECURITY DEFINER, locked)       │
        ▲              │  • Storage (PGNs, academy assets)        │
        │              └──────────────────────────────────────────┘
        │
   P2P mesh (STUN + TURN) — classroom video, no media server
        │
   External: Razorpay (webhooks) · n8n (lead ingest / WhatsApp) ·
             Anthropic|OpenAI (AI vision + assistant) · Lichess API (puzzles)
```

### 1.3 Trust boundaries

| Boundary | What crosses it | Enforcement |
|---|---|---|
| Browser ↔ Vercel | HTTPS requests, Realtime WS | Vercel platform WAF/DDoS; app rate limits; `proxy.ts` route gate |
| Browser ↔ Supabase (direct) | Postgres queries via `@supabase/supabase-js` with the **anon key + user JWT** | **RLS is the only thing standing here** — the anon key grants nothing on its own |
| Vercel server ↔ Supabase (privileged) | service-role key, RPC calls | Server-only env var; never in a `NEXT_PUBLIC_` var, never in a client bundle |
| Vercel server ↔ 3rd-party APIs | AI keys, Razorpay secret, LiveKit secret | Server-only env vars; requests originate from route handlers only |
| External ↔ Vercel (webhooks) | Razorpay events, n8n lead payloads | HMAC signature verification (Razorpay); per-academy unguessable `webhook_token` (n8n); **idempotency guard [GAP B7]** |

---

## 2. Architecture principles

Adapted from the 22 building blocks in
[`proyecto26/system-design-skills`](https://github.com/proyecto26/system-design-skills), filtered
to what a serverless multi-tenant SaaS at this scale actually needs.

| Principle (source layer) | How it applies here |
|---|---|
| **Make assumptions explicit** (data-storage) | Every capacity claim in this repo is pinned to a number: 90-class ceiling, 200 Realtime connections, ≤1 `live_fen` write/1.5s/class. See §9. |
| **Decouple producers from consumers** (messaging-streaming) | Heavy work (AI, PDF parse, email, reports, WhatsApp) must not run inside the user's request. §5 moves each to a job with its own retry/idempotency contract. |
| **The database is the authority** (consistency-coordination) | RLS + `SECURITY DEFINER` RPCs are the source of truth for *who can see/do what*. Realtime broadcast payloads are **coordination hints, never authority** (§6). |
| **Rate-limit at the edge and the app** (resilience-failure) | Vercel WAF in front; per-user fixed-window in the app today; sharded-counter / sliding-window at scale-out (§4.3). Always answer with a `429` + `Retry-After` contract. |
| **Cache the repeats, protect the cache** (caching) | Identical AI-snap crops, Lichess puzzles, master-DB lookups, dashboard aggregates. Every cache entry needs a TTL, an invalidation rule, and single-flight / jitter against thundering herd (§5.4). |
| **One channel, keyed events — never a channel per entity** (scaling-evolution) | The Live-Ops wall is ONE `postgres_changes` subscription for N boards. Simul mirrors are a `simul_game` *event*, not a channel per student. This is the pattern for all realtime fan-out. |
| **Identify the SPOF, plan the degradation** (resilience-failure) | The coach's browser is the classroom's authority — if it drops, the board freezes. Mitigations in §6.4. |
| **Observability before scale** (observability) | Error monitoring (Sentry DSN reserved, not wired [GAP B5]) and structured request logging are prerequisites to any load-test claim. |
| **Back-of-the-envelope before building** (scaling) | §5.6 load-test targets are derived from the connection ceiling, not guessed. |

### 2.1 Production constraints compliance (from the reference video)

> *"add rate limits … lock down your database with row-level security so users can only see their
> own data … never expose your API keys … cache repeated requests with Redis … move heavy tasks
> like email sending, AI requests, PDF parsing into asynchronous jobs … load test before
> launching."*

| Constraint | Status | Where |
|---|---|---|
| Rate limits | **Partial [GAP B6]** — in-memory per-instance limiter on 3 routes; needs headers + full coverage + scale-out story | §4.3 |
| RLS, users see only their own data | **Strong [EXISTS]** — RLS-first since inception, 36 migrations, `academy_id` tenancy, realtime.messages policies | §4.1 |
| Never expose API keys | **Strong [EXISTS]** — only `NEXT_PUBLIC_SUPABASE_*` crosses to the client; all secrets server-only | §4.2 |
| Cache repeated requests (Redis) | **Missing [GAP]** — no cache layer anywhere; highest-value target is AI-snap-by-image-hash | §5.4 |
| Async jobs (email / AI / PDF) | **Missing [GAP]** — AI vision + PDF parse + exports + email all run synchronously today | §5.1–5.3 |
| Load test before launch | **Not done [GAP B9]** — do not claim >90 classes until Supabase Pro + a passing k6 run | §5.6 |

---

## 3. End-to-end data flows

### 3.1 Request lifecycle (every authenticated page/route)

```
Browser → Vercel Edge (WAF) → proxy.ts
   ├─ refreshes the Supabase session cookie (@supabase/ssr)
   ├─ public path?  → pass through
   ├─ no user + private path? → 302 /login
   └─ role/section gate: /{role}/dashboard/{academyId}/{slug}
        └─ manager + permission-gated slug → look up manager_permissions
   → RSC render OR Route Handler
        ├─ server reads use the request-scoped Supabase client (user JWT, RLS applies)
        ├─ privileged writes use the service-role client (RLS bypassed — must self-check)
        └─ mutating/AI/export routes: rateLimit(key, limit, window) first
```

### 3.2 Classroom join + live board move

```
Student opens /{role}/dashboard/{aid}/classrooms/{id}
  → RSC checks membership (RLS on classrooms / enrollments / batch_members)
  → client subscribes supabase.channel(`class:<id>`, { private: true })
       └─ realtime.messages RLS authorizes on classroom membership (0031/0036)
  → coach's browser is authoritative: runs chess.js, holds the answer line privately
Move:
  student drags piece → onMove() (local chess.js legality check)
     → broadcast { fen, lastMove, history } on `class:<id>`   ← FULL SNAPSHOT
     → coach + peers apply; sound; live_fen debounced-persisted by the coach only
Late joiner:
  roster grows → coach re-broadcasts the full snapshot (+ any mid-flight quiz)
```

Hardening path (students send **intents**, coach is the sole writer of `board`): §6.2.

### 3.3 PDF diagram → FEN (target async design)

```
Coach crops a diagram in the PDF cropper (pdfjs-dist, client)
  → POST { base64, mediaType } to  NEXT_PUBLIC_FEN_RECOGNIZER_URL  (FastAPI)
        OR fallback  /api/knowledge/snap  (AI vision, synchronous, maxDuration 60)
  [ADD-WHEN throughput or cost matters]
  → /api/recognize enqueues fen_jobs row (state=queued), returns { jobId }
  → worker (Edge Function / services/fen-recognizer) processes, writes state=done|failed + fen
  → client shows result via a Realtime postgres_changes subscription on that fen_jobs row
  → cache: sha256(image) → fen  (identical crop skips the model entirely)  §5.4
```

### 3.4 Billing webhook (Razorpay)

```
Razorpay → POST /api/webhooks/razorpay
  → verify x-razorpay-signature (HMAC-SHA256, RAZORPAY_WEBHOOK_SECRET)
  [ADD B7] → INSERT INTO webhook_events(provider,event_id) ON CONFLICT DO NOTHING
             → 0 rows? already processed → 200 OK, stop
  → settleBillingEvent(event) via service role  (invoice/subscription state under lock, 0028/0033)
```

### 3.5 Lead ingest (n8n / WhatsApp)

```
Meta Ads / Google Form / WhatsApp → n8n workflow
  → POST /api/webhooks/leads?token=<per-academy webhook_token>   [design-spec; not yet built]
  → validate token → INSERT lead + lead_event(kind='webhook')  (service role)
  [ADD-WHEN] → enqueue "AI lead qualification" job → first lead_event gets an AI summary
  outbound WhatsApp: app emits a stage-change event → n8n sends → n8n posts status back
```

---

## 4. Data & Security layer

Owns the answer to "can this caller see/do this?" and "what stops one caller
from drowning the system?". Three sub-areas: RLS (the authoritative boundary),
secrets (what must never cross to the client), rate limiting (abuse + runaway
loops).

Guiding principle from `proyecto26/system-design-skills`: **make assumptions
explicit**. Every table states its tenancy assumption; every secret states its
trust boundary; the rate limiter states its ceiling in a `ponytail:` comment.

---

### 4.1 Tenancy & RLS model

**Trust boundary:** the `anon` key ships in every page bundle and is
extractable without logging in. Therefore **RLS on Postgres is the only real
authorization boundary.** UI gates (sidebar visibility, disabled buttons) are
UX, not security — anything they protect must *also* be a policy.

#### The model

- Single Postgres, one row-set, **`academy_id` is the tenancy key** on every
  domain table (`0001_tenancy.sql`).
- Auth identity comes from `auth.uid()` (the Supabase JWT `sub`).
- Four `security definer` helper functions resolve the caller once, so policies
  stay one-liners:

| Helper | Returns | Defined | Used by |
|---|---|---|---|
| `my_academy()` | caller's `academy_id` | `0001` | every academy-scoped policy |
| `my_role()` | `ceo\|manager\|coach\|student` | `0001` | role gates |
| `is_staff()` | `role in (ceo,manager,coach)` | `0001` | staff-write policies |
| `my_perm(flag)` | bool — CEO always true, manager checks `manager_permissions`, else false | `0006`, tightened `0016` | granular manager gates (`can_view_billing`, `can_manage_leads`, …) |
| `is_admin()` | `role in (ceo,manager)` | `0031` | classroom moderation |
| `is_classroom_member(uuid)` | enrolled/coach/admin of that classroom | `0031` | classroom sub-resources |
| `can_join_classroom_channel(uuid)` | authenticated member of the classroom's academy | `0036` | `realtime.messages` policy |

Policies are **permissive** (OR'd). A table with RLS on and zero matching
policies is **deny-all** — that is a feature (fail closed), and it is exactly
how the live classroom went dark once (see 4.1 "standing risks").

#### Table classification (what the tenancy assumption actually is)

| Scope | Read rule | Examples |
|---|---|---|
| **Academy-scoped** (staff see all in-tenant, students see own) | `academy_id = my_academy()` [+ role/perm for sensitive cols] | `classrooms`, `batches`, `leads`, `lead_events`, `homework_*`, `puzzles`, `pgns`, `pgn_folders`, `courses`, `lessons`, `attendance_records`, `bookings`, `meetings`, `tournaments`, `simuls`, `announcements`, `notifications` |
| **Academy-scoped + financial-privacy** (only self or `my_perm('can_view_billing')`) | `student_id = auth.uid() OR (academy_id = my_academy() AND my_perm('can_view_billing'))` (`0024`) | `invoices`, `subscriptions`, `billing_customers`, `billing_events`, `coach_penalties` |
| **User-scoped** (row belongs to one person) | `id = auth.uid()` / `student_id = auth.uid()` / `profile_id = auth.uid()` | `profiles` (self-update, column-guarded — see below), `puzzle_attempts`, `lesson_progress`, `homework_submissions`, `points_ledger` (own), `assistant_threads` |
| **CEO-only** | `academy_id = my_academy() AND my_role() = 'ceo'` | `academy_secrets`, `audit_log` (read, `0035`) |
| **Service-role only** (no policy for `anon`/`authenticated`; written by webhooks/jobs via `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS) | n/a — RLS on, no public policy | `billing_events` writes, `failure_events`, `whatsapp_messages` inserts, `extraction_jobs`/`extraction_items` writes |
| **Public / cross-tenant by design** | `id = my_academy()` (self only) or unauthenticated | `academies` (own row), signup path reads `invites` by code |

#### The `realtime.messages` rule (learned the hard way — `0032`/`0036`)

A Supabase Realtime channel opened with `private: true` is subject to RLS on
`realtime.messages`. **A private channel with no matching policy is refused for
everyone** — board broadcasts, presence, and (because WebRTC signalling rides
the same channel) video all die at once, silently, with no error in the UI.

Rules:

1. Any new `private: true` channel **must** ship a `realtime.messages` policy in
   the same change, and that policy **must be applied to prod before or with**
   the client code (see standing risk).
2. `realtime.messages` on this project is owned by `supabase_realtime_admin`;
   `postgres` is not a superuser and not a member of that role, so
   `create policy … on realtime.messages` **fails in the SQL editor** with
   `42501 must be owner`. It is created through the **dashboard → Realtime →
   Policies** page (custom expression typed by hand).
3. Parse the topic defensively: `realtime_classroom_id()` returns `null` (not an
   exception) for a topic that isn't `<name>:<uuid>`, so an unrelated private
   channel doesn't take itself down inside the policy.
4. **Never make the channel stricter than the page.** A user who can open the
   classroom page but cannot join its channel sees a frozen board and no error.
   `can_join_classroom_channel()` deliberately matches the `classrooms` SELECT
   policy (any authenticated academy member).

Current prod state (from `0036`'s own notes): four **stock template policies**
(`to authenticated`, broadcast+presence select/insert) are live — they restored
the outage but are **broader than intended**: a logged-in student of academy A
can reach a channel in academy B. The tightening (delete templates, paste the
two `can_join_classroom_channel(...)` policies) is a **pending prod action** and
must happen before the platform carries a second real academy.

#### Standing risk: prod is migrated by hand

`supabase/migrations/` is the source of truth in the repo, but **production SQL
is applied manually in the Supabase dashboard**, so prod drifts *behind* the
repo. A commit that pairs a client change with a migration ships only its client
half on `git push` (Vercel deploys code; nobody deploys SQL). This is how
`0032` broke the classroom.

**Mitigations (in priority order):**

| Fix | Effort | Payoff |
|---|---|---|
| `supabase db push` in CI against prod on merge to `master` (needs `SUPABASE_ACCESS_TOKEN` + DB password as CI secrets) | S | closes the drift permanently; the correct fix |
| Until then: a `PENDING_MIGRATIONS.md` at repo root, one line per unapplied migration + realtime-policy change, cleared by hand | XS | visibility, not prevention |
| `npm run db:verify-rls` (script already exists) run in CI as a gate | XS | catches a *missing* policy, not a *stale* one |
| Startup assertion: on boot, a server action checks `select count(*) from pg_policies where schemaname='public'` ≥ expected and warns | S | detects "migration didn't run" within one deploy |

#### RLS checklist — every new table / migration must pass

- [ ] `alter table … enable row level security;` in the same statement block as `create table`.
- [ ] Table carries `academy_id uuid not null references academies(id)` **unless** it is genuinely user-scoped or global (state which, in a comment).
- [ ] A **SELECT** policy exists (deny-all is the default; an unpolicied table is invisible, which is a *bug* if users should see it).
- [ ] Every **UPDATE** policy has an explicit **`with check`** clause. Postgres reuses `using` as `with check` if omitted — that turns "this row is yours" into "…and you may mutate it into anything still yours". This was `0027`'s critical finding: `profiles_update_self` with no `with check` let any student `set role='ceo'` from the browser console.
- [ ] Column-level privilege that RLS can't express (e.g. "edit your name but not your rank") uses a **`before update` trigger** or a **`grant`/`revoke` on columns** + a `security definer` RPC — not a row predicate (`0027` §1).
- [ ] `security definer` functions set `search_path = public` (or `= ''` + schema-qualify) to prevent search-path hijack.
- [ ] `revoke execute … from public, anon;` on any `security definer` RPC that must not be callable pre-auth; `grant … to authenticated`.
- [ ] Sensitive money/PII columns gated behind `my_perm('can_view_billing')` or `my_role()='ceo'`, not just `is_staff()` (`0024`, `0035`).
- [ ] Writes that must bypass RLS (webhooks, jobs) go through the **service-role client in a server-only file**, never a policy that trusts a client-supplied flag.
- [ ] New `private: true` realtime channel → matching `realtime.messages` policy in the same PR + a `PENDING_MIGRATIONS.md` line for the dashboard step.
- [ ] `npm run db:verify-rls` passes locally before the PR.
- [ ] FK columns are indexed (`0009` fixed 87 missing ones — RLS predicates that join on an unindexed FK are a scaling cliff).

---

### 4.2 Secrets management

#### Inventory — what crosses the client boundary

The `NEXT_PUBLIC_` prefix is the **only** thing that ships a value into the
browser bundle. Everything else is server-only (route handlers, server actions,
`proxy.ts`).

| Var | Boundary | Set where | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **client** | Vercel env | public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **client** | Vercel env | public; **safe only because RLS holds** — treat every anon-key capability as "anyone on the internet" |
| `NEXT_PUBLIC_SITE_URL` | client | Vercel env | redirect/callback base |
| `NEXT_PUBLIC_LIVEKIT_URL` | client | Vercel env | SFU ws URL; the room *token* is minted server-side (`/api/livekit/token`) |
| `NEXT_PUBLIC_TURN_URLS` / `_USERNAME` / `_CREDENTIAL` | client | Vercel env | TURN creds are necessarily client-visible; scope them to short-lived / low-quota, or move to per-session credentials from a server route |
| `NEXT_PUBLIC_FEN_RECOGNIZER_URL` | client | Vercel env | just a URL; the service itself must authenticate/limit |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Vercel env (Production + Preview separately) | **bypasses all RLS.** Only in: webhook receivers, `src/lib/billing/settle.ts`, `src/app/api/failures/classroom/route.ts`, background jobs. Never imported into a `"use client"` file or a shared util that a client file imports. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | server only | Vercel env | only touched by `src/lib/ai/index.ts`, which is only imported by route handlers |
| `AI_PROVIDER` | server only | Vercel env | selector, not a secret |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | server only | Vercel env | secret + webhook HMAC key; `KEY_ID` alone may be exposed to the checkout widget if the widget needs it — keep `KEY_SECRET` server-only regardless |
| `BILLING_PROVIDER` / `BILLING_WEBHOOK_SECRET` | server only | Vercel env | |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | server only | Vercel env | sign room tokens only |
| per-tenant `academy_secrets.webhook_token` | **in DB, CEO-RLS** | generated by trigger (`gen_random_bytes(16)`) | n8n / inbound-webhook auth per academy; never an env var — rotates per-row |

#### Rules

1. **Server secret = server file.** A secret may be read only in: `app/api/**/route.ts`, server actions, `proxy.ts`, `src/lib/**` files that are *never* transitively imported by a `"use client"` component. When in doubt, `grep -r "from \"@/lib/x\"" src/app/**/*client*` before putting a secret in `lib/x`.
2. **The anon key is public.** Design as if the attacker has it. Every capability it grants must be RLS-bounded.
3. **Service role bypasses RLS** — treat each use as a hand-written mini-policy. The call site must re-implement the authorization the RLS would have done (check `academy_id`, check the actor). `settle.ts` and the failure route already do this.
4. **Webhooks verify before they trust.** Razorpay: HMAC-SHA256 of the raw body vs `x-razorpay-signature` (`/api/webhooks/razorpay` does this). n8n/inbound: match `academy_secrets.webhook_token` from the path/header, constant-time compare.
5. **Preview deployments get their own secret values** (a non-prod Supabase project, test Razorpay keys). A leaked preview secret must not touch prod data.
6. **`.env.example` lists every var with a fake value**; real values live only in Vercel + the Supabase dashboard. No `.env.local` in git (verify `.gitignore`).

#### Rotation story

| Secret | Rotation trigger | Procedure |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` / `ANON_KEY` | suspected leak, staff offboarding with dashboard access | Supabase dashboard → Settings → API → roll; update Vercel env; redeploy. Anon-key roll invalidates every live session. |
| `ANTHROPIC_/OPENAI_API_KEY` | leak, quota anomaly | provider console → new key → Vercel env → redeploy → revoke old |
| `RAZORPAY_*` | leak, PCI review | Razorpay dashboard → regenerate → update webhook secret in both Razorpay and Vercel |
| `academy_secrets.webhook_token` | per-academy, on request or suspected abuse | `update academy_secrets set webhook_token = encode(gen_random_bytes(16),'hex') where academy_id = …` (CEO can do this from a settings action); re-share the new URL with the academy |
| `LIVEKIT_API_SECRET` | leak | LiveKit console → new key pair → Vercel → redeploy |

#### Never do

- ❌ `NEXT_PUBLIC_` on anything that isn't safe in a stranger's hands.
- ❌ service-role client in a file that a `"use client"` component imports.
- ❌ trust a client-sent `academy_id` / `role` / `is_admin` flag in a service-role write.
- ❌ log a full secret, JWT, or webhook body at `info` (redact; `error` only, truncated).
- ❌ a secret in a URL query string (ends up in logs, referrers, browser history).
- ❌ commit `.env.local`; commit a real value to `.env.example`.
- ❌ reuse prod secrets in Preview/CI.
- ❌ skip webhook signature verification "just for testing" on a deployed URL.

---

### 4.3 Rate-limiting topology

#### What exists

| Aspect | Current |
|---|---|
| Implementation | `src/lib/rate-limit.ts` — fixed-window counter in a module-level `Map` |
| Scope | **per serverless instance**, in memory; resets on deploy and on cold start; not shared across regions or concurrent instances |
| Key | `${action}:${user.id}` (authenticated only; no anon/IP path wired) |
| Response on limit | callers return bare `429 { error: "Too many requests" }` — **no `Retry-After`, no `X-RateLimit-*` headers** |
| Coverage | **3 routes**: `POST /api/knowledge/snap` (10/min), `POST /api/failures/classroom` (20/min), `POST /api/billing/checkout` (10/min) |
| In front of it | Vercel platform DDoS mitigation + (if enabled) Vercel WAF / Firewall rules — L3/L4 and coarse L7, always on regardless of app code |

#### The real ceiling (be honest)

- **Scale-out defeats it.** With N concurrent instances, the effective limit is
  `N × limit`. A burst spread across instances (which Vercel's router does
  naturally) sails through.
- **Deploys reset it.** A frequent-deploy day gives an abuser a fresh budget
  each push.
- **It's fine for what it's for today:** stopping a client bug that retries in a
  `while(true)`, and a single logged-in user hammering one endpoint from one
  tab. At the current ~90-simultaneous-class ceiling and single-region Vercel,
  that is the actual threat. Don't gold-plate past it.

#### Coverage gap — routes that should limit and don't

| Route | Risk | Suggested limit |
|---|---|---|
| `POST /api/knowledge/snap` | ✅ has it (AI cost) | 10/min |
| `POST /api/failures/classroom` | ✅ has it | 20/min |
| `POST /api/billing/checkout` | ✅ has it | 10/min |
| `POST /api/billing/mock/checkout` | mock, but still writes | 10/min |
| `GET /api/export/finance` | heavy query + XLSX build; PII | 5/min |
| `GET /api/export/payments` | heavy query + XLSX build; PII | 5/min |
| `POST /api/livekit/token` | mints room creds; abuse = free SFU minutes | 30/min |
| `POST /api/webhooks/razorpay`, `POST /api/billing/webhook` | signature-verified, so DoS-only; a burst still costs settlement queries | 120/min by **source IP** (not user) |
| inbound n8n/WhatsApp webhook (per `academy_secrets`) | token-guessing, replay | 60/min per token + IP |
| any future mutating route, any AI route | default-deny posture | apply by default |

**Action now (S):** add a tiny helper that returns the standard headers and use
it everywhere:

```ts
// extend rate-limit.ts — same Map, richer return
export function rateLimit(key, limit, windowMs):
  { ok: boolean; remaining: number; resetAt: number }

// in a route:
const rl = rateLimit(`export:${user.id}`, 5, 60_000);
if (!rl.ok) return NextResponse.json(
  { error: "Rate limit exceeded" },
  { status: 429, headers: {
      "Retry-After": String(Math.ceil((rl.resetAt - Date.now())/1000)),
      "X-RateLimit-Limit": "5",
      "X-RateLimit-Remaining": String(rl.remaining),
      "X-RateLimit-Reset": String(Math.floor(rl.resetAt/1000)),
  }});
```

This is the `proyecto26/system-design-skills` "API-design contract" half of rate
limiting — clients (and our own retry logic in `src/lib/ai`) can back off
correctly instead of hammering.

#### Upgrade path — when the in-memory limiter isn't enough

Trigger: **more than one concurrent serverless instance routinely serves the
same user** (multi-region enabled, or sustained traffic past ~1 instance), OR a
real abuse incident that the per-instance limiter demonstrably let through.

| Option | Use when | Cost | Notes |
|---|---|---|---|
| **A. Upstash Redis** (`@upstash/ratelimit`) | you've hit the trigger and want the standard answer | ~$0–10/mo at this scale; new vendor; +1 network hop (~1–5 ms, same-region) | Serverless Redis over HTTP — no connection pool, works from edge/serverless. Sliding-window or token-bucket built in. **Sharded counters** for hot keys (a shared webhook IP) are a config flag. This is the recommended target. |
| **B. Postgres-native** (`rate_limit_hits` table + `check_rate_limit(key,limit,window)` RPC, `security definer`, single `insert … on conflict do update` + prune) | you specifically don't want another vendor/bill and can eat ~5–15 ms per check | $0; +1 DB round-trip; adds write load to the primary | Correct and shared across instances. Downside: every limited request now touches the primary DB — the thing you're trying to protect. Fine for low-QPS routes (exports, AI, webhooks), not for a hot read path. Prune with `pg_cron`. |
| **C. Vercel WAF rate rules** | coarse per-path/per-IP limits, bot filtering, no per-user logic | included on Pro/Ent | Set this up **now regardless** — it's the outer ring (per-IP request caps on `/api/*`, block known bad ASNs). App-level limiter handles per-user/per-action semantics WAF can't see. |

**Decision:** do **C now** (config, no code) + the **429-contract headers now**
(S, code). Do **A** at the trigger. Reach for **B** only if adding Upstash is
blocked for procurement reasons — and even then, only on cold routes.

#### Rate-limit checklist for a new route

- [ ] Mutating, AI-backed, export/PII, or credential-minting? → it gets a limit.
- [ ] Keyed by `user.id` for authed routes; by source IP for webhooks/anon.
- [ ] Returns `429` **with** `Retry-After` + `X-RateLimit-*` headers.
- [ ] Limit chosen from *legitimate* peak use × ~3, not a round number.
- [ ] Webhook routes: limit is DoS-protection only (signature check is the real gate) and keyed by IP so one noisy source can't starve others.
- [ ] Documented in this file's coverage table.

---

**Section 4 standing risks** (rolled up with §5–§6 into the consolidated register, §10):

| Risk | Severity | Fix owner-action |
|---|---|---|
| Prod migrated by hand → client/SQL ship out of sync | **High** | `supabase db push` in CI (S) |
| `realtime.messages` running 4 broad template policies, not the academy-scoped pair | **Med** (cross-tenant channel access) | dashboard: swap templates for `can_join_classroom_channel` policies before 2nd academy |
| `billing_events` has no `provider_event_id` unique constraint → webhook replay double-settles | **Med** | add `unique (provider, provider_event_id)` + `on conflict do nothing` (matches PRODUCTION_READINESS B7) |
| In-memory rate limiter defeated by scale-out; no 429 contract | **Low today / Med at scale** | headers now; Upstash at multi-instance |
| TURN credentials are static and client-visible | **Low** | per-session TURN creds from a server route if abuse appears |
| No `db:verify-rls` gate in CI | **Med** | wire the existing script into CI |

---

## 5. Compute & Async layer

**Scope:** where work runs, what must move off the request path, and the
queue/cache/idempotency/load-test story — right-sized for an all-serverless
app (Next.js on Vercel + Supabase) whose current hard ceiling is ~90
simultaneous live classes (`docs/PRODUCTION_READINESS.md`).

**Guiding rule (system-design-skills → messaging-streaming):** decouple
producers from consumers so a traffic spike or a slow downstream (the AI
model, a PDF parse, an email provider) can't take a user-facing request
down with it. But decoupling has a carrying cost — a queue you drain with
`pg_cron` is free; a hosted queue is a vendor, an SDK, and a dashboard to
watch. Add each rung only when the one below it visibly fails.

---

### 5.1 Job inventory

Every task that is heavy, slow, rate-sensitive, or must survive a failed
request. "Async?" = must it leave the HTTP request path.

| Job | Today | Async? | User-visible latency budget | Retry / failure | Idempotency |
|---|---|---|---|---|---|
| **PDF-crop → FEN** (`services/fen-recognizer`, real CV later) | sync `POST /api/recognize` (stub returns instantly) | **Yes, once the CV model is real** — warp + 64-cell CNN is seconds, and cold-start on a Python host adds more | ≤2 s ideal; ≤15 s acceptable with a spinner | retry x2 on model error, then fall back to AI vision | key by image hash — same crop → same FEN |
| **AI vision "snap whole file → FEN"** (`/api/knowledge/snap`) | sync route, `maxDuration = 60`, `aiComplete()` w/ retry x2 | **Yes at volume** — a 20–60 s model call holds a serverless invocation | ≤10 s good; the 60 s cap is the real limit | already retries 429/5xx x2; on final failure return 422 | key by image hash (see 5.4) |
| **AI coach assistant** (`src/lib/ai`, chat) | sync (streamed to client) | No — interactive, streaming is the right model | first token ≤2 s | user retries manually | none (conversational) |
| **Report / progress-card generation** | rendered on page load / print CSS; no PDF pipeline | **Yes when it becomes a real PDF or a batch** ("email every parent this month's card") | on-demand ≤3 s; batch has no budget | per-student retry, don't fail the batch | one card per (student, month) |
| **Excel exports** (`/api/export/finance`, `/payments`) | sync `GET`, `exceljs` in-request, `.limit(1000)`, CEO-only | No **while capped at 1000 rows** — a few hundred ms. Yes if the cap is lifted or row counts pass ~10k | ≤3 s | user re-clicks | none (read-only snapshot) |
| **Email — invites & password resets** | Supabase Auth built-in SMTP | Already async (Supabase's problem) — but **Supabase default SMTP is rate-limited** (`PRODUCTION_READINESS` B8) | n/a | Supabase retries | Supabase-managed |
| **Email — renewal reminders, progress cards, drip** (`telecrm.ts` `nextDripSendAt`) | **not built** — logic exists, no sender | **Yes** — scheduled, bulk, third-party provider | none (background) | per-recipient retry, dead-letter after 3 | one send per (recipient, template, anchor) |
| **WhatsApp / n8n lead ingestion** (`/api/webhooks/leads`) | **design-spec only** — endpoint not built; only Razorpay + billing webhooks exist | inbound webhook must ack fast (≤1 s) then process async | ≤500 ms ack | n8n retries the webhook; we must be idempotent | key by provider event id (see 5.5) |
| **WhatsApp outbound** (drip, class reminders, "reward the class" nudges) | not built | **Yes** — provider call, rate limits, retries | none | retry x3, dead-letter | one message per (lead, template, trigger) |
| **Demo-session expiry** (`expire_demo_sessions()`) | `pg_cron` `*/30 * * * *` (0006) — **already correct** | already async | n/a | idempotent by design (`where status='scheduled' and expires_at<=now()`) | ✓ |
| **Subscription renewals** (`renew_due_subscriptions()`) | `pg_cron` `0 2 * * *` (0004), row-locked (0033) | already async | n/a | row lock prevents double-charge | ✓ |
| **`live_fen` persistence** (Live Ops wall) | client-side debounced `UPDATE` (≤1/1.5 s per class) | already off the critical path — it's a fire-and-forget write, board sync is on Realtime broadcast, not this | n/a | next debounce tick overwrites | last-write-wins is fine |

**Read of the table:** three jobs are already async and correct (demo
expiry, renewals, live_fen). The rest are either *not built yet* (email
campaigns, WhatsApp, real CV) or *sync and fine for now* (exports, snap at
low volume). Nothing today is both built and mis-architected — so this
section is mostly a **build-it-right-the-first-time** spec, not a rescue.

---

### 5.2 Queue / worker topology — the decision ladder

Climb only as far as the symptoms force you.

#### Rung 1 — Supabase-native (use this now, for everything)

Everything scheduled or deferrable fits one of two patterns already in the
codebase:

**A. Scheduled — `pg_cron` calling a `SECURITY DEFINER` function.**
Precedent: `expire_demo_sessions()`, `renew_due_subscriptions()`. Same shape
for anything time-driven:

```sql
-- renewal reminders: 08:00 daily, dedupe built into the query
select cron.schedule('renewal-reminders', '0 8 * * *',
  $$ select public.enqueue_renewal_reminders() $$);
```

The function does the *selection* (who is due) and writes rows to an outbox
table; a separate drainer does the *sending* (so a flaky email provider
never rolls back the selection).

**B. Deferred work — a Postgres queue drained on a schedule.**
Use **`pgmq`** (Supabase-supported Postgres extension — real queue
semantics: visibility timeout, archive, dead-letter) rather than hand-rolling
a `status` column.

```
producer:  select pgmq.send('fen_jobs', jsonb_build_object('job_id', :id));
drainer:   pg_cron every 10 s  →  Edge Function  →  pgmq.read('fen_jobs', vt=>60, qty=>10)
                                                 →  do work
                                                 →  pgmq.delete / pgmq.archive
```

The *work* runs in a **Supabase Edge Function** (Deno, deployed separately
from the Next app) when it must not hold a Vercel invocation — long CV
parses, provider fan-out. Short work can run inline in the drain route.

**Vercel Cron** is the alternative scheduler if you'd rather the drainer be
a Next route than a pg_cron→Edge hop:

```json
// vercel.json  (does not exist yet — add it)
{ "crons": [{ "path": "/api/jobs/drain", "schedule": "*/1 * * * *" }] }
```

Route guards on `CRON_SECRET` (Vercel sets `Authorization: Bearer $CRON_SECRET`).

**Rung 1 covers:** renewal reminders, progress-card batches, WhatsApp/email
fan-out, the async FEN pipeline (5.3), n8n webhook processing. No new vendor,
no new SDK, observability is `select * from pgmq.q_fen_jobs` + the
`cron.job_run_details` table.

**Rung 1 ceiling:** `pg_cron` minimum interval is ~1 min (sub-minute needs a
self-rescheduling job); no per-job concurrency controls; retry/backoff is
DIY; no fan-out-to-many-steps; the dashboard is SQL. When you're writing
your third bespoke retry loop or someone asks "why did that job run twice",
you've hit it.

#### Rung 2 — a hosted queue (add when Rung 1's ceiling bites)

| Option | Fit here | Verdict |
|---|---|---|
| **Inngest** | Event-driven; step functions with automatic retries, backoff, concurrency limits, fan-out, sleep/cron; runs *as Next API routes* (`/api/inngest`) — zero infra, no worker host; generous free tier; typed SDK; a real dashboard with per-run traces | **Recommended rung-2 default.** It's the one hosted option that doesn't fight the all-serverless model. |
| **Upstash QStash** | HTTP "POST this later / with retries"; dead simple; pairs with Upstash Redis (5.4) and the rate-limiter | Good for *simple* deferred HTTP calls (send one WhatsApp message in 2 h). No step orchestration, thinner observability. Fine as a stepping stone; Inngest supersedes it once you need multi-step. |
| **BullMQ + Redis** | Mature, powerful — **but needs a long-running Node worker process** (Railway/Fly/a container). That's a second deployment target and an always-on cost for an app that is otherwise 100% serverless. | **Rejected for this app.** Only revisit if you already run a persistent Node service for another reason. |

**Jobs that justify moving to Inngest (and the trigger for each):**

| Job | Move when |
|---|---|
| WhatsApp/email campaign fan-out | first time a batch partially fails and you can't tell which recipients got it |
| Real PDF-crop → FEN | the CV model is deployed and p95 parse > 5 s, or you want automatic retry→fallback as one traced flow |
| Progress-card batch ("email all parents") | it's a real feature with >50 recipients per run |
| n8n lead pipeline | lead volume makes "did this lead get assigned + messaged + follow-up-scheduled" a multi-step flow worth tracing |

Everything else stays on `pg_cron` + `pgmq` indefinitely.

#### Rung 3 — dedicated workers / Kafka / RabbitMQ

**Explicitly out of scope.** The signal that would change that: sustained
throughput past what a hosted queue's free/cheap tier allows (Inngest:
~hundreds of thousands of steps/month), *or* a streaming/event-sourcing
requirement (replayable event log, multiple independent consumers of the
same stream). Neither is on the horizon for a chess-academy CRM with a
90-class ceiling. Revisit at ~1,000 concurrent classes or a genuine
analytics-pipeline product line.

---

### 5.3 The PDF-crop → FEN pipeline, made async

Today it's synchronous (fine while the recognizer is a stub). When the real
OpenCV/CNN pipeline lands in `services/fen-recognizer`, make it a job.

**Flow:**

```
1. client crops the diagram (src/components/class/pdf-cropper.tsx)
2. POST /api/recognize { image_b64 }
     → hash the image (sha256)
     → cache hit?  return { fen, confidence, source:'cache' }        (5.4)
     → else: insert fen_jobs row (status='queued'), pgmq.send, return { job_id }
3. drainer (pg_cron 10 s → Edge Function, or Inngest at rung 2)
     → pgmq.read → call services/fen-recognizer → parse
     → update fen_jobs set status='done', fen=…, confidence=…   (or 'failed', error=…)
     → write the (hash → fen) cache entry
4. client learns the result by EITHER:
     a. Realtime: subscribe to postgres_changes on fen_jobs where id=job_id   (preferred — no polling)
     b. poll GET /api/recognize/:job_id every 1.5 s, give up after 20 s
5. on status='failed' OR timeout:
     client falls back to POST /api/knowledge/snap (the existing sync AI-vision route)
     — slower, costs a model call, but always answers
```

**Table:**

```sql
create table fen_jobs (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references academies(id),
  requested_by uuid not null references profiles(id),
  image_hash   text not null,
  status       text not null default 'queued'
               check (status in ('queued','processing','done','failed')),
  fen          text,
  confidence   numeric,
  error        text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
-- RLS: select/insert where academy_id in (my academies); no update from clients
alter table fen_jobs enable row level security;
create policy fen_jobs_read on fen_jobs for select
  using (academy_id = any (public.my_academy_ids()));
create policy fen_jobs_insert on fen_jobs for insert
  with check (requested_by = auth.uid() and academy_id = any (public.my_academy_ids()));
-- the drainer writes with the service role, bypassing RLS
```

**States:** `queued → processing → done` | `queued/processing → failed`.
A job stuck `processing` past the pgmq visibility timeout is re-read and
re-attempted automatically (at-least-once — safe because the write is
idempotent on `image_hash`).

**Why not just keep it sync:** a real 64-cell CNN inference plus a Python
cold-start can blow past a comfortable request budget, and doing it inline
means every crop holds a Vercel invocation and a browser spinner hostage to
the slowest parse. The stub can stay sync until the model is real —
**ponytail: don't build the queue until the CV work that needs it exists.**

---

### 5.4 Caching topology (Redis)

**Store:** **Upstash Redis** — serverless, HTTP-based (no connection pool to
exhaust from serverless functions), same vendor as the rate-limiter (§4), free
tier fits this app. One dependency, two uses.

**What to cache, and how:**

| Data | Key | TTL | Invalidation | Stampede guard |
|---|---|---|---|---|
| **AI snap result** (image → FEN) — *highest value* | `snap:{sha256(image)}` | 30 d | never (deterministic) | single-flight lock `snaplock:{hash}` (SETNX, 60 s) — concurrent identical crops wait on one model call |
| Lichess puzzle API responses | `lichess:puzzle:{theme}` | 6 h | none | jittered TTL ±15 min so themes don't all expire together |
| Master-DB position / opening lookup | `openings:{fen_key}` | 24 h | on DB reimport (bump a version prefix) | jittered TTL |
| Leaderboard / points aggregates | `lb:{academy_id}:{scope}` | 60 s | on points-ledger write (delete key) | short TTL absorbs the stampede |
| `count(*)` fan-out (rosters, enrolments — `PRODUCTION_READINESS` "count-query fan-out") | `cnt:{table}:{academy_id}` | 5 min | on insert/delete to that table (delete key) | short TTL |
| Academy branding / config (logo URL, theme) | `academy:{id}:cfg` | 1 h | on settings save (delete key) | n/a (rarely concurrent) |

**Pattern (single-flight + jitter), ~15 lines, not a library:**

```
get key → hit? return
miss → SET lock NX EX 30
       got lock?  compute, SET key value EX (base ± jitter), DEL lock, return
       no lock?   sleep 200 ms, retry get (bounded ~5 tries), then compute anyway
```

**Never cache:**
- Anything RLS-scoped where a stale or cross-request read could show one
  tenant another tenant's data. Cache **derived, non-sensitive** aggregates
  (a count, a leaderboard the whole academy sees) keyed by `academy_id` —
  never raw row sets, never anything keyed only by `user_id` without the
  academy in the key.
- Auth/session state — that's Supabase's job.
- Live classroom board state — that's Realtime broadcast (§6), ephemeral by
  design, caching it would fight the authoritative-state model.

**Read-through, not write-through:** the app reads cache-or-DB; writes go
straight to Postgres and *delete* the affected keys. No write-through, no
cache as a system of record.

---

### 5.5 Webhook idempotency

`settleBillingEvent()` has **no replay guard** (`PRODUCTION_READINESS` B7) —
Razorpay (and n8n, when built) retry on any non-2xx or timeout, and a
retried `payment.captured` currently re-runs the settlement.

**Fix — one table, one insert, works for every provider:**

```sql
create table webhook_events (
  provider   text not null,          -- 'razorpay' | 'n8n' | …
  event_id   text not null,          -- provider's own event id
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
```

```ts
// at the top of every webhook receiver, after signature verification:
const { error } = await admin
  .from("webhook_events")
  .insert({ provider, event_id: event.id });
if (error?.code === "23505") return Response.json({ ok: true, duplicate: true }); // seen it
// ... proceed to settleBillingEvent(event, provider)
```

Signature-verify **first** (reject forgeries before touching the table), then
dedupe, then process. Return `200` on a duplicate so the provider stops
retrying. Add a `pg_cron` job to prune `webhook_events` older than 90 days.

---

### 5.6 Load testing (before any launch or capacity claim)

**Tool:** **k6** (scriptable in JS, good WebSocket support for the Realtime
test, CI-friendly). Artillery is an acceptable alternative.

**Scenarios & thresholds:**

| Scenario | Setup | Pass criteria |
|---|---|---|
| **Auth burst** | 500 concurrent sign-ins over 60 s | p95 < 2 s, error rate < 1%, no Supabase Auth 429s |
| **Concurrent live classes** | ramp WebSocket connections to the Realtime channel; **stop at 90 classes / 180 connections** on Free tier | all channels `SUBSCRIBED`, broadcast round-trip p95 < 500 ms, zero channel drops. **Do not run past 180 connections until Supabase Pro is confirmed on the production project** — the Free ceiling is 200 and it's a hard wall (`PRODUCTION_READINESS`). |
| **AI route under burst** | 50 rapid `POST /api/knowledge/snap` from one user, then from 20 users | the per-user rate-limiter returns 429 with `Retry-After` (not a 500); cross-user requests still succeed; no unbounded model spend |
| **Webhook replay** | POST the same Razorpay `payment.captured` 20× | exactly one settlement; 19 responses are `200 {duplicate:true}` |
| **Export under size** | `/api/export/finance` for an academy near the 1000-row cap | p95 < 3 s; if it's over, that's the signal to make exports a job (§5.2) |
| **Cron drain backlog** | seed 1,000 rows into `pgmq.q_fen_jobs`, watch the drainer | queue drains to zero within N intervals; no job processed twice; failures land in the archive/DLQ |

**Rule (from `PRODUCTION_READINESS`):** no capacity number above **90
simultaneous classes** may be quoted to a customer until the load test has
been re-run at the higher target against a project confirmed on Supabase Pro
or higher. "Verified correct" is not "verified under load."

**When:** in CI as a smoke test (small numbers, catch regressions) + a full
manual run before each launch milestone and before raising any published
capacity figure.

---

### 5.7 Summary — what to do, in order

| # | Action | Rung | Blocking? |
|---|---|---|---|
| 1 | `webhook_events` dedupe table + guard in `settleBillingEvent` | native | **before real payment volume** (B7) |
| 2 | `vercel.json` cron + `/api/jobs/drain` guarded by `CRON_SECRET`; move `expire_demo_sessions` / renewals onto a real schedule if not already live in prod | native | before launch |
| 3 | Upstash Redis: rate-limiter (§4) + snap-result cache + count-fan-out cache | native + 1 dep | before scale-out |
| 4 | `enqueue_renewal_reminders()` → outbox → drainer; wire a real email provider (also fixes B8) | native | when renewal reminders become a feature |
| 5 | Async `fen_jobs` pipeline (`pgmq` + Edge Function) | native | **when the real CV model ships**, not before |
| 6 | k6 load-test suite; do not exceed the 90-class claim | — | before any launch |
| 7 | Adopt **Inngest** for campaign fan-out / multi-step flows | rung 2 | when a batch first fails opaquely |
| 8 | Dedicated workers / streaming | rung 3 | ~1,000 concurrent classes or a real analytics product |

---

## 6. Real-Time & State layer

**Scope of this section:** the boundary between request/response transports (REST
route handlers, RLS'd Supabase queries) and push transports (Supabase Realtime
broadcast, Realtime `postgres_changes`, WebRTC data), and the authority model for
classroom state — who is allowed to decide "this is the position now", "this
answer was correct", "this game was won".

**One rule underneath everything here:**

> A payload that arrives over a broadcast channel is a *claim from a peer*, not a
> fact. Anything that must persist, must be authorized, or affects points /
> ratings / money is written through a REST route or an RLS'd insert where the
> server (Postgres policy or route handler) is the last word. Broadcast carries
> ephemeral coordination only.

---

### 6.1 Transport boundary matrix

Transports in use:

| Tag | Transport | Durable? | Authorized by |
|---|---|---|---|
| `REST` | Next.js route handler (`src/app/api/**`) | as written | route code + `supabase.auth.getUser()` + RLS on its writes |
| `QUERY` | `supabase-js` query from the client, straight to PostgREST | yes (it *is* the DB) | RLS policies on the table |
| `BCAST` | Supabase Realtime **broadcast** event on a `private: true` channel | **no** — lives in the channel, gone when the room empties | RLS on `realtime.messages` (channel-name → membership), set by migration |
| `PGCHANGES` | Supabase Realtime **`postgres_changes`** subscription | yes (mirrors a real table) | RLS on the source table + publication |
| `WEBRTC` | P2P `RTCDataChannel` / media, peer-to-peer | no | nothing — signalling is authorized (`BCAST` on `mesh-video:<id>`), media is not |

| Data type | Transport | Persisted where | Authoritative writer | On reconnect |
|---|---|---|---|---|
| Auth / session | `REST` (`@supabase/ssr`, `proxy.ts`) | `auth.*` | Supabase Auth | cookie refresh in `proxy.ts` |
| Profile / academy / batch CRUD | `QUERY` | `profiles`, `academies`, `batches` | Postgres + RLS | re-query |
| Billing / invoices / subscriptions | `REST` (`/api/billing/*`, `/api/webhooks/razorpay`) + `QUERY` reads | `invoices`, `subscriptions`, `billing_*` | route handler w/ service role, signature-verified | re-query |
| PGN library | `QUERY` (+ Storage for blobs) | `pgns`, `pgn_folders`, `sources` bucket | Postgres + RLS | re-query |
| Homework / quiz **submission** (graded) | `QUERY` insert under RLS *(target: `REST` — see 6.2)* | `points_ledger`, homework tables | **currently the client** — gap | re-query |
| Master DB / position search | `QUERY` (read-only) *(cache candidate — §5)* | read model | n/a | re-query |
| Classroom **board move** | `BCAST` `board` | not persisted; `classrooms.live_fen` is a *debounced mirror* for the wall only | **coach's browser** (runs `chess.js`) | coach re-broadcasts full snapshot on roster growth |
| Classroom chat | `BCAST` `chat` **+** `QUERY` insert to `classroom_messages` | `classroom_messages` (history) | sender's client writes its own row (RLS gates academy/membership) | history re-loaded from table, live tail from channel |
| Annotations (arrows / highlights) | `BCAST` `annotation` | not persisted | coach's browser | lost on reconnect until next coach action |
| Quiz start / end | `BCAST` `quiz` (`active` flag) | not persisted | coach's browser | coach re-sends active quiz on roster growth |
| Quiz **answers** | `BCAST` `quiz_answer` `{san, correct, ms}` | `points_ledger` on quiz end | **student's browser self-reports `correct`** — gap (6.2) | in-flight answers can be lost |
| Whiteboard strokes | `BCAST` `whiteboard` (0..1 fractions) | not persisted | whoever holds the pen (coach, or a student the coach permitted) | canvas is blank until redrawn |
| Reward / "chocolate" pop | `BCAST` `reward` | not persisted (optionally `points_ledger` if a reward carries points) | coach's browser | missed pops are fine — cosmetic |
| `simul_game` mirror | `BCAST` `simul_game` keyed by `studentId` **on the shared `class:<id>` channel** | not persisted | each student's browser mirrors its own board | coach's grid re-populates as students re-send |
| Video signalling (SDP / ICE) | `BCAST` on `mesh-video:<id>` | no | deterministic offerer (`shouldOffer`) | peers re-negotiate |
| Video media | `WEBRTC` mesh, STUN + TURN | no | n/a | ICE restart |
| `live_fen` wall (Live Ops) | `PGCHANGES` — **one** subscription on `classrooms` | `classrooms.live_fen`, `live_updated_at` | coach's debounced write (≤1/1.5s) | Supabase re-fires `SUBSCRIBED`; page re-snapshots |
| Help requests | `QUERY` insert + `PGCHANGES` on `help_requests` | `help_requests` | requester's client (RLS), claim is a conditional `UPDATE` (optimistic lock) | re-query on `SUBSCRIBED` |
| Presence / roster | Realtime **presence** on `class:<id>` | no | each client tracks its own presence | presence `sync` re-fires |

**Reading the matrix:** everything that must survive a refresh is `QUERY` or
`PGCHANGES` against a real, RLS'd table. Everything on `BCAST` is either
(a) cosmetic, (b) coordination that the coach re-derives and re-sends, or
(c) **a known integrity gap** (graded quiz answers — 6.2). Chat is the model to
copy when a broadcast stream *also* needs history: write the row (RLS'd),
broadcast the tail, re-load the table on reconnect.

---

### 6.2 Authoritative classroom state manager

#### What exists today (document it honestly)

The **coach's browser is the authority** for the shared teaching board:

- It owns the `chess.js` instance (`chessRef`).
- It builds `syncRef.current` — the full `SyncState` snapshot (fen, history,
  sides, locked, coords, gamify, free, icons, simulActive) — and every
  `broadcast()` sends the *entire* merged snapshot, never a diff.
- It holds the answer line privately in `loadedGameRef` and **never broadcasts
  it**, so a student cannot read the solution off the wire… *for a loaded PGN.*
- On roster growth it re-broadcasts, so late joiners converge.

**Strengths:** zero server compute, no authoritative backend to run or scale, no
consensus protocol. For a *teaching* board — where the coach is a trusted human
driving the lesson — this is a legitimate and good design. Keep it.

**Weaknesses (all real, all client-trust):**

| Gap | How it's exploitable today | Blast radius |
|---|---|---|
| Any peer can send `board` | A tampered student client calls `sendBoard(fakeSnapshot)`; every other client renders it | Disruptive, not scored — coach's next action overwrites it. Low. |
| Quiz answer `correct` is **self-reported** | `QuizEvent.answer` (the solution SAN) **is in the `quiz` broadcast payload** → any student can read it in devtools *and* `quiz_answer` carries a client-computed `correct` + `ms`. A tampered client claims `correct:true, ms:1`. The coach's client believes it and, on `endQuiz`, writes `points_ledger`. | **Points integrity.** `0029` RLS stops cross-academy / non-student targets and requires the caller be staff, but it does **not** validate the amount or that the answer was actually correct. Medium–high once points matter. |
| Roadblock / obstacle rule is client-only | `NONCAPTURABLE_ICON_IDS` is enforced only in the coach's `onFreeMove`; a student sending a raw `board` snapshot can place a piece on a roadblock square | Cosmetic on a teaching board; matters if obstacles ever gate a graded puzzle. |
| Simul `simul_game` is student-reported | Each student mirrors *its own* board; nothing checks the FEN is reachable | Fine for a monitoring grid; **not** fine if simul results are ever rated. |

#### The line

```
                      client-authoritative OK          server-authoritative REQUIRED
                      ─────────────────────────        ────────────────────────────────
 teaching board move           ✓
 annotations, whiteboard       ✓
 reward pop (cosmetic)         ✓
 simul monitoring grid         ✓
 ────────────────────────────────────────────────────────────────────────────────────
 quiz points                                            ✓  (coach-scored now, RPC later)
 homework / assignment grade                            ✓
 rated game result                                      ✓
 tournament pairing + result                            ✓
 anything that writes points_ledger / ratings           ✓
```

#### Hardening path — **no rewrite**, three graded steps

**Step A — students send intents, not states (small diff, do now).**
- `quiz_answer` payload becomes `{ quizId, userId, name, san, ms }` — **drop
  `correct`**.
- Remove `answer` from the `QuizEvent` that goes on the `quiz` broadcast. The
  coach keeps the solution in a private ref (same pattern as `loadedGameRef`).
- The coach's client scores each incoming answer with the existing
  `isCorrectAnswer(fen, san, answer)` — it already has this function; it's just
  reading the wrong copy of the answer today.
- Net effect: a student can no longer read the solution, and can no longer
  self-declare correct. `ms` is still client-clock (see Step C for when that
  matters).
- Same shape for a future rated intent: students send `{ from, to, promotion }`,
  the coach's client is the only writer of the `board` event, and it validates
  with `chess.js` **+** the roadblock rule before accepting.

**Step B — move the graded write off the coach's browser (medium).**
Quiz-end scoring currently does `supabase.from("points_ledger").insert(...)`
straight from the coach's client. Replace with a single RPC:

```
score_quiz(quiz_id uuid, answers jsonb)  -- security definer
  -- re-derives correct/incorrect server-side from the stored quiz + FEN,
  -- ignores any client-sent verdict, writes points_ledger in one transaction,
  -- idempotent on quiz_id (a quiz scores exactly once).
```

The quiz's `fen` + `answer` live in a `quizzes` row (created when the coach
starts it) so the function has an authoritative copy. The coach's client just
forwards the collected `{userId, san, ms}` list.

**Step C — server move-validation for rated / tournament play (larger, only when
that feature ships).**
Rated games and tournament results must not be decidable by any browser. Pattern:

- Each move is a `REST` POST (or Realtime "send-and-ack" to an Edge Function),
  never a bare `BCAST`.
- The server re-runs the rules engine (`chess.js` in an Edge Function, or a
  Postgres port) from the last *server-recorded* position, applies the move,
  writes it to a `game_moves` table under RLS.
- Clocks are server-authoritative: the move timestamp is the server's, not
  `Date.now()` on the client.
- Result (win/draw/loss, rating delta) is computed and written by the same
  server path. The client is told the result; it never asserts it.
- Broadcast is still used — but only to *notify* peers "position N is now X",
  which they then confirm by reading the `game_moves` table (or trusting the
  notification for rendering while the authoritative copy is the table).

This is the same shape as the billing webhook: untrusted input → verify →
write with elevated privilege → the DB row is the truth.

---

### 6.3 Custom-obstacle / gamified-rule integrity

**The rules that aren't standard chess:**

| Rule | Where it lives now | Enforced where |
|---|---|---|
| "Roadblock" stickers are non-capturable | `NONCAPTURABLE_ICON_IDS` in `src/lib/gamified-icons.tsx` | coach's `onFreeMove` only |
| Gamified setups are usually *illegal* FENs (no kings) → allowed in Free Move | `isRenderableFen()` in `src/lib/chess-pure.ts` | client render + broadcast decision |
| Stickers travel with their square's contents, not as pieces | `onFreeMove` icon-map logic | coach's client |

`chess-pure.ts` already exists precisely so this logic has **no React/DOM
imports and runs under `node --test`**. That is the right home. The rule:

> Every gamified-rule predicate lives in `chess-pure.ts` (or a sibling pure
> module). The client imports it. Any future server validator (Edge Function,
> RPC via a JS runtime) imports the **same file**. There is exactly one
> definition of "can this piece land here".

**Risk if only the client enforces it:** today, nil — the teaching board is
cosmetic and the coach overwrites. The moment an obstacle gates a *graded*
puzzle ("solve without capturing the blocked pawn → +10 points"), a tampered
client that ignores `NONCAPTURABLE_ICON_IDS` mints points. **Fix:** the Step-B
`score_quiz` RPC (and any rated path) must call the same pure predicate
server-side before awarding. No new rule engine — the same `chess-pure.ts`
function, invoked where the write actually happens.

---

### 6.4 Reconnect, late joiners, split-brain

| Scenario | Mechanism today | Gap | Mitigation / future |
|---|---|---|---|
| **Late joiner** (student opens a class already in progress) | Coach's `useEffect` on `roster.length > rosterSize.current` → `broadcast()` full snapshot + re-`sendQuiz` any active quiz | Depends on the coach being connected and on presence `sync` firing before the student's board renders | Works in practice; a server snapshot (6.4 future) removes the coach dependency |
| **Student reconnect** (flaky wifi) | Channel auto-rejoins; next coach `broadcast()` re-syncs the board; `classroom_messages` re-loaded from table for chat history | Annotations, whiteboard, in-flight quiz answers between drop and rejoin are lost | Acceptable for teaching; chat (the one with history) already handles it right |
| **Coach reconnect** | Same auto-rejoin; coach's `chessRef` is still in memory (same tab) so authority is intact on rejoin | If the coach *refreshes*, `chessRef` resets to start position and the next broadcast wipes the class board | Coach could persist `SyncState` to `sessionStorage` on unload; or the server-snapshot path below |
| **Coach disconnects mid-class** (closes tab / crash) | **No authority → board frozen.** `BCAST` state evaporates; `live_fen` on the wall goes stale | This is the real split-brain: students see a frozen board, no error, and no one can move it | `BoardFreshness` on the Live Ops wall already flags "board idle Nm" so a manager *sees* it; a manager can `Join Class` (Live Ops) and becomes a fallback driver. **Future:** persist the authoritative `SyncState` to a `classroom_state` row on every coach broadcast (debounced, like `live_fen` already is) so a rejoining coach or a manager restores from the DB instead of the start position. This is a ~1 table + reuse-the-existing-debounce change, not a new subsystem. |
| **Two authorities** (manager joins while coach still live) | Manager view is read-only by default (`spectate` / `isAdminViewer`); only `Join Class` from Live Ops promotes them, and that's a deliberate takeover | Low — the promotion is explicit and rare | Keep it explicit; never auto-elect |

**Rule:** there is always exactly one authority for a given class, and it is a
human decision who it is (the assigned coach, or a manager who explicitly took
over). No automatic coach-election — a 3-second election window during a lesson
is worse than a 3-second frozen board that a manager can see and fix.

---

### 6.5 Realtime scale — the ceiling and the pattern

**The hard numbers (from `docs/PRODUCTION_READINESS.md`, do not restate them
larger elsewhere):**

- Supabase **Free Tier caps at 200 concurrent Realtime connections.** Hard wall.
- A live class uses **~2 connections** (coach + one student; +1 per extra
  participant, and the mesh-video channel is separate again).
- **Safe operating ceiling today: 90 simultaneous classes (~180 connections).**
  Do not load-test past this or quote a higher capacity number until Supabase
  **Pro** is confirmed active on the production project.

**The pattern that keeps us under the ceiling — copy it everywhere:**

| Do | Don't |
|---|---|
| Live Ops watches *every* class through **one** `postgres_changes` subscription on `classrooms` | one subscription per class card |
| Simul mirrors N students through **one** `simul_game` event stream on the existing `class:<id>` channel, keyed by `studentId` | `class:<id>:game:<studentId>` — a channel per student (also needs a new hand-applied RLS policy → goes dark, see §4) |
| Multiplex sub-entities as **keyed events on a channel that already exists and is already authorized** | open a new channel per board / per widget / per tab |
| Mesh video gets its own channel (`mesh-video:<id>`) because it's a genuinely different lifecycle and payload | fold video signalling into the class channel and couple their failure modes |

**Rule:** *never open a Realtime channel per sub-entity.* One channel per
logical room, keyed events inside it. Every channel you open is 1 connection ×
every participant against a 200-connection wall.

**When the wall actually bites** (sustained >90 concurrent classes on Pro, or a
single class with >50 participants): the move is **not** a different realtime
vendor. It's (a) confirm the Supabase tier headroom, (b) for very large classes,
switch that class's video from mesh to an SFU (`live-room.tsx` / LiveKit is
already in the repo, unreferenced, as exactly this swap), and (c) collapse
chat + quiz + annotations onto even fewer events. Kafka / self-hosted
socket.io / a bespoke WebSocket tier are all more operational surface than this
product's scale justifies — name that only if class concurrency crosses
~1,000 and Supabase Pro's limits are genuinely exhausted.

---

### 6.6 What this section asks the rest of the architecture for

1. A `quizzes` table (id, classroom_id, fen, answer, points, negative,
   created_by) so the quiz solution has an authoritative home and Step-B
   scoring is possible. RLS: coach-of-that-class writes, nobody reads `answer`
   except via the scoring RPC.
2. A `score_quiz(quiz_id, answers jsonb)` security-definer RPC (§6.2 Step B),
   idempotent on `quiz_id`.
3. `chess-pure.ts` stays import-clean (no React/DOM) and becomes the shared
   rules module for any server validator.
4. *(When rated play ships)* a `game_moves` + `games` schema with
   server-authoritative move validation and clocks (§6.2 Step C) — REST or
   Edge Function, never bare broadcast.
5. *(Optional, closes the coach-disconnect gap)* a `classroom_state` row
   written on the same debounce as `live_fen`, so authority can be restored
   from the DB.

---

## 7. Infrastructure choices

One row per concern. "Now" is the smallest correct choice; "Upgrade trigger" is the measured
signal that justifies the next column.

| Concern | Now [EXISTS/ADD] | Upgrade trigger | Then |
|---|---|---|---|
| Hosting / compute | Vercel serverless + Edge | Sustained work >60s, or need for warm state | Add a dedicated worker (Railway/Fly) for that one job only |
| Database | Supabase Postgres (single region) | Read replica lag on dashboards, or >80% CPU sustained | Supabase read replicas; `organization_stats` view first |
| Tenant isolation | Postgres RLS on `academy_id` | Never change — this is the security model | — |
| AuthN/Z | Supabase Auth (JWT) + `proxy.ts` gate + RLS | SSO / SCIM demand from enterprise buyers | Supabase SAML (Pro) |
| Rate limiting | In-memory fixed-window, 3 routes **[GAP B6]** → **[ADD]** all mutating/AI/export routes + `Retry-After` | Multi-region deploy, or abuse that spans instances | Upstash Redis sliding-window (sharded counters) |
| Caching | **none [GAP]** → **[ADD]** Upstash Redis for AI-snap-by-hash, Lichess, aggregates | First measurable repeat-cost (AI spend, slow dashboard) | Same; add Postgres materialized views for heavy aggregates |
| Async jobs | synchronous **[GAP]** → **[ADD]** `pgmq` + `pg_cron` / Vercel Cron drain; Edge Functions for the work | Retries, concurrency limits, fan-out, or observability needs outgrow SQL | **Inngest** (event-driven, step retries, no infra) |
| Board recognition | `services/fen-recognizer` FastAPI (stub) + AI fallback | Real CV model + volume | Deploy the FastAPI service (Fly/Render) behind the queue |
| Classroom A/V | P2P mesh WebRTC (STUN + public/own TURN) | Classes routinely >8 participants, or NAT failures | LiveKit (SFU) — `live-room.tsx` is the ready swap |
| Realtime | Supabase Realtime (broadcast + postgres_changes) | Approaching 180 concurrent connections | Supabase Pro (raises the connection cap); keep the one-channel pattern |
| Engine | Stockfish 17.1 WASM, client, single-thread | Need deeper server-side analysis for rated play | A small engine microservice behind the queue |
| Secrets | Vercel env + Supabase dashboard, server-only | Compliance / rotation cadence | Vercel + a secrets manager (Doppler/Infisical) if the team grows |
| Error monitoring | **reserved, not wired [GAP B5]** → **[ADD]** Sentry | Before *any* production launch | — |
| CI/CD | **none [GAP B4]** → **[ADD]** GitHub Actions: lint + typecheck + test + build + `verify-rls.sql` | Before *any* production launch | — |
| Load testing | **not done [GAP B9]** → **[ADD]** k6 in CI, staged | Before claiming any capacity number | — |

### 7.1 Vendors deliberately NOT adopted

| Not adopting | Why |
|---|---|
| Kafka / RabbitMQ / SQS | No high-throughput streaming workload exists; `pgmq` → Inngest covers every real need through 100× current volume. |
| Self-hosted Redis + BullMQ | Needs a long-running worker host; this is an all-serverless app. Upstash (HTTP Redis) gives the cache + rate-limit value with zero ops. |
| A separate API gateway (Kong/Tyk) | Vercel Edge + `proxy.ts` + per-route rate limits is the gateway. One more hop buys nothing here. |
| GraphQL layer | REST route handlers + the Supabase client (which *is* a typed data API under RLS) already cover both styles. No client needs a graph resolver. |
| Multi-region active-active DB | Single-region p99 is fine for the user base; the cost and consistency complexity are not justified. |
| Kubernetes | Nothing here is a long-running container fleet. |

---

## 8. Adoption sequence

Ordered by dependency and launch risk. Tied to `docs/PRODUCTION_READINESS.md` blockers.

**Phase 0 — launch prerequisites (do before any real users)**
1. CI/CD: GitHub Actions running `lint · typecheck · test · build · verify-rls.sql` on every PR. **[B4]**
2. Wire Sentry (DSN already reserved). **[B5]**
3. Webhook idempotency table + guard for Razorpay (and the leads endpoint when built). **[B7]**
4. Rate-limit contract: add `Retry-After` + `X-RateLimit-*` headers; extend `rateLimit()` to every
   mutating, AI, and export route. Still in-memory — that is acceptable single-region. **[B6]**
5. Production SMTP configured (Supabase default is throttled). **[B8]**
6. Confirm the Supabase Realtime tier vs the intended concurrent-class number; until Pro is
   confirmed, the capacity claim is **90 classes**. **[B9]**

**Phase 1 — decouple the heavy paths**
7. `webhook_events`, `fen_jobs` tables + `pgmq` queue + a `pg_cron`/Vercel-Cron drain route.
8. Move AI-snap, PDF-parse, report generation, and email sends behind the queue.
9. Add Upstash Redis: AI-snap-by-image-hash cache (highest ROI), Lichess puzzle cache,
   dashboard-aggregate cache. Same Redis backs the scale-out rate limiter when needed.

**Phase 2 — harden state authority**
10. Students send move **intents**; the coach client is the sole writer of the `board` event.
11. Quiz answers scored server-side against the coach's held solution.
12. Rated games / tournament results validated by a Postgres RPC or Edge Function that re-runs
    the rules engine — the client cannot fabricate a win.
13. Move the shared rule set (legal moves + roadblock/obstacle rules) into `chess-pure.ts` so the
    client and the server validator agree by construction.

**Phase 3 — scale-out (only on a measured trigger)**
14. Supabase Pro + read replicas; `organization_stats` view.
15. Inngest for jobs that outgrew `pgmq` (concurrency caps, step retries, fan-out).
16. LiveKit swap if classes routinely exceed mesh's comfortable size.

---

## 9. Explicit assumptions (revisit if any breaks)

| # | Assumption | If it breaks |
|---|---|---|
| A1 | ≤ ~90 concurrent live classes until Supabase Pro is confirmed on the production project | Realtime hits the 200-connection wall — hard failure, not slow |
| A2 | Prod DB migrations are applied **by hand** and can lag the repo | A client change that needs a policy ships half of itself — pair every client PR with its migration and verify prod (`select … from pg_policies`) |
| A3 | The coach's browser is a trustworthy authority for the *teaching* board | Fine for teaching; **not** fine for rated/graded outcomes — those need §6.2 server validation |
| A4 | Classroom video stays small enough for P2P mesh (≤ ~8 streams) | Swap to LiveKit SFU (`live-room.tsx`) |
| A5 | AI spend is dominated by repeated identical inputs (same crop, same PDF) | The by-hash cache stops paying off — profile real spend before adding more |
| A6 | Single region latency is acceptable for all users | Add read replicas / edge caching for the affected surface only |
| A7 | `live_fen` writer stays debounced ≥1.5s and Live-Ops viewers are bounded | The writers×viewers fan-out multiplier on one hot table becomes the bottleneck — add a server-side 2s throttle |

---

## 10. Consolidated risk register

Pulled from §4–§6. Ordered by severity. "Phase" points at §8.

| # | Risk | Severity | Fix | Phase |
|---|---|---|---|---|
| R1 | Prod DB migrated by hand → a client PR that needs a policy ships only half of itself (this is how the classroom went dark once, `0032`) | **High** | `supabase db push` in CI on merge to `master`; until then a `PENDING_MIGRATIONS.md` at repo root | 0 → 1 |
| R2 | Graded quiz answers are self-reported: the solution SAN is in the `quiz` broadcast and `correct` comes from the student's client; the coach writes `points_ledger` on trust | **High** (once points matter) | §6.2 Step A+B — students send `{san, ms}` intents, coach scores against a private copy, then a `score_quiz` RPC re-derives server-side | 2 |
| R3 | No CI/CD and no error monitoring — a bad deploy or a prod-only RLS edge case surfaces as silent user pain (`PRODUCTION_READINESS` B4/B5) | **High** | GitHub Actions (lint·typecheck·test·build·verify-rls) + wire Sentry (DSN reserved) | 0 |
| R4 | `realtime.messages` is running 4 broad template policies, not the academy-scoped `can_join_classroom_channel` pair — a logged-in student of academy A can reach a channel in academy B | **Medium** | dashboard → Realtime → Policies: replace templates with the scoped pair, before a 2nd real academy | 0 |
| R5 | `billing_events` / `settleBillingEvent()` has no replay guard — a retried Razorpay `payment.captured` re-settles (`PRODUCTION_READINESS` B7) | **Medium** | `webhook_events(provider,event_id)` unique table + insert-or-ignore before settlement (§5.5) | 0 |
| R6 | Heavy work (AI vision, PDF parse, exports, email, WhatsApp) runs synchronously in the request — a slow model or provider ties up an invocation and the user's spinner | **Medium** | §5.2–5.3 — `pgmq` + `pg_cron`/Vercel-Cron drain, Edge Functions for the work; Inngest at rung 2 | 1 |
| R7 | No caching layer — identical AI-snap crops, Lichess puzzles, and dashboard `count(*)` fan-out all re-computed every time | **Medium** (cost + latency) | Upstash Redis; image-hash→FEN cache with single-flight is the highest ROI (§5.4) | 1 |
| R8 | In-memory rate limiter is defeated by scale-out and resets on deploy; no `Retry-After`/`X-RateLimit-*` contract; only 3 routes covered | **Low today / Medium at scale** | 429-contract headers + extend to all mutating/AI/export/webhook routes **now** (small); Upstash sliding-window at multi-instance (§4.3) | 0 → 3 |
| R9 | Coach disconnects mid-class → no authority, board frozen, `live_fen` stale; students see no error | **Medium** | `BoardFreshness` already flags it + a manager can take over from Live Ops; future: persist `SyncState` to a `classroom_state` row on the existing debounce (§6.4) | 2 |
| R10 | Roadblock / obstacle rule enforced only in the coach's client; a raw `board` snapshot bypasses it | **Low** (cosmetic on a teaching board) | keep the rule in `chess-pure.ts`; any server validator (`score_quiz`, rated play) imports the same predicate (§6.3) | 2 |
| R11 | TURN credentials are static and client-visible | **Low** | per-session TURN creds from a server route if abuse appears | — |
| R12 | No load test — no capacity claim above 90 classes is defensible (`PRODUCTION_READINESS` B9) | **Medium** | k6 suite in CI + a full run before each launch milestone; hold the 90-class line until Supabase Pro is confirmed (§5.6) | 0 |

---

## Sources

- [`proyecto26/system-design-skills`](https://github.com/proyecto26/system-design-skills) — the 22 building blocks / 7 layers this document's principles (§2) are adapted from.
- *"How to not get hacked when vibe coding an app"*, Erik Cupsa (YouTube Shorts) — the six production requirements tracked in §2.1.
- In-repo: `docs/ARCHITECTURE_V2.md`, `docs/ARCHITECTURAL_REVIEW.md`, `docs/PRODUCTION_READINESS.md`, `docs/telecrm-architecture.md`, `docs/FUTURE_RECOMMENDATIONS.md`, and the `supabase/migrations/` history (through `0036`).
