# Architecture V2 - Enterprise Chess Academy OS

Evolution of the ChessPlay-parity platform into an academy operating system:
granular manager permissions, a leads CRM with n8n ingestion, automated demo
sessions, a lichess-style live-operations view, and Razorpay billing. Every
subsystem reuses the existing stack (Next.js App Router, Supabase RLS-first,
Realtime broadcast, the shared `ChessBoard`) - nothing working is rewritten.

## 1. Database schema (migration `0006_enterprise.sql`)

```
manager_permissions -- boolean flags, decoupled from title strings
 profile_id uuid PK → profiles
 academy_id uuid → academies
 title text -- "HR Manager", "Class Manager", … display only
 can_manage_leads bool
 can_view_billing bool
 can_schedule_classes bool
 can_manage_students bool
 can_view_reports bool
 can_run_demos bool

leads -- CRM pipeline
 id, academy_id, name, contact jsonb {email,phone,whatsapp}
 source text -- 'meta_ads'|'google_form'|'website'|'whatsapp'|'calendly'|'webhook'|'manual'
 status text CHECK ('new','qualified','assigned','demo','trial','enrolled','lost')
 assigned_to uuid → profiles -- owning manager
 student_id uuid → profiles -- set on enrollment
 created_at, updated_at

lead_events -- unified notes + activity + assignment log
 id, lead_id → leads (cascade), academy_id
 kind text ('note','status','assignment','webhook','demo')
 actor_id uuid, body text, meta jsonb, created_at

demo_sessions -- transactional sandbox cycle
 id, academy_id, lead_id → leads, coach_id, classroom_id → classrooms
 invite_id → invites -- the provisioned temp-student credential
 status ('scheduled','converted','expired')
 expires_at timestamptz, created_at

classrooms + live_fen text, live_updated_at timestamptz -- live-ops state
academies + webhook_token text (unguessable, per-academy) + gstin text
invoices + gstin text, tax_rate numeric, tax_inr numeric -- GST-ready
subscriptions/billing_* : unchanged (0004) - Razorpay is a new provider module
```

`expire_demo_sessions()` (security-definer, staff- or pg_cron-invoked) marks
lapsed demos expired, deletes their unclaimed invites, cancels their
classrooms, and removes claimed-but-unconverted temp profiles.

## 2. Permission matrix
| Flag | Grants | Enforced by |
|---|---|---|
| (role=ceo) | everything below, always | `my_role()='ceo'` |
| `can_manage_leads` | see/edit ALL academy leads, reassign | RLS on `leads` |
| - (any manager) | see/edit leads **assigned to them** | `assigned_to = auth.uid()` |
| `can_view_billing` | invoices/subscriptions pages | RLS (0004 policies widened) + UI |
| `can_schedule_classes` | create classrooms for any coach | UI gate (RLS staff-write already permits) |
| `can_manage_students` | Academy user management | UI gate |
| `can_view_reports` | Report + Org metrics | UI gate |
| `can_run_demos` | create/convert demo sessions | RLS on `demo_sessions` |

SQL helper: `public.my_perm(flag text) → bool` - true for CEO, looks up the
manager's row otherwise; coaches/students → false. Titles are display-only;
**no code ever string-matches a title**.

## 3. Realtime topology

```
Classroom sync (existing, unchanged)
 coach/students ⇄ broadcast channel class:<id> (moves, chat, annotations, presence)

Live-ops persistence (new, write path)
 coach client ── throttled UPDATE classrooms.live_fen ──▶ Postgres

Live-ops fan-out (new, read path - ONE channel total)
 CEO/Manager page ── single `postgres_changes` subscription
 on UPDATE public.classrooms (academy filter) ──▶ patches N mini boards
```

- Mini boards are **static DOM grids built from FEN + in-repo piece SVGs**
 (same technique as the landing hero): zero chessground instances, zero
 websockets per board. One subscription serves any number of boards.
- Writer throttles to ≥2 s between updates - a busy academy with 50 live
 classes produces ≤25 row-updates/s, well inside Realtime limits.
- **Silent spectate**: `?spectate=1` joins the class channel with
 `presence.track()` skipped and all send functions disabled - spectators
 receive board/chat state but never appear in rosters, never auto-assign
 sides, never mutate classroom state.

## 4. Webhook ingestion (`/api/webhooks/leads`) - n8n blueprint

Endpoint (force-dynamic, public path, service-role writes):

```
POST /api/webhooks/leads
 x-academy-token: <academies.webhook_token> ← the credential
 { "name": "Asha Rao", required
 "email": "asha@x.com", "phone": "+91…", ≥1 contact field required
 "source": "meta_ads", see enum above (default 'webhook')
 "message": "Interested in weekend batches", optional → first note
 "meta": { …any provider payload… } } optional, stored verbatim
→ 201 { leadId } 401 bad token 400 bad payload 501 service key missing
```

Recommended n8n workflows (one per source, all ending in the same HTTP node):

```
[Meta Lead Ads trigger] ─┐
[Google Forms trigger] ─┼─▶ [Function: map fields → {name,email,phone,source,message,meta}]
[Calendly trigger] ─┤ └─▶ [HTTP Request: POST /api/webhooks/leads + token header]
[WhatsApp (Twilio) hook]─┘ └─▶ [IF error → Slack/email alert]
```

Dedup guidance: n8n should pass the provider's lead id in `meta.external_id`;
the endpoint upserts nothing - duplicates are surfaced in the pipeline UI and
merged by humans (CRM-correct default; automated merging loses data).

## 5. Demo session lifecycle

```
Lead(qualified) ─create demo─▶ scheduled
 • invite row (role student, tag "demo") ← the temp credential
 • classroom row (coach, time, "Demo - <name>")
 • lead.status → 'demo', lead_event logged
scheduled ─student signs up w/ code, attends─▶ convert → lead 'enrolled'+student_id, demo 'converted'
scheduled ─expires_at passes, unconverted──▶ expire_demo_sessions():
 invite deleted · classroom cancelled · claimed temp profile removed · demo 'expired' · lead back to 'qualified'
```

## 6. Billing - Razorpay behind the existing interface

`src/lib/billing/` already exposes `BillingProvider` (ensureCustomer /
createCheckout / verifyWebhook / parseWebhook). V2 adds `razorpay.ts`
implementing it via the REST API (payment links; no SDK dependency) and
registers `BILLING_PROVIDER=razorpay`. `/api/webhooks/razorpay` verifies
`x-razorpay-signature` (HMAC-SHA256, webhook secret) and settles through the
same service-role path as the generic webhook. Mock provider remains the
keyless default; any future gateway is one more module. GST columns ride on
invoices now so numbers are never backfilled later.

## 7. UI surfaces (wireframe specs)

```
/organization (CEO only - replaces Billing in the CEO nav)
┌ Stat row: Students · Coaches · Managers · Open leads ┐
├ Live now (live classes w/ Spectate) · Upcoming today ┤
├ Lead funnel (count per stage) · Revenue (month, MRR) ┤
├ Integrations: Razorpay / · AI key / · webhook URL ┤
├ Usage: extraction jobs, storage objects, AI provider ┤
└ Activity feed (audit_log, latest 15) ┘

/leads (CEO + managers; managers see only their leads unless can_manage_leads)
┌ Search · sort · + New lead ───────────────────────────┐
│ NEW │ QUALIFIED │ ASSIGNED │ DEMO │ TRIAL │ ENROLLED │ ← board columns
│ card: name · source · owner · age → click = drawer │
└ Drawer: contact, stage buttons, assign, demo, notes, history ┘

/live-ops (CEO + managers)
┌ grid of mini FEN boards (2-6 per row) ────────────────┐
│ each: board · coach · Nstudents · mm:ss · title │
│ [Spectate silently] [Join] │
```

## 8. Compatibility guarantees

Billing page stays (students' Payment History is Playmate parity); only the
CEO's nav entry is replaced by Organization. Classroom, homework, academy,
knowledge flows are extended, not modified. All new API routes declare
`export const dynamic = "force-dynamic"`.
