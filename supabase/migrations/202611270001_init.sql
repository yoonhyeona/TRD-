create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'senior' check (role in ('senior', 'caregiver')),
  created_at timestamptz not null default now()
);

create or replace function public.create_senior_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles(id, role) values (new.id, 'senior');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_senior_profile();
revoke all on function public.create_senior_profile() from public, anon, authenticated;

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('data_storage', 'ai_processing')),
  granted boolean not null,
  document_version text not null,
  created_at timestamptz not null default now()
);
create index consent_latest_idx
  on public.consent_records(user_id, consent_type, created_at desc, id desc);

create table public.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'created'
    check (status in ('created', 'in_progress', 'awaiting_summary', 'completed', 'failed')),
  photo_source text not null check (photo_source in ('sample', 'upload')),
  sample_id text check (sample_id is null or sample_id in ('seaside', 'garden', 'table')),
  photo_path text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);
create index sessions_owner_started_idx on public.sessions(user_id, started_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  turn_number smallint not null check (turn_number between 1 and 3),
  role text not null check (role in ('assistant', 'user')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now(),
  unique(session_id, turn_number, role)
);
create index messages_session_turn_idx on public.messages(session_id, turn_number, created_at);

create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id) on delete cascade,
  recall_keywords text[] not null default '{}',
  activity_summary text not null check (char_length(activity_summary) between 1 and 600),
  health_mention_note text check (
    health_mention_note is null or char_length(health_mention_note) <= 240
  ),
  summary_source text not null check (summary_source in ('ai', 'fallback')),
  created_at timestamptz not null default now()
);

create table public.checkins (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  medication_status text not null
    check (medication_status in ('taken', 'not_taken', 'not_recorded')),
  condition_status text not null
    check (condition_status in ('good', 'okay', 'unwell', 'not_recorded')),
  condition_note text check (condition_note is null or char_length(condition_note) <= 500),
  updated_at timestamptz not null default now()
);

create or replace function public.has_active_consent(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (
    select granted from public.consent_records
    where user_id = p_user_id and consent_type = 'data_storage'
    order by created_at desc, id desc limit 1
  ) is true and (
    select granted from public.consent_records
    where user_id = p_user_id and consent_type = 'ai_processing'
    order by created_at desc, id desc limit 1
  ) is true;
$$;
revoke all on function public.has_active_consent(uuid) from public, anon, authenticated;

create or replace function public.record_consent(
  p_consent_type text,
  p_granted boolean,
  p_document_version text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or p_consent_type not in ('data_storage', 'ai_processing')
     or char_length(p_document_version) not between 1 and 40 then
    raise exception 'invalid consent';
  end if;
  insert into public.consent_records(user_id, consent_type, granted, document_version)
  values (auth.uid(), p_consent_type, p_granted, p_document_version)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.start_session(
  p_session_id uuid,
  p_photo_source text,
  p_sample_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.has_active_consent(auth.uid()) then
    raise exception 'consent required';
  end if;
  if p_photo_source not in ('sample', 'upload')
     or (p_photo_source = 'sample' and p_sample_id not in ('seaside', 'garden', 'table'))
     or (p_photo_source = 'upload' and p_sample_id is not null) then
    raise exception 'invalid photo source';
  end if;
  insert into public.sessions(id, user_id, photo_source, sample_id)
  values (p_session_id, auth.uid(), p_photo_source, p_sample_id);
  return p_session_id;
end;
$$;

create or replace function public.attach_photo(p_session_id uuid, p_photo_path text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.has_active_consent(auth.uid()) then
    raise exception 'consent required';
  end if;
  update public.sessions
  set photo_path = p_photo_path
  where id = p_session_id and user_id = auth.uid() and status = 'created'
    and photo_path is null
    and p_photo_path like auth.uid()::text || '/' || p_session_id::text || '/%';
  if not found then raise exception 'session ownership or photo path invalid'; end if;
end;
$$;

create or replace function public.start_conversation(p_session_id uuid, p_question text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.has_active_consent(auth.uid()) then
    raise exception 'consent required';
  end if;
  if char_length(p_question) not between 1 and 240 then raise exception 'invalid question'; end if;
  update public.sessions set status = 'in_progress'
  where id = p_session_id and user_id = auth.uid() and status = 'created'
    and photo_path is not null;
  if not found then raise exception 'session state invalid'; end if;
  insert into public.messages(session_id, turn_number, role, content)
  values (p_session_id, 1, 'assistant', p_question);
end;
$$;

create or replace function public.save_answer(
  p_session_id uuid,
  p_turn_number integer,
  p_answer text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_expected integer;
begin
  if auth.uid() is null or not public.has_active_consent(auth.uid()) then
    raise exception 'consent required';
  end if;
  if char_length(trim(p_answer)) not between 1 and 4000 then raise exception 'invalid answer'; end if;
  perform 1 from public.sessions
  where id = p_session_id and user_id = auth.uid() and status = 'in_progress'
  for update;
  if not found then raise exception 'session state invalid'; end if;
  select count(*) + 1 into v_expected from public.messages
  where session_id = p_session_id and role = 'user';
  if p_turn_number <> v_expected or p_turn_number not between 1 and 3
     or not exists (
       select 1 from public.messages
       where session_id = p_session_id and turn_number = p_turn_number and role = 'assistant'
     ) then
    raise exception 'turn order invalid';
  end if;
  insert into public.messages(session_id, turn_number, role, content)
  values (p_session_id, p_turn_number, 'user', trim(p_answer));
  if p_turn_number = 3 then
    update public.sessions set status = 'awaiting_summary' where id = p_session_id;
    return 'awaiting_summary';
  end if;
  return 'in_progress';
end;
$$;

create or replace function public.save_assistant_question(
  p_session_id uuid,
  p_turn_number integer,
  p_question text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.has_active_consent(auth.uid()) then
    raise exception 'consent required';
  end if;
  if p_turn_number not between 2 and 3 or char_length(p_question) not between 1 and 240
     or not exists (
       select 1 from public.sessions
       where id = p_session_id and user_id = auth.uid() and status = 'in_progress'
     )
     or not exists (
       select 1 from public.messages
       where session_id = p_session_id and turn_number = p_turn_number - 1 and role = 'user'
     ) then
    raise exception 'turn state invalid';
  end if;
  insert into public.messages(session_id, turn_number, role, content)
  values (p_session_id, p_turn_number, 'assistant', p_question);
end;
$$;

create or replace function public.complete_session(
  p_session_id uuid,
  p_summary jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_keywords text[];
  v_source text;
  v_activity text;
  v_health text;
begin
  if auth.uid() is null or not public.has_active_consent(auth.uid()) then
    raise exception 'consent required';
  end if;
  perform 1 from public.sessions
    where id = p_session_id and user_id = auth.uid() and status = 'awaiting_summary'
    for update;
  if not found or (select count(*) from public.messages
        where session_id = p_session_id and role = 'user') <> 3 then
    raise exception 'session state invalid';
  end if;
  select array(select jsonb_array_elements_text(p_summary->'recall_keywords')),
         p_summary->>'summary_source',
         p_summary->>'activity_summary',
         p_summary->>'health_mention_note'
    into v_keywords, v_source, v_activity, v_health;
  if coalesce(array_length(v_keywords, 1), 0) > 5
     or char_length(v_activity) not between 1 and 600
     or (v_health is not null and char_length(v_health) > 240)
     or v_source not in ('ai', 'fallback') then
    raise exception 'invalid summary';
  end if;
  insert into public.summaries(
    session_id, recall_keywords, activity_summary, health_mention_note, summary_source
  ) values (p_session_id, coalesce(v_keywords, '{}'), v_activity, v_health, v_source);
  update public.sessions set status = 'completed', completed_at = now()
  where id = p_session_id and user_id = auth.uid();
end;
$$;

create or replace function public.save_checkin(
  p_session_id uuid,
  p_medication_status text,
  p_condition_status text,
  p_condition_note text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.has_active_consent(auth.uid()) then
    raise exception 'consent required';
  end if;
  if p_medication_status not in ('taken', 'not_taken', 'not_recorded')
     or p_condition_status not in ('good', 'okay', 'unwell', 'not_recorded')
     or char_length(coalesce(p_condition_note, '')) > 500
     or not exists (
       select 1 from public.sessions
       where id = p_session_id and user_id = auth.uid() and status = 'completed'
     ) then
    raise exception 'invalid checkin';
  end if;
  insert into public.checkins(
    session_id, medication_status, condition_status, condition_note, updated_at
  ) values (p_session_id, p_medication_status, p_condition_status, nullif(p_condition_note, ''), now())
  on conflict (session_id) do update set
    medication_status = excluded.medication_status,
    condition_status = excluded.condition_status,
    condition_note = excluded.condition_note,
    updated_at = now();
end;
$$;

create or replace function public.fail_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  update public.sessions set status = 'failed'
  where id = p_session_id and user_id = auth.uid() and status = 'created';
end;
$$;

create or replace function public.delete_all_user_data()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  delete from public.sessions where user_id = auth.uid();
  delete from public.consent_records where user_id = auth.uid();
end;
$$;

alter table public.consent_records enable row level security;
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.summaries enable row level security;
alter table public.checkins enable row level security;

create policy consent_select_own on public.consent_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy sessions_select_own on public.sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy messages_select_own on public.messages
  for select to authenticated using (
    exists (select 1 from public.sessions s where s.id = session_id and s.user_id = (select auth.uid()))
  );
create policy summaries_select_own on public.summaries
  for select to authenticated using (
    exists (select 1 from public.sessions s where s.id = session_id and s.user_id = (select auth.uid()))
  );
create policy checkins_select_own on public.checkins
  for select to authenticated using (
    exists (select 1 from public.sessions s where s.id = session_id and s.user_id = (select auth.uid()))
  );

revoke all on public.profiles, public.consent_records, public.sessions, public.messages, public.summaries, public.checkins
  from anon, authenticated;
grant select on public.profiles, public.consent_records, public.sessions, public.messages, public.summaries, public.checkins
  to authenticated;

revoke all on function public.record_consent(text, boolean, text) from public, anon;
revoke all on function public.start_session(uuid, text, text) from public, anon;
revoke all on function public.attach_photo(uuid, text) from public, anon;
revoke all on function public.start_conversation(uuid, text) from public, anon;
revoke all on function public.save_answer(uuid, integer, text) from public, anon;
revoke all on function public.save_assistant_question(uuid, integer, text) from public, anon;
revoke all on function public.complete_session(uuid, jsonb) from public, anon;
revoke all on function public.save_checkin(uuid, text, text, text) from public, anon;
revoke all on function public.fail_session(uuid) from public, anon;
revoke all on function public.delete_all_user_data() from public, anon;

grant execute on function public.record_consent(text, boolean, text) to authenticated;
grant execute on function public.start_session(uuid, text, text) to authenticated;
grant execute on function public.attach_photo(uuid, text) to authenticated;
grant execute on function public.start_conversation(uuid, text) to authenticated;
grant execute on function public.save_answer(uuid, integer, text) to authenticated;
grant execute on function public.save_assistant_question(uuid, integer, text) to authenticated;
grant execute on function public.complete_session(uuid, jsonb) to authenticated;
grant execute on function public.save_checkin(uuid, text, text, text) to authenticated;
grant execute on function public.fail_session(uuid) to authenticated;
grant execute on function public.delete_all_user_data() to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy photo_read_own on storage.objects
  for select to authenticated using (
    bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy photo_insert_own on storage.objects
  for insert to authenticated with check (
    bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy photo_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
