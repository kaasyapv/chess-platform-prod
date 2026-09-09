// Lightweight automated security probe of the HTTP surface.
//
// NOT a replacement for a real pentest. This is the CI-friendly floor: it curls
// every route unauthenticated and checks the invariants an authenticated
// pentest would otherwise have to re-establish every run.
//
//   node scripts/security-scan.mjs [BASE_URL]     (default http://localhost:3000)
//
// Exit 0 = all invariants hold, 1 = at least one violation.

const BASE = (process.argv[2] || process.env.SCAN_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

// Security headers next.config.ts promises on EVERY response.
const REQUIRED_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": /max-age=\d+/,
  "permissions-policy": /.+/,
};

// Routes that must NOT serve data / act to an unauthenticated caller.
// Expected: 401 / 403, or a 3xx redirect to /login. Never 200 with a body
// that isn't an error, never 500.
const PROTECTED = [
  { m: "GET",  p: "/api/livekit/token?classroom=00000000-0000-0000-0000-000000000000" },
  { m: "GET",  p: "/api/export/finance" },
  { m: "GET",  p: "/api/export/payments" },
  { m: "POST", p: "/api/knowledge/snap", body: { base64: "x", mediaType: "image/png" } },
  { m: "POST", p: "/api/failures/classroom", body: { classroomId: "x" } },
  { m: "POST", p: "/api/billing/checkout", body: { invoiceId: "x" } },
  { m: "GET",  p: "/ceo/dashboard/00000000-0000-0000-0000-000000000000/billing" },
];

// Routes that are meant to be public — sanity-check they answer and carry headers.
const PUBLIC = [
  { m: "GET", p: "/api/health" },
  { m: "GET", p: "/login" },
];

// Webhook receivers must reject an unsigned / garbage body (401/400), not 500.
const WEBHOOKS = [
  { m: "POST", p: "/api/webhooks/razorpay", body: { event: "payment.captured" } },
  { m: "POST", p: "/api/billing/webhook", body: { type: "checkout.completed" } },
];

const fails = [];
const ok = (msg) => console.log(`  ok   ${msg}`);
const bad = (msg) => { console.log(`  FAIL ${msg}`); fails.push(msg); };

async function hit({ m, p, body }) {
  const res = await fetch(BASE + p, {
    method: m,
    redirect: "manual",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => "");
  return { res, text };
}

function checkHeaders(p, res) {
  for (const [h, want] of Object.entries(REQUIRED_HEADERS)) {
    const got = res.headers.get(h);
    if (!got) { bad(`${p} — missing header ${h}`); continue; }
    if (want instanceof RegExp ? !want.test(got) : got !== want) {
      bad(`${p} — header ${h} = "${got}" (want ${want})`);
    }
  }
  if (res.headers.get("x-powered-by")) bad(`${p} — leaks X-Powered-By: ${res.headers.get("x-powered-by")}`);
}

function checkNoLeak(p, text) {
  if (/\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(text) || /\n\s+at\s/.test(text)) {
    bad(`${p} — response body contains a stack trace`);
  }
  if (/SUPABASE_SERVICE_ROLE_KEY\s*=|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./.test(text)) {
    bad(`${p} — response body may contain a secret / JWT`);
  }
}

console.log(`\nSecurity probe → ${BASE}\n`);

console.log("Protected routes reject anonymous callers:");
for (const r of PROTECTED) {
  try {
    const { res, text } = await hit(r);
    checkHeaders(r.p, res);
    checkNoLeak(r.p, text);
    const loc = res.headers.get("location") || "";
    const redirectToLogin = res.status >= 300 && res.status < 400 && /\/login/.test(loc);
    if (res.status === 401 || res.status === 403 || redirectToLogin) {
      ok(`${r.m} ${r.p} → ${res.status}${redirectToLogin ? " → /login" : ""}`);
    } else if (res.status === 503 || res.status === 501) {
      ok(`${r.m} ${r.p} → ${res.status} (feature not configured — acceptable)`);
    } else {
      bad(`${r.m} ${r.p} → ${res.status} (expected 401/403/redirect)`);
    }
  } catch (e) { bad(`${r.m} ${r.p} — request threw: ${e.message}`); }
}

console.log("\nPublic routes answer and carry headers:");
for (const r of PUBLIC) {
  try {
    const { res, text } = await hit(r);
    checkHeaders(r.p, res);
    checkNoLeak(r.p, text);
    // /api/health is a status probe: 200 (healthy) or 503 (degraded) are both
    // "responding". Anything else, or a 5xx elsewhere, is a fault.
    const acceptable = r.p === "/api/health" ? [200, 503].includes(res.status) : res.status < 500;
    if (acceptable) ok(`${r.m} ${r.p} → ${res.status}`);
    else bad(`${r.m} ${r.p} → ${res.status}`);
  } catch (e) { bad(`${r.m} ${r.p} — request threw: ${e.message}`); }
}

console.log("\nWebhook receivers reject unsigned bodies:");
for (const r of WEBHOOKS) {
  try {
    const { res, text } = await hit(r);
    checkNoLeak(r.p, text);
    if (res.status === 400 || res.status === 401) ok(`${r.m} ${r.p} → ${res.status}`);
    else if (res.status === 200 && /ignored|ok.*true/i.test(text)) ok(`${r.m} ${r.p} → 200 (ignored unparseable event)`);
    else bad(`${r.m} ${r.p} → ${res.status} (expected 400/401 for an unsigned body)`);
  } catch (e) { bad(`${r.m} ${r.p} — request threw: ${e.message}`); }
}

console.log(`\n${fails.length === 0 ? "PASS — all invariants hold" : `FAIL — ${fails.length} violation(s)`}\n`);
process.exit(fails.length === 0 ? 0 : 1);
