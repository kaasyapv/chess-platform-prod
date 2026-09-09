-- 0015: Per-classroom topic label + syllabus checklist. Coach/ceo/manager
-- (the same `isCoach` gate the classroom client already uses) edit; everyone
-- in the class reads. No new table - both live directly on classrooms since
-- neither needs its own RLS or to be queried independently of a classroom.

alter table public.classrooms add column topic text;
alter table public.classrooms add column syllabus jsonb not null default '[]';
-- syllabus shape: [{ "id": uuid, "title": text, "done": boolean }, ...]
