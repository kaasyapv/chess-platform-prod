# TeleCRM parity - architecture (docs only, no UI yet)

Scope note: this document is a design spec. Nothing here ships UI; it
describes the schema and integration seams so Path A/B can be built later
without re-deriving the shape of the system. It extends
[ARCHITECTURE_V2.md](ARCHITECTURE_V2.md) §1-4 - read that first. Everything
in §1-4 there (the `leads` pipeline, `lead_events`, `manager_permissions`,
the `/api/webhooks/leads` n8n endpoint, the `/leads` and `/organization`
UIs) already exists and already works; this doc is the delta on top of it,
not a replacement.

## 0. What TeleCRM actually is, and why teams stay on it

Per public product pages and reviews (G2, Capterra, Software Advice - see
Sources), TeleCRM's pitch to small/mid sales and telecalling teams rests on
four things:

1. **Radical simplicity.** Reviewers repeatedly describe switching *from*
 feature-heavy CRMs *to* TeleCRM because teams stopped using the
 complicated ones and reverted to spreadsheets. The lesson isn't "add more
 screens," it's "don't."
2. **A sequential autodialer.** The app dials leads one after another so a
 caller never looks up a number or sets a follow-up reminder by hand -
 claimed throughput is 200-250+ calls/day per agent.
3. **WhatsApp folded into the CRM.** Team WhatsApp conversations sync into
 one place instead of living on individual phones.
4. **Rule-based automatic lead distribution** - leads get assigned to reps
 by percentage/rule, not a manager manually dragging rows.

Reviewers' recurring complaints are just as instructive for scoping: **no
deal pipeline / quotes / invoices** (leads-and-calls only), **no bulk
email**, **no AI-powered insights**, and **inconsistent support quality**.
This platform already has a unified billing module (`src/lib/billing`) and
an AI provider seam (`src/lib/ai`) that TeleCRM lacks - Path B should lean
into that rather than cloning TeleCRM's gaps along with its strengths.

(This section describes *functionality*, not TeleCRM's UI copy or marketing
text - no interface strings are reproduced here; wording for anything built
from this doc should be written fresh.)

## 1. Current state (already built - do not re-build)
| Piece | Where | Covers |
|---|---|---|
| `leads` table | `supabase/migrations/0006_enterprise.sql` | contact jsonb (email/phone/whatsapp), source enum incl. `whatsapp`/`meta_ads`/`calendly`, status pipeline `new→…→enrolled/lost`, `assigned_to` |
| `lead_events` table | same migration | unified notes/status/assignment/webhook/demo activity log |
| `manager_permissions` | same migration | `can_manage_leads` RLS gate, title is display-only |
| Inbound webhook | `src/app/api/webhooks/leads/route.ts` | generic `x-academy-token` ingestion; already accepts a `whatsapp` contact field and source |
| Pipeline UI | `src/app/[role]/dashboard/[academyId]/leads/` | board view, drawer, assign/notes |
| n8n visual | `src/components/dash/n8n-pipeline.tsx` | shows the Meta Ads → n8n → webhook → email flow on the CEO dashboard |

Nothing below duplicates this - it's additive.

## 2. Path A - integrate the team's existing TeleCRM account

TeleCRM → us (inbound) needs no new endpoint: the existing
`/api/webhooks/leads` contract (`docs/ARCHITECTURE_V2.md` §4) already
accepts `{name, email, phone, whatsapp, source, message, meta}`. If TeleCRM
can fire an outbound webhook (directly, or bridged through the team's n8n)
whenever a lead is created/updated on their side, point it at this endpoint
with `source: "webhook"` and the TeleCRM record id in `meta.external_id` -
same dedup convention already documented for every other source.

Us → TeleCRM (outbound) is the new half, and it's an **assumption pending
verification**: TeleCRM's write API for third-party integrations is not
publicly documented in the sources checked for this doc. If/when API
credentials are obtained, the shape to build is a single adapter module -

```
src/lib/crm/telecrm-sync.ts
 interface CrmSyncProvider {
 name: string;
 pushLeadEvent(event: LeadEvent): Promise<void>; // status change, note
 }
```

- mirroring exactly how `src/lib/billing/index.ts` isolates Razorpay behind
a provider interface: one module, called from the existing `lead_events`
insert path, no route or schema changes elsewhere. Until credentials exist,
Path A is inbound-only (which is also the lower-risk half - it doesn't
require trusting an outbound integration with write access to a paid
TeleCRM seat).

## 3. Path B - native clone, new schema

Four new concerns, none of which the existing `leads`/`lead_events` tables
try to cover today:

### 3.1 WhatsApp chat log - `whatsapp_messages`

```sql
whatsapp_messages
 id, academy_id, lead_id → leads (cascade)
 direction text check (direction in ('in','out'))
 body text
 template_name text -- null for freeform, set for approved WA templates
 status text check (status in ('queued','sent','delivered','read','failed'))
 provider_msg_id text -- WhatsApp Cloud API message id, for status webhooks
 created_at timestamptz not null default now()
```

Transport: **WhatsApp Cloud API** (Meta's official Business Platform, not a
third-party wrapper - matches "WhatsApp Official API" in the brief).
Inbound messages and delivery-status callbacks arrive at Meta's webhook,
relayed through the same n8n instance already used for lead ingestion (one
more workflow: `[WhatsApp Cloud webhook] → [Function: map to
whatsapp_messages shape] → [HTTP: our endpoint]`), or a dedicated
`/api/webhooks/whatsapp` route using the same service-role write pattern as
`route.ts:1,24-31`. Add to `supabase_realtime` publication the same way
`classrooms` was (`0006_enterprise.sql:143`) so a chat pane can subscribe
live per lead - reuses the existing realtime idiom, not a new one.

### 3.2 Drip campaigns - `drip_campaigns` / `drip_campaign_steps` / `drip_enrollments`

```sql
drip_campaigns id, academy_id, name, active
drip_campaign_steps id, campaign_id, step_order, delay_hours, channel ('whatsapp'|'email'), template_name
drip_enrollments id, lead_id, campaign_id, current_step, next_send_at, status ('active','done','stopped')
```

Advanced by one scheduled Postgres function (`advance_drip_enrollments()`),
invoked the same way `expire_demo_sessions()` already is (security-definer,
staff- or pg_cron-invoked, `ARCHITECTURE_V2.md` line 48). No new job-queue
system - this is one more cron-style function alongside an existing one.

### 3.3 Call tracking - `call_logs`

```sql
call_logs
 id, academy_id, lead_id → leads, agent_id → profiles
 direction text check (direction in ('inbound','outbound'))
 duration_seconds int
 outcome text check (outcome in ('connected','no_answer','busy','wrong_number'))
 recording_url text -- nullable; whatever telephony provider supplies
 started_at timestamptz not null default now()
```

"1-click autodialing" is a client-side sequencing concern, not a server
feature: the `/leads` UI walks an agent's assigned queue and fires `tel:`
links (or a telephony-provider click-to-call API if/when one is wired up),
logging each attempt to `call_logs` on completion via the provider's status
webhook. No in-browser SIP/dialer engine - that's infrastructure this scale
doesn't need yet, and every telephony provider (Exotel, Knowlarity, Twilio
Voice - all common in this market) already does the actual dialing.

### 3.4 Lead distribution - `lead_distribution_rules`

```sql
lead_distribution_rules
 id, academy_id, agent_id → profiles, weight_percent int, active bool
```

Read by a small weighted-pick function called from the existing lead-insert
path (webhook route + manual "+ New lead") - extends
`src/app/api/webhooks/leads/route.ts`'s insert, doesn't replace it. Simple
weighted round-robin (cumulative-weight pick against a running counter) is
sufficient at telecalling-team scale; no ML-based routing.

## 4. Mapping back to why TeleCRM is sticky
| TeleCRM strength | This platform's answer |
|---|---|
| Simplicity | One `/leads` board already exists; new tables (§3) are backend-only until a UI is actually requested - no UI sprawl added by this doc |
| Autodialer | `call_logs` + click-to-call queue walk (§3.3) |
| WhatsApp-in-CRM | `whatsapp_messages` on WhatsApp Cloud API (§3.1) |
| Auto lead distribution | `lead_distribution_rules` (§3.4) |
| *(gap)* No AI insights | Already have `src/lib/ai` - a future coach/manager assistant reading `lead_events`+`call_logs` is a natural extension, not a new subsystem |
| *(gap)* No unified billing | Already unified - `src/lib/billing` covers the same academy, not a separate tool |

## Sources

- [Telecrm - Software Finder](https://softwarefinder.com/crm/telecrm)
- [TeleCRM - features & pricing, SaaSworthy](https://www.saasworthy.com/product/telecrm-app)
- [CRM with 1-click Dialer - telecrm.in](https://telecrm.in/crm-with-dialer)
- [TeleCRM Reviews - Capterra](https://www.capterra.com/p/213134/TeleCRM/reviews/)
- [TeleCRM Pricing, Reviews, Pros & Cons - Prospeo](https://prospeo.io/s/telecrm-pricing-reviews-pros-and-cons)
