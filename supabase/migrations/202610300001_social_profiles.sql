-- Execute no SQL Editor do Supabase ou via `supabase db push`.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 32),
  avatar_url text,
  theme text not null default 'default' check (theme in ('default', 'queen', 'celestial')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(), requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (requester_id <> addressee_id)
);
create unique index if not exists friendships_unique_pair on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000), created_at timestamptz not null default now(), check (sender_id <> recipient_id)
);
create index if not exists direct_messages_conversation on public.direct_messages (sender_id, recipient_id, created_at);
create table if not exists public.call_invites (
  id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  room_code text not null check (room_code ~ '^[A-Z0-9]{6}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default (now() + interval '2 hours'), check (sender_id <> recipient_id)
);
create index if not exists call_invites_recipient on public.call_invites (recipient_id, status, created_at desc);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare base_username text; clean_name text;
begin
  base_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1), 'user'), '[^a-z0-9_]', '', 'g'));
  if char_length(base_username) < 3 then base_username := 'user_' || left(new.id::text, 8); end if;
  clean_name := left(coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), base_username), 32);
  begin
    insert into public.profiles (id, username, display_name) values (new.id, left(base_username, 24), clean_name);
  exception when unique_violation then
    insert into public.profiles (id, username, display_name) values (new.id, left(base_username, 15) || '_' || left(new.id::text, 8), clean_name);
  end;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Cria perfis também para contas que já existiam antes desta migração.
insert into public.profiles (id, username, display_name)
select u.id,
  left(lower(regexp_replace(coalesce(nullif(u.raw_user_meta_data->>'username', ''), split_part(u.email, '@', 1), 'user'), '[^a-z0-9_]', '', 'g')), 15) || '_' || left(u.id::text, 8),
  left(coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), nullif(u.raw_user_meta_data->>'username', ''), split_part(u.email, '@', 1), 'Usuário'), 32)
from auth.users u left join public.profiles p on p.id = u.id where p.id is null;

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.direct_messages enable row level security;
alter table public.call_invites enable row level security;
drop policy if exists "profiles readable by members" on public.profiles;
create policy "profiles readable by members" on public.profiles for select to authenticated using (true);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "participants read friendships" on public.friendships;
create policy "participants read friendships" on public.friendships for select to authenticated using (auth.uid() in (requester_id, addressee_id));
drop policy if exists "users request friendships" on public.friendships;
create policy "users request friendships" on public.friendships for insert to authenticated with check (requester_id = auth.uid() and status = 'pending');
drop policy if exists "addressee accepts friendships" on public.friendships;
create policy "addressee accepts friendships" on public.friendships for update to authenticated using (addressee_id = auth.uid() and status = 'pending') with check (addressee_id = auth.uid() and status = 'accepted');
drop policy if exists "participants remove friendships" on public.friendships;
create policy "participants remove friendships" on public.friendships for delete to authenticated using (auth.uid() in (requester_id, addressee_id));
drop policy if exists "participants read direct messages" on public.direct_messages;
create policy "participants read direct messages" on public.direct_messages for select to authenticated using (auth.uid() in (sender_id, recipient_id));
drop policy if exists "friends send direct messages" on public.direct_messages;
create policy "friends send direct messages" on public.direct_messages for insert to authenticated with check (sender_id = auth.uid() and exists(select 1 from public.friendships f where f.status = 'accepted' and ((f.requester_id = sender_id and f.addressee_id = recipient_id) or (f.addressee_id = sender_id and f.requester_id = recipient_id))));
drop policy if exists "participants read call invites" on public.call_invites;
create policy "participants read call invites" on public.call_invites for select to authenticated using (auth.uid() in (sender_id, recipient_id));
drop policy if exists "friends create call invites" on public.call_invites;
create policy "friends create call invites" on public.call_invites for insert to authenticated with check (sender_id = auth.uid() and exists(select 1 from public.friendships f where f.status = 'accepted' and ((f.requester_id = sender_id and f.addressee_id = recipient_id) or (f.addressee_id = sender_id and f.requester_id = recipient_id))));
drop policy if exists "recipient answers call invites" on public.call_invites;
create policy "recipient answers call invites" on public.call_invites for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- A única coluna mutável nestes registros pelo cliente é o status.
revoke update on public.friendships from authenticated;
grant update(status) on public.friendships to authenticated;
revoke update on public.call_invites from authenticated;
grant update(status) on public.call_invites to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif']) on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "users upload own avatar" on storage.objects;
create policy "users upload own avatar" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users update own avatar" on storage.objects;
create policy "users update own avatar" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

do $$ begin alter publication supabase_realtime add table public.friendships; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.direct_messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.call_invites; exception when duplicate_object then null; end $$;
