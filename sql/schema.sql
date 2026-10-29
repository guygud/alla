-- Тренажёр умножения. Тот же проект Supabase, что и хоккей.
-- Прямого доступа у ключа anon нет: только функции с проверкой PIN.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.mt_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text not null unique,
  pin_hash text not null,
  fails int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mt_state (
  profile_id uuid primary key references public.mt_profiles (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.mt_attempts (
  id uuid primary key,
  profile_id uuid not null references public.mt_profiles (id) on delete cascade,
  mode text not null check (mode in ('facts', 'column', 'division')),
  ok boolean not null,
  ms int not null check (ms >= 0 and ms <= 3600000),
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mt_attempts_profile_created
  on public.mt_attempts (profile_id, created_at desc);

alter table public.mt_profiles enable row level security;
alter table public.mt_state enable row level security;
alter table public.mt_attempts enable row level security;

revoke all on table public.mt_profiles from public, anon, authenticated;
revoke all on table public.mt_state from public, anon, authenticated;
revoke all on table public.mt_attempts from public, anon, authenticated;

create or replace function public.mt_safe_ts(p text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.mt_auth(p_name text, p_pin text, p_create boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_key text := lower(v_name);
  v_rec public.mt_profiles%rowtype;
  v_id uuid;
begin
  if v_name !~ '^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё -]{0,22}[A-Za-zА-Яа-яЁё]$' then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_pin');
  end if;

  select * into v_rec from public.mt_profiles where name_key = v_key;
  if found then
    if v_rec.locked_until is not null and v_rec.locked_until > now() then
      return jsonb_build_object('ok', false, 'error', 'locked');
    end if;
    if v_rec.pin_hash is distinct from extensions.crypt(p_pin, v_rec.pin_hash) then
      update public.mt_profiles
        set fails = case when fails + 1 >= 5 then 0 else fails + 1 end,
            locked_until = case when fails + 1 >= 5 then now() + interval '1 minute' else null end
      where id = v_rec.id;
      return jsonb_build_object('ok', false, 'error', 'bad_pin');
    end if;
    update public.mt_profiles set fails = 0, locked_until = null where id = v_rec.id and (fails <> 0 or locked_until is not null);
    return jsonb_build_object('ok', true, 'id', v_rec.id, 'name', v_rec.name, 'created', false);
  end if;

  if not p_create then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.mt_profiles (name, name_key, pin_hash)
  values (v_name, v_key, extensions.crypt(p_pin, extensions.gen_salt('bf')))
  returning id into v_id;

  insert into public.mt_state (profile_id, state)
  values (v_id, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_name, 'created', true);
end;
$$;

create or replace function public.mt_login(p_name text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_auth jsonb;
  v_state jsonb;
  v_updated timestamptz;
begin
  v_auth := public.mt_auth(p_name, p_pin, true);
  if coalesce(v_auth->>'ok', 'false') <> 'true' then
    return v_auth;
  end if;
  select state, updated_at into v_state, v_updated
  from public.mt_state
  where profile_id = (v_auth->>'id')::uuid;
  return jsonb_build_object(
    'ok', true,
    'created', coalesce((v_auth->>'created')::boolean, false),
    'name', v_auth->>'name',
    'state', coalesce(v_state, '{}'::jsonb),
    'updated_at', v_updated
  );
end;
$$;

create or replace function public.mt_save(
  p_name text,
  p_pin text,
  p_state jsonb,
  p_updated_at timestamptz,
  p_attempts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_auth jsonb;
  v_id uuid;
  v_state jsonb;
  v_updated timestamptz;
begin
  v_auth := public.mt_auth(p_name, p_pin, true);
  if coalesce(v_auth->>'ok', 'false') <> 'true' then
    return v_auth;
  end if;
  v_id := (v_auth->>'id')::uuid;

  if jsonb_typeof(p_attempts) = 'array' then
    insert into public.mt_attempts (id, profile_id, mode, ok, ms, detail, created_at)
    select
      s.id::uuid,
      v_id,
      s.mode,
      s.ok = 'true',
      s.ms::int,
      s.detail,
      case
        when public.mt_safe_ts(s.at) > now() - interval '14 days'
         and public.mt_safe_ts(s.at) < now() + interval '1 day'
        then public.mt_safe_ts(s.at)
        else now()
      end
    from (
      select
        a->>'id' as id,
        a->>'mode' as mode,
        a->>'ok' as ok,
        a->>'ms' as ms,
        a->>'at' as at,
        case
          when octet_length(coalesce(a->'detail', '{}'::jsonb)::text) < 2000 then coalesce(a->'detail', '{}'::jsonb)
          else '{}'::jsonb
        end as detail
      from jsonb_array_elements(p_attempts) with ordinality as t(a, n)
      where t.n <= 100
        and (a->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and a->>'mode' in ('facts', 'column', 'division')
        and (a->>'ms') ~ '^[0-9]{1,7}$'
        and a->>'ok' in ('true', 'false')
    ) s
    where s.ms::int between 0 and 3600000
    on conflict (id) do nothing;
  end if;

  if jsonb_typeof(p_state) = 'object' and octet_length(p_state::text) < 200000 then
    insert into public.mt_state (profile_id, state, updated_at)
    values (v_id, p_state, coalesce(p_updated_at, now()))
    on conflict (profile_id) do update
      set state = excluded.state,
          updated_at = excluded.updated_at
      where public.mt_state.updated_at <= excluded.updated_at;
  end if;

  select state, updated_at into v_state, v_updated
  from public.mt_state where profile_id = v_id;

  return jsonb_build_object(
    'ok', true,
    'name', v_auth->>'name',
    'state', coalesce(v_state, '{}'::jsonb),
    'updated_at', v_updated
  );
end;
$$;

create or replace function public.mt_parent(p_name text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_auth jsonb;
  v_id uuid;
  v_state jsonb;
  v_days jsonb;
  v_modes jsonb;
begin
  v_auth := public.mt_auth(p_name, p_pin, false);
  if coalesce(v_auth->>'ok', 'false') <> 'true' then
    return v_auth;
  end if;
  v_id := (v_auth->>'id')::uuid;
  select state into v_state from public.mt_state where profile_id = v_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'day', day,
    'mode', mode,
    'ok', ok,
    'bad', bad
  ) order by day, mode), '[]'::jsonb)
  into v_days
  from (
    select
      to_char(created_at at time zone 'Europe/Moscow', 'YYYY-MM-DD') as day,
      mode,
      count(*) filter (where ok)::int as ok,
      count(*) filter (where not ok)::int as bad
    from public.mt_attempts
    where profile_id = v_id
      and created_at > now() - interval '30 days'
    group by 1, 2
  ) days;

  select coalesce(jsonb_object_agg(mode, jsonb_build_object(
    'ok', ok,
    'bad', bad,
    'med_ms', med_ms
  )), '{}'::jsonb)
  into v_modes
  from (
    select
      mode,
      count(*) filter (where ok)::int as ok,
      count(*) filter (where not ok)::int as bad,
      coalesce((percentile_cont(0.5) within group (order by ms))::int, 0) as med_ms
    from public.mt_attempts
    where profile_id = v_id
      and created_at > now() - interval '14 days'
    group by mode
  ) modes;

  return jsonb_build_object(
    'ok', true,
    'name', v_auth->>'name',
    'state', coalesce(v_state, '{}'::jsonb),
    'days', v_days,
    'modes', v_modes
  );
end;
$$;

revoke all on function public.mt_auth(text, text, boolean) from public, anon, authenticated;
revoke all on function public.mt_safe_ts(text) from public, anon, authenticated;
revoke all on function public.mt_login(text, text) from public;
revoke all on function public.mt_save(text, text, jsonb, timestamptz, jsonb) from public;
revoke all on function public.mt_parent(text, text) from public;

grant execute on function public.mt_login(text, text) to anon, authenticated;
grant execute on function public.mt_save(text, text, jsonb, timestamptz, jsonb) to anon, authenticated;
grant execute on function public.mt_parent(text, text) to anon, authenticated;

-- Напоминание в 18:00 по Москве, если за день не было примеров.
-- Ключи пуша лежат в vault, не в этом файле.

create table if not exists public.mt_push (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.mt_profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  last_sent date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mt_push_profile on public.mt_push (profile_id);

alter table public.mt_push enable row level security;
revoke all on table public.mt_push from public, anon, authenticated;

create or replace function public.mt_push_save(
  p_name text,
  p_pin text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_auth jsonb;
  v_id uuid;
begin
  v_auth := public.mt_auth(p_name, p_pin, false);
  if coalesce(v_auth->>'ok', 'false') <> 'true' then
    return v_auth;
  end if;
  if p_endpoint is null
     or char_length(p_endpoint) < 12
     or char_length(p_endpoint) > 2000
     or p_endpoint !~ '^https://'
     or p_p256dh !~ '^[A-Za-z0-9_-]{16,200}$'
     or p_auth !~ '^[A-Za-z0-9_-]{8,200}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_endpoint');
  end if;
  v_id := (v_auth->>'id')::uuid;
  insert into public.mt_push (profile_id, endpoint, p256dh, auth)
  values (v_id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mt_push_drop(p_name text, p_pin text, p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_auth jsonb;
begin
  v_auth := public.mt_auth(p_name, p_pin, false);
  if coalesce(v_auth->>'ok', 'false') <> 'true' then
    return v_auth;
  end if;
  delete from public.mt_push
  where profile_id = (v_auth->>'id')::uuid
    and endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mt_runtime_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  if p_name not in ('mt_reminder_secret', 'mt_vapid_keys') then
    return null;
  end if;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = p_name
  limit 1;
  return v_secret;
end;
$$;

create or replace function public.mt_touch()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.mt_profiles);
$$;

create or replace function public.mt_due_pushes()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id)), '[]'::jsonb)
  from public.mt_push s
  where s.last_sent is distinct from (timezone('Europe/Moscow', now()))::date
    and not exists (
      select 1 from public.mt_attempts a
      where a.profile_id = s.profile_id
        and (timezone('Europe/Moscow', a.created_at))::date = (timezone('Europe/Moscow', now()))::date
    );
$$;

create or replace function public.mt_push_claim(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endpoint text;
  v_p256dh text;
  v_auth text;
  v_today date := (timezone('Europe/Moscow', now()))::date;
begin
  update public.mt_push s
    set last_sent = v_today,
        updated_at = now()
    where s.id = p_id
      and s.last_sent is distinct from v_today
      and not exists (
        select 1 from public.mt_attempts a
        where a.profile_id = s.profile_id
          and (timezone('Europe/Moscow', a.created_at))::date = v_today
      )
    returning s.endpoint, s.p256dh, s.auth
    into v_endpoint, v_p256dh, v_auth;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'endpoint', v_endpoint, 'p256dh', v_p256dh, 'auth', v_auth);
end;
$$;

create or replace function public.mt_push_release(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mt_push
    set last_sent = null,
        updated_at = now()
    where id = p_id;
$$;

create or replace function public.mt_push_forget(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.mt_push where id = p_id;
$$;

create or replace function public.mt_fire_reminder(p_remind boolean)
returns bigint
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_secret text;
  v_id bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'mt_reminder_secret'
  limit 1;
  if v_secret is null then
    return null;
  end if;
  select net.http_post(
    url := 'https://bamcbftomojefzxzwdmn.supabase.co/functions/v1/send-reminders',
    body := jsonb_build_object('remind', coalesce(p_remind, false)),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', v_secret
    ),
    timeout_milliseconds := 20000
  ) into v_id;
  return v_id;
end;
$$;

revoke all on function public.mt_push_save(text, text, text, text, text) from public;
revoke all on function public.mt_push_drop(text, text, text) from public;
revoke all on function public.mt_runtime_secret(text) from public, anon, authenticated;
revoke all on function public.mt_touch() from public, anon, authenticated;
revoke all on function public.mt_due_pushes() from public, anon, authenticated;
revoke all on function public.mt_push_claim(uuid) from public, anon, authenticated;
revoke all on function public.mt_push_release(uuid) from public, anon, authenticated;
revoke all on function public.mt_push_forget(uuid) from public, anon, authenticated;
revoke all on function public.mt_fire_reminder(boolean) from public, anon, authenticated;

grant execute on function public.mt_push_save(text, text, text, text, text) to anon, authenticated;
grant execute on function public.mt_push_drop(text, text, text) to anon, authenticated;
grant execute on function public.mt_runtime_secret(text) to service_role;
grant execute on function public.mt_touch() to service_role;
grant execute on function public.mt_due_pushes() to service_role;
grant execute on function public.mt_push_claim(uuid) to service_role;
grant execute on function public.mt_push_release(uuid) to service_role;
grant execute on function public.mt_push_forget(uuid) to service_role;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- 08:00 и 13:00 по Москве только будят базу. В 18:00 уходит пуш.
do $$
declare
  v_name text;
begin
  execute format('grant execute on function public.mt_fire_reminder(boolean) to %I', current_user);
  foreach v_name in array array['mt-ping-08', 'mt-ping-13', 'mt-remind-18'] loop
    if exists (select 1 from cron.job where jobname = v_name) then
      perform cron.unschedule(v_name);
    end if;
  end loop;
end $$;

select cron.schedule('mt-ping-08', '0 5 * * *', 'select public.mt_fire_reminder(false)');
select cron.schedule('mt-ping-13', '0 10 * * *', 'select public.mt_fire_reminder(false)');
select cron.schedule('mt-remind-18', '0 15 * * *', 'select public.mt_fire_reminder(true)');
