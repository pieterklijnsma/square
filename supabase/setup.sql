-- Run this once in Supabase: SQL Editor → New query → paste → Run.

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  amount_pence integer not null check (amount_pence > 0),
  paid_by      text not null check (paid_by in ('Pieter', 'Luke', 'Johnny', 'James')),
  shares       jsonb not null,           -- e.g. {"Pieter":1,"Luke":1,"James":2}
  description  text not null default '',
  kind         text not null default 'expense' check (kind in ('expense', 'settle'))
);

-- Anyone with the app link can read, add and delete payments.
-- That's the trade-off for no logins; keep the site link within the four of you.
alter table public.payments enable row level security;

create policy "read payments"   on public.payments for select to anon using (true);
create policy "add payments"    on public.payments for insert to anon with check (true);
create policy "delete payments" on public.payments for delete to anon using (true);
