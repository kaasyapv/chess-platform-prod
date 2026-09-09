-- 0020: batch class-count categories (client requirement #10).
-- "Groups 24/48/96; Individuals 24/48/96; Buddy 24/48/96" is a package type
-- (who's in the class) crossed with a package size (how many sessions it
-- covers) -- an attribute of the enrollment cohort, i.e. batches, not of any
-- one scheduled session. Both nullable: existing batches predate this and
-- not every batch is sold as a fixed-count package.
alter table public.batches add column category text check (category in ('group', 'individual', 'buddy'));
alter table public.batches add column total_classes integer check (total_classes in (24, 48, 96));
