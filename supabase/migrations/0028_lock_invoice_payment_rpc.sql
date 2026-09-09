-- 0028: record_invoice_payment was grant-executed to `authenticated`, so any
-- logged-in student could call it directly via supabase.rpc(...) from the
-- browser console and mark their own invoice paid - the function only checks
-- "are you the payer" and "is it due", never that a real payment happened.
-- The mock checkout route (the only real caller) already verifies an
-- HMAC-signed `sig` before settling, and that sig is only ever issued to
-- someone with RLS-visibility into the invoice (/api/billing/checkout reads
-- it through the payer's own session first). Move settlement behind that
-- check: restrict the RPC to service_role and have the route call it with a
-- service-role client instead of the payer's session.
create or replace function public.record_invoice_payment(p_invoice uuid, p_provider text, p_ref text)
returns void language plpgsql security definer as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null then raise exception 'invoice not found'; end if;
  -- auth.uid() is null when called with the service role (trusted server
  -- code that already authorized the request, e.g. the mock checkout route
  -- after verifying its signed link) - only enforce this for a user session.
  if auth.uid() is not null and not (inv.student_id = auth.uid()
          or (inv.academy_id = public.my_academy() and public.my_role() in ('ceo','manager'))) then
    raise exception 'not allowed';
  end if;
  if inv.status <> 'due' then raise exception 'invoice is not due'; end if;
  update public.invoices set status = 'paid', paid_at = now() where id = p_invoice;
  insert into public.billing_events (academy_id, provider, event_type, invoice_id, payload)
    values (inv.academy_id, p_provider, 'payment.succeeded', p_invoice,
            jsonb_build_object('ref', p_ref, 'amount_inr', inv.amount_inr));
end $$;

revoke execute on function public.record_invoice_payment(uuid, text, text) from authenticated;
grant execute on function public.record_invoice_payment(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
