import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { rateLimitGuard } from "@/lib/rate-limit-guard";

/** Live-class failure → fallback link → n8n → WhatsApp (spec §14, §15).
 *
 * Called by the classroom when the session breaks badly enough that the class
 * can't continue in-platform (video never establishes, realtime drops out, an
 * explicit "get us out of here" from the coach). We record the failure, pick
 * the fallback meeting link, and hand n8n the class/session details so it can
 * deliver that link to the parent/student over WhatsApp.
 *
 * POST { classroomId, kind?, detail? } → { status, eventId, dispatch }
 *
 * n8n is the delivery arm only. The platform decides *whether* to notify (the
 * dedupe window below) and *what* link to send; n8n decides how it reaches the
 * parent. Nothing here pretends a message was delivered: the response reports
 * exactly what happened, including "not_configured" when the webhook URL or
 * fallback link is missing, which is the honest state on a local machine.
 */

export const dynamic = "force-dynamic";

/** Repeated failure signals inside this window collapse into one dispatch.
 *  A dying classroom emits from every participant's browser at once - without
 *  this, one bad class means a dozen WhatsApp messages to the same parent. */
const DEDUPE_WINDOW_MINUTES = 15;

const KINDS = ["classroom_failure", "webrtc_failure", "service_failure", "manual_fallback"] as const;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Generous but bounded: a flapping connection may legitimately report a few
  // times, a loop should not be able to hammer this.
  const limited = rateLimitGuard(`failure:${user.id}`, 20, 60_000, "Too many failure reports");
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as
    | { classroomId?: string; kind?: string; detail?: string }
    | null;
  if (!body?.classroomId) {
    return NextResponse.json({ error: "classroomId required" }, { status: 400 });
  }
  const kind = KINDS.includes(body.kind as (typeof KINDS)[number])
    ? (body.kind as (typeof KINDS)[number])
    : "classroom_failure";

  // RLS decides whether this user may see the class at all - a user who can't
  // read the classroom can't report failures for it either.
  const { data: classroom } = await supabase
    .from("classrooms")
    .select("id, academy_id, title, scheduled_at, meeting_url, coach_id, batch_id, coach:profiles!classrooms_coach_id_fkey(display_name)")
    .eq("id", body.classroomId)
    .single();
  if (!classroom) return NextResponse.json({ error: "Classroom not found" }, { status: 404 });

  /* The failure log is the server's own audit trail, so it's written with the
   * service role rather than as the reporting user. The reporter is often a
   * student, who deliberately cannot read this table - the rows carry the
   * fallback meeting link, which stays manager-only in the product - so
   * writing as them would mean an INSERT that can't return its own row and an
   * dispatch-status UPDATE they have no policy for. Authorisation has already
   * happened above: RLS decided whether they can see this classroom at all. */
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Failure reporting requires SUPABASE_SERVICE_ROLE_KEY - see .env.example" },
      { status: 501 },
    );
  }
  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  });

  // ── Idempotency ───────────────────────────────────────────────────────────
  // Dedupe per classroom, not per (classroom, kind): a real outage can be
  // reported under different kinds by different participants, and a caller
  // could otherwise get one dispatch per kind (4x) inside the same window by
  // just varying it.
  const since = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60_000).toISOString();
  const { data: recent } = await db
    .from("failure_events")
    .select("id, dispatch_status, created_at")
    .eq("classroom_id", classroom.id)
    .gte("created_at", since)
    .in("dispatch_status", ["sent", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) {
    // Still logged (so the volume of signals is visible) but not delivered again.
    await db.from("failure_events").insert({
      academy_id: classroom.academy_id,
      classroom_id: classroom.id,
      kind,
      detail: body.detail?.slice(0, 500) ?? null,
      reported_by: user.id,
      dispatch_status: "duplicate",
      dispatch_detail: `Suppressed - ${recent.id} already dispatched within ${DEDUPE_WINDOW_MINUTES}m`,
    });
    return NextResponse.json({ status: "duplicate", eventId: recent.id, dispatch: "suppressed" });
  }

  const fallbackUrl = classroom.meeting_url ?? null;

  const { data: event, error: insErr } = await db
    .from("failure_events")
    .insert({
      academy_id: classroom.academy_id,
      classroom_id: classroom.id,
      kind,
      detail: body.detail?.slice(0, 500) ?? null,
      reported_by: user.id,
      fallback_url: fallbackUrl,
      dispatch_status: "pending",
    })
    .select("id")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // ── Hand off to n8n ───────────────────────────────────────────────────────
  const hook = process.env.N8N_FALLBACK_WEBHOOK_URL;
  let status: "sent" | "failed" | "not_configured" = "not_configured";
  let detail = "";

  if (!hook) {
    detail = "N8N_FALLBACK_WEBHOOK_URL is not set - nothing was sent.";
  } else if (!fallbackUrl) {
    status = "not_configured";
    detail = "No fallback meeting link on this class - a manager must set one before it can be sent.";
  } else {
    // Recipients are resolved by n8n from the ids we pass: contact details for
    // minors live in the CRM/WhatsApp side, and this endpoint deliberately
    // doesn't copy parent phone numbers around.
    try {
      const res = await fetch(hook, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.N8N_FALLBACK_WEBHOOK_TOKEN
            ? { "x-webhook-token": process.env.N8N_FALLBACK_WEBHOOK_TOKEN }
            : {}),
        },
        body: JSON.stringify({
          event: "classroom_fallback",
          eventId: event.id,
          kind,
          academyId: classroom.academy_id,
          classroom: {
            id: classroom.id,
            title: classroom.title,
            scheduledAt: classroom.scheduled_at,
            coachId: classroom.coach_id,
            coachName: (classroom.coach as unknown as { display_name?: string } | null)?.display_name ?? null,
            batchId: classroom.batch_id,
          },
          fallbackUrl,
          detail: body.detail ?? null,
          reportedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(8000),
      });
      status = res.ok ? "sent" : "failed";
      detail = `n8n responded ${res.status}`;
    } catch (e) {
      status = "failed";
      detail = e instanceof Error ? e.message : "webhook call failed";
    }
  }

  await db
    .from("failure_events")
    .update({
      dispatch_status: status,
      dispatch_detail: detail,
      dispatched_at: new Date().toISOString(),
    })
    .eq("id", event.id);

  /* Deliberately not echoing fallbackUrl back. The reporter is usually the
   * student whose connection just died, and the classroom page strips
   * meeting_url out of the row before it ever reaches a non-manager browser
   * (classrooms/[id]/page.tsx) - handing the same link back in this response
   * would undo that redaction through the side door. The link's destination
   * is n8n, not the caller; `hasFallback` is all the caller needs to know. */
  return NextResponse.json({ status, eventId: event.id, dispatch: detail, hasFallback: !!fallbackUrl });
}
