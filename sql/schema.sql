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
