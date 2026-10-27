-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Creates the table that holds your tasks and locks it so each signed-in
-- account can only ever see and change its own rows.

create table if not exists public.todos (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text        text not null,
  done        boolean not null default false,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);

create index if not exists todos_user_id_idx on public.todos (user_id);

alter table public.todos enable row level security;

create policy "Read own todos"   on public.todos for select to authenticated using (auth.uid() = user_id);
create policy "Add own todos"    on public.todos for insert to authenticated with check (auth.uid() = user_id);
create policy "Change own todos" on public.todos for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own todos" on public.todos for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.todos to authenticated;

-- Live updates: lets the phone refresh the moment you change something on the PC.
alter publication supabase_realtime add table public.todos;
