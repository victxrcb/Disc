-- Grupos de treino: registros diários, ranking por tempo de exercício, chat do grupo e selos Alfa/Beta.
-- Execute no SQL Editor do Supabase ou via `supabase db push`.

create table if not exists public.workout_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.workout_group_members (
  group_id uuid not null references public.workout_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists workout_group_members_user on public.workout_group_members (user_id);
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.workout_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  activity text not null check (activity in ('running','gym','swimming','cycling','walking','soccer','yoga','martial','functional','other')),
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  performed_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists workouts_group_day on public.workouts (group_id, performed_on desc);
create index if not exists workouts_group_user on public.workouts (group_id, user_id);
create table if not exists public.workout_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.workout_groups(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists workout_messages_group_time on public.workout_messages (group_id, created_at);

-- Evita recursão de RLS: a checagem de participação roda com os privilégios do dono da função.
create or replace function public.is_workout_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.workout_group_members m where m.group_id = gid and m.user_id = auth.uid());
$$;
revoke execute on function public.is_workout_member(uuid) from public, anon;
grant execute on function public.is_workout_member(uuid) to authenticated;

alter table public.workout_groups enable row level security;
alter table public.workout_group_members enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_messages enable row level security;

drop policy if exists "members read workout groups" on public.workout_groups;
create policy "members read workout groups" on public.workout_groups for select to authenticated using (owner_id = auth.uid() or public.is_workout_member(id));
drop policy if exists "users create workout groups" on public.workout_groups;
create policy "users create workout groups" on public.workout_groups for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "owner renames workout groups" on public.workout_groups;
create policy "owner renames workout groups" on public.workout_groups for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "owner deletes workout groups" on public.workout_groups;
create policy "owner deletes workout groups" on public.workout_groups for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "members read group members" on public.workout_group_members;
create policy "members read group members" on public.workout_group_members for select to authenticated using (public.is_workout_member(group_id));
-- Só o dono adiciona gente, e apenas a si mesmo ou a amigos aceitos.
drop policy if exists "owner adds group members" on public.workout_group_members;
create policy "owner adds group members" on public.workout_group_members for insert to authenticated with check (
  exists(select 1 from public.workout_groups g where g.id = group_id and g.owner_id = auth.uid())
  and (user_id = auth.uid() or exists(select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester_id = auth.uid() and f.addressee_id = user_id) or (f.addressee_id = auth.uid() and f.requester_id = user_id))))
);
-- Membro sai sozinho (o dono não: ele exclui o grupo); o dono remove os outros.
drop policy if exists "leave or remove group members" on public.workout_group_members;
create policy "leave or remove group members" on public.workout_group_members for delete to authenticated using (
  case when user_id = auth.uid()
    then not exists(select 1 from public.workout_groups g where g.id = group_id and g.owner_id = auth.uid())
    else exists(select 1 from public.workout_groups g where g.id = group_id and g.owner_id = auth.uid())
  end
);

drop policy if exists "members read workouts" on public.workouts;
create policy "members read workouts" on public.workouts for select to authenticated using (public.is_workout_member(group_id));
drop policy if exists "members log own workouts" on public.workouts;
create policy "members log own workouts" on public.workouts for insert to authenticated with check (user_id = auth.uid() and public.is_workout_member(group_id));
drop policy if exists "users delete own workouts" on public.workouts;
create policy "users delete own workouts" on public.workouts for delete to authenticated using (user_id = auth.uid());

drop policy if exists "members read group messages" on public.workout_messages;
create policy "members read group messages" on public.workout_messages for select to authenticated using (public.is_workout_member(group_id));
drop policy if exists "members send group messages" on public.workout_messages;
create policy "members send group messages" on public.workout_messages for insert to authenticated with check (sender_id = auth.uid() and public.is_workout_member(group_id));

-- Registros e mensagens são imutáveis; do grupo só o nome pode mudar.
revoke update on public.workouts, public.workout_messages, public.workout_group_members from authenticated;
revoke update on public.workout_groups from authenticated;
grant update(name) on public.workout_groups to authenticated;

-- Selos: 1º lugar = 'alfa', 2º = 'beta', no melhor ranking entre os grupos do usuário.
-- Vale só em grupos com 2+ membros e para quem tem tempo registrado (empates dividem a posição).
create or replace function public.profile_badges(ids uuid[]) returns table(user_id uuid, badge text)
language sql stable security definer set search_path = public as $$
  with totals as (
    select m.group_id, m.user_id, coalesce(sum(w.duration_minutes), 0) as minutes
    from public.workout_group_members m
    left join public.workouts w on w.group_id = m.group_id and w.user_id = m.user_id
    where m.group_id in (select x.group_id from public.workout_group_members x where x.user_id = any(ids))
    group by m.group_id, m.user_id
  ), ranked as (
    select t.*, rank() over (partition by t.group_id order by t.minutes desc) as pos, count(*) over (partition by t.group_id) as size
    from totals t
  )
  select r.user_id, case min(r.pos) when 1 then 'alfa' else 'beta' end
  from ranked r
  where r.user_id = any(ids) and r.size >= 2 and r.minutes > 0 and r.pos <= 2
  group by r.user_id;
$$;
revoke execute on function public.profile_badges(uuid[]) from public, anon;
grant execute on function public.profile_badges(uuid[]) to authenticated;

do $$ begin alter publication supabase_realtime add table public.workout_group_members; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.workouts; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.workout_messages; exception when duplicate_object then null; end $$;
