# Native CRM + n8n vs. a TeleCRM subscription

Companion to [telecrm-architecture.md](telecrm-architecture.md) (the schema
spec) - this doc explains *why* the native tables + n8n combination replaces
a paid TeleCRM seat, not just what the tables are, and documents the one
piece of genuinely tricky concurrency in the whole system: multiple coaches
hitting "Call Manager" at the same moment.

## 1. What a TeleCRM subscription actually costs

TeleCRM is priced per agent seat, monthly, forever, on top of whatever the
academy already pays for WhatsApp Business API access (Meta bills that
separately regardless of which CRM sits in front of it). For an academy
running N coaches/managers as calling agents, that's N recurring seats for a
tool that is, functionally, three tables (leads, WhatsApp log, call log) and
some routing rules - all of which already have a home in this schema.

The native clone (`0014_telecrm.sql`, `0016_telecrm_rbac.sql`) replaces the
per-seat cost with:
- **Zero incremental hosting** - `whatsapp_messages`, `call_logs`,
 `lead_distribution_rules`, `drip_campaigns` are ordinary Postgres tables in
 the same Supabase project every other feature already uses. No new
 service, no new bill.
- **One WhatsApp Cloud API bill** (Meta's, not TeleCRM's) - the same
 official Business Platform TeleCRM itself sits in front of. Cutting
 TeleCRM out removes their markup/seat fee, not the underlying WhatsApp
 cost, which was never optional.
- **n8n** already runs for this academy (`src/components/dash/n8n-pipeline.tsx`,
 the Meta Ads → n8n → `/api/webhooks/leads` flow) - it's marginal cost, not
 new cost, to add WhatsApp and drip workflows alongside the lead-ingestion
 one that already exists.

Path A (`telecrm-architecture.md` §2, the "Integration" tab on `/telecrm`)
stays available for academies mid-contract with TeleCRM - the API
key/webhook fields let a CEO point sync at their existing account while
deciding whether to cut over, so adopting the native tables is never an
all-or-nothing migration.

## 2. How n8n automates the CRM layer

Three workflows, all variations of the pattern already proven by the leads
webhook:

1. **WhatsApp Cloud API messaging** - `[Meta webhook: inbound message] →
 [Function: map to whatsapp_messages row shape] → [HTTP: POST to this
 app]`, inserting into `whatsapp_messages` with `direction: 'in'`. Outbound
 sends run the same shape in reverse: the app writes a `queued` row (the
 WhatsApp tab already does this for the UI-simulated path), n8n polls or
 is webhook-triggered on insert, calls the Cloud API, and PATCHes the row's
 `status`/`provider_msg_id` back. This app never talks to Meta directly -
 n8n is the only thing holding the WhatsApp credential, same isolation
 principle as the existing lead-ingestion token.
2. **Lead scoring** - a scheduled n8n workflow reads `leads` +
 `lead_events` (source, response time, stage velocity) on an interval,
 computes a score, and writes it back via a normal authenticated update -
 no scoring logic needs to live inside this app or block the request path
 that creates a lead.
3. **Drip sequences** - `drip_enrollments.next_send_at` (computed by
 `nextDripSendAt()` in `src/lib/telecrm.ts` at enrollment time) is exactly
 the column an n8n cron trigger polls: "rows where `next_send_at <= now()`
 and `status = 'active'`" is one query, send the step's WhatsApp template,
 advance `current_step`, recompute `next_send_at`. This is the
 `advance_drip_enrollments()` piece the architecture doc marks as
 intentionally unbuilt - it's an n8n workflow, not a Postgres function,
 once real WhatsApp credentials exist, because n8n is already the thing
 holding those credentials for message #1 above.

## 3. Call Manager: multi-coach concurrency

"Call Manager" is the existing Live Ops escalation queue
(`supabase/migrations/0013_help_requests.sql`, `src/lib/help-queue.ts`,
`src/app/[role]/dashboard/[academyId]/live-ops/live-ops-client.tsx`) - a
coach mid-class hits ** Call Manager** (`classroom-client.tsx`, the
`callManager` handler) to escalate to a manager/CEO, who claims it from the
Live Ops queue. The concurrency question is what happens when several
coaches escalate within the same second and several managers are watching
the queue at once.

**Priority ordering** - `sortHelpQueue()` (`src/lib/help-queue.ts`): coach
requests always sort ahead of student requests regardless of arrival order;
within the same requester role, oldest request first. This runs purely
client-side, is pure and unit-tested (`tests/help-queue.test.mjs`), and is
recomputed on every render from whatever rows are currently `status='open'`
- there's no server-side priority field to keep in sync.

**One escalation per classroom** - `help_requests_one_open_per_classroom`, a
partial unique index (`unique (classroom_id) where (status = 'open')`). A
coach mashing the button twice hits a unique-violation on the second insert,
which the client silently ignores - the queue can't be spammed by one
classroom holding multiple open slots.

**The claim lock - no advisory lock, no lock table.** When a manager clicks
"Join Class" (`live-ops-client.tsx`, the `claim` function), the client sends
a single conditional UPDATE:

```sql
update help_requests
 set status = 'claimed', claimed_by = :manager_id, claimed_at = now()
 where id = :request_id and status = 'open'
```

Postgres's own row-level atomicity *is* the lock: only the UPDATE that
lands while the row is still `status = 'open'` returns a row. Two managers
clicking the same request within milliseconds both send this UPDATE; exactly
one of them matches the `where status = 'open'` predicate at commit time (the
other sees the row already flipped to `claimed` and matches zero rows) -
Postgres serializes concurrent UPDATEs to the same row, there is no window
where both can "win." The client checks `.select().maybeSingle()`: a manager
who gets a row back navigates into the classroom; a manager who gets nothing
back silently backs off, no error, no toast - they just see the request
disappear from their own queue on the next realtime tick, same as if someone
else had resolved it a moment earlier.

This is the same pattern this app already uses for the Live Ops board
itself (one `postgres_changes` subscription feeding every card,
`live-ops-client.tsx`) - a single source of truth in Postgres, realtime
fan-out to every connected manager, and ordinary transactional isolation
standing in for what a naive implementation would reach for a Redis lock or
a `SELECT ... FOR UPDATE` to solve.
