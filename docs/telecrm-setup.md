# Using your TeleCRM subscription with this platform

For academies that already pay for TeleCRM and want its leads to show up
here automatically. This platform never talks to TeleCRM directly - the
data flow is TeleCRM → your n8n workflow → this platform's webhook, and it's
one-way (TeleCRM → here; nothing is written back to TeleCRM).

## What you need
- An active TeleCRM subscription with webhook/API access (check your
 TeleCRM plan - this is usually on paid tiers, not the free one).
- An n8n account (free self-hosted, or n8n.cloud).

## Setup, step by step

1. **Get your academy's webhook token.** Log in as CEO → Organization
 dashboard → Integrations panel. You'll see a ready-to-copy snippet like:
 ```
 POST https://<your-app>/api/webhooks/leads
 x-academy-token: <your token>
 ```
 Keep this token private - anyone with it can create leads in your academy.

2. **In TeleCRM**, find Settings → Webhooks (or Integrations → Outgoing
 Webhook) and point it at your n8n workflow's webhook URL, triggered on
 "lead created" or "lead updated."

3. **In n8n**, build a 2-node workflow:
 - **Webhook node** - receives TeleCRM's raw payload.
 - **HTTP Request node** - POSTs to `https://<your-app>/api/webhooks/leads`
 with header `x-academy-token: <your token>` and this JSON body, mapped
 from TeleCRM's fields:
 ```json
 {
 "name": "{{ $json.name }}",
 "phone": "{{ $json.phone }}",
 "email": "{{ $json.email }}",
 "source": "telecrm",
 "message": "TeleCRM stage: {{ $json.stage }}",
 "meta": { "telecrm_lead_id": "{{ $json.id }}", "telecrm_stage": "{{ $json.stage }}" }
 }
 ```
 `name` and at least one of `phone`/`email`/`whatsapp` are required -
 everything else is optional. `source: "telecrm"` is what makes these
 leads show up tagged "TeleCRM" in the Leads board instead of generic
 "Webhook."

4. **Test it**: trigger a test lead from TeleCRM (or n8n's "test workflow"
 button) and confirm it appears on this platform's Leads board within a
 few seconds. A local mock of this exact flow, without needing real
 TeleCRM credentials, is `scripts/test-telecrm-webhook.mjs`.

## What this does NOT do
- It does not sync WhatsApp messages, call logs, or drip campaigns from
 TeleCRM - those stay inside TeleCRM. Only lead contact info + stage flow
 one-way into this platform's Leads/CRM board.
- It does not push anything back to TeleCRM (no status sync, no two-way
 update). If TeleCRM needs to know a lead enrolled, that's a separate,
 not-yet-built integration (docs/telecrm-architecture.md §2/§3 - proposed,
 not implemented).
