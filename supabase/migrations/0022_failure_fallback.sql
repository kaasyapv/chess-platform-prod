-- 0022: failure/fallback dispatch (spec §14, §15).
--
-- n8n stops being a lead-acquisition tool (TeleCRM owns that) and becomes the
-- outbound arm of the failure path: when a live class breaks, the platform
-- records the failure, picks the fallback meeting link, and hands n8n the
-- class/session details so it can deliver that link to the parent/student over
-- WhatsApp.
--
-- This table is the log AND the idempotency key. A failing classroom emits
-- signals from every participant's browser at once, so without a dedupe window
-- one bad class would fire a dozen WhatsApp messages at the same parent.

create table public.failure_events (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references public.academies(id),
  classroom_id    uuid references public.classrooms(id) on delete cascade,
  kind            text not null check (kind in (
                    'classroom_failure','webrtc_failure','service_failure','manual_fallback')),
  detail          text,
  reported_by     uuid references public.profiles(id),
  fallback_url    text,
  -- not_configured = we had nothing to send to (no n8n URL / no fallback link);
  -- duplicate = suppressed by the dedupe window rather than delivered twice.
  dispatch_status text not null default 'pending' check (dispatch_status in (
                    'pending','sent','failed','duplicate','not_configured')),
  dispatch_detail text,
  recipients      jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  dispatched_at   timestamptz
);

create index failure_events_academy_idx on public.failure_events (academy_id, created_at desc);
-- Serves the dedupe lookup: "has this class already reported this kind recently?"
create index failure_events_dedupe_idx on public.failure_events (classroom_id, kind, created_at desc);

alter table public.failure_events enable row level security;

-- Anyone in the class can REPORT a failure - a student whose room just died is
-- exactly who needs to trigger this, and requiring staff would mean the signal
-- never fires in the case it exists for.
create policy failure_report on public.failure_events for insert
  with check (academy_id = public.my_academy() and reported_by = auth.uid());

-- Reading the log (which carries the fallback link) stays with CEO/manager,
-- consistent with the link being manager-only elsewhere.
create policy failure_admin_read on public.failure_events for select
  using (academy_id = public.my_academy() and public.is_admin());

create policy failure_admin_write on public.failure_events for update
  using (academy_id = public.my_academy() and public.is_admin());

comment on table public.failure_events is
  'Live-class failure signals and their fallback-link dispatch outcome. Written by /api/failures/classroom; the dedupe window there is what stops one broken class from spamming a parent.';
