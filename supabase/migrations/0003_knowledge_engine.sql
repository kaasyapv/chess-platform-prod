-- 0003_knowledge_engine.sql - AI Knowledge Engine: source uploads → extraction
-- jobs → detected diagrams/FENs/PGNs → auto-built lessons/quizzes/flashcards.
-- Plus the private storage bucket and assistant threads.

create type public.job_status as enum
  ('uploaded','ingesting','processing','review','publishing','done','failed');
create type public.item_status as enum
  ('detected','validated','needs_review','approved','rejected','published');

create table public.extraction_jobs (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id),
  created_by   uuid not null references public.profiles(id),
  title        text not null,
  source_path  text not null,                 -- storage path in 'sources' bucket
  source_kind  text not null check (source_kind in ('pdf','image','image-set','pgn')),
  status       public.job_status not null default 'uploaded',
  page_count   int,
  pages_done   int not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.extraction_items (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.extraction_jobs(id) on delete cascade,
  page_number   int not null default 1,
  diagram_index int not null default 1,
  fen           text not null,
  moves_san     text,
  side_to_move  text check (side_to_move in ('w','b')),
  task          text,                          -- what the exercise asks
  context       text,                          -- instructional context
  chapter       text,
  confidence    real not null default 0,
  status        public.item_status not null default 'detected',
  review_note   text,
  published_lesson_id uuid references public.lessons(id),
  published_pgn_id    uuid references public.pgns(id),
  created_at    timestamptz not null default now()
);
create index extraction_items_job on public.extraction_items(job_id, page_number);

alter table public.lessons
  add constraint lessons_source_job_fk
  foreign key (source_job_id) references public.extraction_jobs(id) on delete set null;

-- Coach AI assistant conversations
create table public.assistant_threads (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  owner_id   uuid not null references public.profiles(id),
  title      text not null default 'New conversation',
  messages   jsonb not null default '[]',      -- [{role, content, at}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.extraction_jobs  enable row level security;
alter table public.extraction_items enable row level security;
alter table public.assistant_threads enable row level security;

create policy jobs_staff on public.extraction_jobs for all
  using (academy_id = public.my_academy() and public.is_staff())
  with check (academy_id = public.my_academy() and public.is_staff());
create policy items_staff on public.extraction_items for all
  using (exists (select 1 from public.extraction_jobs j
                 where j.id = job_id and j.academy_id = public.my_academy()
                   and public.is_staff()));
create policy threads_own on public.assistant_threads for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and academy_id = public.my_academy());

-- ── Storage: private 'sources' bucket, academy-scoped folders ───────────────
insert into storage.buckets (id, name, public)
values ('sources', 'sources', false)
on conflict (id) do nothing;

create policy sources_staff_write on storage.objects for insert
  with check (
    bucket_id = 'sources' and public.is_staff()
    and (storage.foldername(name))[1] = public.my_academy()::text
  );
create policy sources_staff_read on storage.objects for select
  using (
    bucket_id = 'sources' and public.is_staff()
    and (storage.foldername(name))[1] = public.my_academy()::text
  );
create policy sources_staff_delete on storage.objects for delete
  using (
    bucket_id = 'sources' and public.is_staff()
    and (storage.foldername(name))[1] = public.my_academy()::text
  );
