-- My Day — Supabase schema and security policies.
-- Run this once in your Supabase project's SQL Editor (Dashboard → SQL Editor → New query).

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null,
  linked_task_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  detail text not null default '',
  category text not null check (category in ('work', 'personal')),
  status text not null default 'open' check (status in ('open', 'done')),
  due_at text,                    -- 'YYYY-MM-DD' for a date with no set time, or a full
                                   -- 'YYYY-MM-DDTHH:MM' for a specific time; null = unscheduled
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  parent_task_id uuid references public.tasks(id) on delete cascade,   -- set = this row is a subtask
  source_note_id uuid references public.notes(id) on delete set null, -- set = this task came from a note
  created_at timestamptz not null default now()
);

-- Row Level Security: every table starts fully locked down, then each
-- policy below opens exactly one thing. Without RLS, anyone with your
-- anon key (which is public, by design) could read or write every row.
alter table public.notes enable row level security;
alter table public.tasks enable row level security;

-- A signed-in user may only see and change their OWN rows — this is what
-- makes the app private per-account, and is also what will let Phase 3
-- sharing be added later (as an additional, narrower policy) without
-- touching this one.
create policy "Users manage their own notes"
  on public.notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own tasks"
  on public.tasks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Explicit grants: Supabase no longer exposes new tables to the Data API
-- automatically (as of mid-2026), which is the safer default — a table
-- with no grant is invisible to the API even if RLS is misconfigured
-- later. This app only needs SIGNED-IN access, so only "authenticated"
-- gets a grant; "anon" gets nothing, since every row is owned by a real
-- user anyway. RLS above still decides which ROWS an authenticated call
-- can see — this just turns the API on for these two tables at all.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.notes to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;

-- Enable realtime updates (so the app refreshes instantly across tabs/devices).
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.tasks;
