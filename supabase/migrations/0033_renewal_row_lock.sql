-- 0033: renew_due_subscriptions selected due rows with no lock, so two
-- concurrent runs (a double-clicked "Run renewals" button, or two overlapping
-- pg_cron/manual invocations) could both see the same subscription as due
-- before either committed, each inserting a duplicate invoice for the same
-- period while the period-end column got advanced twice. `for update skip
-- locked` makes each row go to exactly one concurrent runner.
create or replace function public.renew_due_subscriptions()
returns integer language plpgsql security definer as $$
declare n integer := 0; sub public.subscriptions;
begin
  if auth.uid() is not null and not (public.my_role() in ('ceo','manager')) then
    raise exception 'not allowed';
  end if;
  for sub in
    select * from public.subscriptions
     where status = 'active' and current_period_end <= now()
       and (auth.uid() is null or academy_id = public.my_academy())
     for update skip locked
  loop
    insert into public.invoices (academy_id, student_id, amount_inr, description, due_at)
      values (sub.academy_id, sub.student_id, sub.amount_inr,
              sub.plan || ' (' || sub.billing_interval || ' renewal)',
              sub.current_period_end + interval '7 days');
    update public.subscriptions
       set current_period_end = current_period_end +
             case billing_interval when 'monthly' then interval '1 month'
                                   when 'quarterly' then interval '3 months'
                                   else interval '1 year' end,
           updated_at = now()
     where id = sub.id;
    insert into public.billing_events (academy_id, provider, event_type, subscription_id, payload)
      values (sub.academy_id, sub.provider, 'subscription.renewed', sub.id,
              jsonb_build_object('plan', sub.plan));
    n := n + 1;
  end loop;
  return n;
end $$;

notify pgrst, 'reload schema';
