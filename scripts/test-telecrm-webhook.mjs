#!/usr/bin/env node
// Proves the lead-ingestion webhook (src/app/api/webhooks/leads/route.ts) works
// end-to-end using a mock TeleCRM payload, since we don't have the client's
// real TeleCRM account/keys yet (see docs/telecrm-architecture.md).
//
// TeleCRM itself doesn't call this endpoint directly - its own webhook fires
// into an n8n workflow, which reshapes TeleCRM's payload into this endpoint's
// contract and POSTs it here (docs/telecrm-architecture.md §1). The `meta`
// object below is what that n8n transform step would carry through from
// TeleCRM's raw webhook body, for traceability back to the TeleCRM lead.
//
// Usage (local stack + `npm run dev` running):
//   node scripts/test-telecrm-webhook.mjs
// Usage (deployed):
//   SITE_URL=https://your-app.vercel.app node scripts/test-telecrm-webhook.mjs

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = "/Users/kaasyap/Desktop/chess-platform";
const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

function envFromLocal() {
  const txt = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const get = (k) => txt.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
  return { url: get("NEXT_PUBLIC_SUPABASE_URL"), key: get("SUPABASE_SERVICE_ROLE_KEY") };
}

// A realistic TeleCRM "lead updated" webhook body, already reshaped the way
// the n8n workflow would reshape it before forwarding here.
const mockTeleCrmLead = {
  name: "Aarav Mehta (TeleCRM)",
  phone: "+919812345678",
  source: "telecrm",
  message: "Interested in weekend batch - TeleCRM stage: Hot Lead",
  meta: {
    telecrm_lead_id: "tcrm_8841203",
    telecrm_stage: "Hot Lead",
    telecrm_owner: "Priya (Sales)",
    telecrm_tags: ["chess", "weekend-batch"],
  },
};

async function main() {
  const { url, key } = envFromLocal();
  if (!url || !key) throw new Error("Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: secret, error: secretErr } = await db
    .from("academy_secrets").select("academy_id, webhook_token").limit(1).maybeSingle();
  if (secretErr) throw secretErr;
  if (!secret) throw new Error("No academy_secrets row found - sign up/seed an academy first (its webhook token is auto-generated).");

  console.log(`POST ${SITE_URL}/api/webhooks/leads (academy ${secret.academy_id})…`);
  const res = await fetch(`${SITE_URL}/api/webhooks/leads`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-academy-token": secret.webhook_token },
    body: JSON.stringify(mockTeleCrmLead),
  });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}: ${JSON.stringify(body)}`);
  console.log(`✓ Lead created: ${body.leadId}`);

  const { data: lead, error: leadErr } = await db
    .from("leads").select("id, name, source, contact").eq("id", body.leadId).single();
  if (leadErr) throw leadErr;
  console.assert(lead.source === "telecrm", "lead.source should be 'telecrm'");
  console.assert(lead.contact.phone === mockTeleCrmLead.phone, "phone should round-trip");
  console.log(`✓ Row verified: source=${lead.source}, phone=${lead.contact.phone}`);

  const { data: events, error: evErr } = await db
    .from("lead_events").select("id, kind, meta").eq("lead_id", body.leadId);
  if (evErr) throw evErr;
  console.assert(events.length === 1 && events[0].kind === "webhook", "one webhook lead_event expected");
  console.assert(events[0].meta?.telecrm_lead_id === mockTeleCrmLead.meta.telecrm_lead_id, "TeleCRM id should carry through in meta");
  console.log(`✓ lead_events row verified, TeleCRM id preserved in meta`);

  console.log("\nPASS - webhook accepts a TeleCRM-shaped payload end-to-end.");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
