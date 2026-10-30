create table public.finance_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.finance_state enable row level security;

create policy "finance_state_select_own" on public.finance_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "finance_state_insert_own" on public.finance_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "finance_state_update_own" on public.finance_state
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);;
