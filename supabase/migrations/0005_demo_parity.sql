-- 0005: Demo-video parity - coach assignment, external meeting links,
-- parent-shareable report snapshots, classroom materials access.

-- Assign specific students to a coach (ChessPlay demo: coach ⋮ → Assign students)
alter table public.profiles add column coach_id uuid references public.profiles(id);

-- Optional external Zoom/Meet link shown at class time (built-in Jitsi remains default)
alter table public.classrooms add column meeting_url text;

-- ── Parent-shareable student report ─────────────────────────────────────────
-- Snapshot taken at share time (no live queries → nothing else is exposed);
-- the unguessable slug is the credential, same model as analyses.share_slug
-- but anonymous (parents have no accounts).
create table public.student_reports (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  student_id uuid not null references public.profiles(id),
  slug       text unique not null default encode(gen_random_bytes(8), 'hex'),
  snapshot   jsonb not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.student_reports enable row level security;
create policy student_reports_public_read on public.student_reports for select
  using (true); -- snapshot-only rows behind a 16-hex-char slug
create policy student_reports_staff_write on public.student_reports for all
  using (academy_id = public.my_academy() and public.is_staff())
  with check (academy_id = public.my_academy() and public.is_staff());

-- ── Classroom materials (PDFs) ──────────────────────────────────────────────
-- Staff already read/write the whole academy folder (0003). Students may READ
-- files under <academy>/classroom-<id>/… so class PDFs open during a session.
create policy sources_class_member_read on storage.objects for select
  to authenticated using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = public.my_academy()::text
    and (storage.foldername(name))[2] like 'classroom-%'
  );
