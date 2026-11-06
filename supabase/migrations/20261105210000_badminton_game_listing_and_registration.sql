alter table public.sportlink_game_registrations
  drop constraint registration_status_check;

alter table public.sportlink_game_registrations
  add constraint registration_status_check
  check (status in ('confirmed', 'waitlisted', 'pending_approval', 'cancelled', 'rejected'));

create or replace function public.sportlink_list_games(
  p_city text default null,
  p_district text default null,
  p_level integer default null,
  p_starts_before timestamp with time zone default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  game_id uuid,
  title text,
  venue_name text,
  city text,
  district text,
  venue_address text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  capacity integer,
  level_min integer,
  level_max integer,
  fee numeric,
  description text,
  registration_deadline timestamp with time zone,
  confirmed_count bigint,
  available_slots integer,
  registration_open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    g.title,
    g.venue_name,
    g.city,
    g.district,
    g.venue_address,
    g.starts_at,
    g.ends_at,
    g.capacity,
    g.level_min,
    g.level_max,
    g.fee,
    g.description,
    g.registration_deadline,
    coalesce(reg.confirmed_count, 0)::bigint,
    case
      when coalesce(reg.waitlist_count, 0) > 0 then 0
      else greatest(g.capacity - coalesce(reg.confirmed_count, 0)::integer - coalesce(resv.total_slots, 0)::integer, 0)
    end,
    g.registration_deadline is null or g.registration_deadline > now()
  from public.sportlink_games as g
  left join lateral (
    select
      count(*) filter (where r.status = 'confirmed') as confirmed_count,
      count(*) filter (where r.status = 'waitlisted') as waitlist_count
    from public.sportlink_game_registrations as r
    where r.game_id = g.id
  ) as reg on true
  left join lateral (
    select coalesce(sum(r.reserved_slots), 0)::bigint as total_slots
    from public.sportlink_game_reservations as r
    where r.game_id = g.id
      and r.status in ('reserved', 'invited', 'claimed')
  ) as resv on true
  where g.status = 'open'
    and g.starts_at > now()
    and (nullif(btrim(coalesce(p_city, '')), '') is null or g.city = btrim(p_city))
    and (nullif(btrim(coalesce(p_district, '')), '') is null or g.district = btrim(p_district))
    and (p_level is null or (p_level between g.level_min and g.level_max))
    and (p_starts_before is null or g.starts_at < p_starts_before)
  order by g.starts_at asc, g.id asc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.sportlink_list_games(text, text, integer, timestamp with time zone, integer, integer)
  from public, anon, authenticated;
grant execute on function public.sportlink_list_games(text, text, integer, timestamp with time zone, integer, integer)
  to anon, authenticated;

create or replace function public.sportlink_register_for_game(
  p_game_id uuid,
  p_player_name text,
  p_player_level integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_game public.sportlink_games%rowtype;
  v_existing public.sportlink_game_registrations%rowtype;
  v_confirmed integer;
  v_reserved integer;
  v_waitlist_count integer;
  v_waitlist_position integer;
  v_status text;
  v_registration_id uuid;
  v_now timestamp with time zone := now();
  v_player_name text := nullif(btrim(coalesce(p_player_name, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception '請先登入才能報名';
  end if;

  if p_game_id is null then
    raise exception '球局資料不正確';
  end if;
  if v_player_name is null or char_length(v_player_name) > 60 then
    raise exception '請填寫 1 至 60 字的暱稱';
  end if;
  if p_player_level is null or p_player_level < 1 or p_player_level > 18 then
    raise exception '羽球級數必須介於 1 至 18';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception '備註不可超過 500 字';
  end if;

  select g.*
  into v_game
  from public.sportlink_games as g
  where g.id = p_game_id
  for update;

  if not found or v_game.status <> 'open' or v_game.starts_at <= v_now then
    raise exception '球局不存在或已停止報名';
  end if;
  if v_game.registration_deadline is not null and v_game.registration_deadline <= v_now then
    raise exception '此球局已截止報名';
  end if;

  select r.*
  into v_existing
  from public.sportlink_game_registrations as r
  where r.game_id = p_game_id and r.user_id = v_user_id
  for update;

  if found and v_existing.status not in ('cancelled', 'rejected') then
    raise exception '你已經報名此球局';
  end if;

  select count(*)::integer
  into v_confirmed
  from public.sportlink_game_registrations as r
  where r.game_id = p_game_id and r.status = 'confirmed';

  select coalesce(sum(r.reserved_slots), 0)::integer
  into v_reserved
  from public.sportlink_game_reservations as r
  where r.game_id = p_game_id
    and r.status in ('reserved', 'invited', 'claimed');

  select count(*)::integer
  into v_waitlist_count
  from public.sportlink_game_registrations as r
  where r.game_id = p_game_id and r.status = 'waitlisted';

  if p_player_level < v_game.level_min or p_player_level > v_game.level_max then
    v_status := 'pending_approval';
    v_waitlist_position := null;
  elsif v_confirmed + v_reserved < v_game.capacity and v_waitlist_count = 0 then
    v_status := 'confirmed';
    v_waitlist_position := null;
  else
    v_status := 'waitlisted';
    if exists (
      select 1
      from public.sportlink_game_registrations as r
      where r.game_id = p_game_id
        and r.status = 'waitlisted'
        and r.waitlist_position is null
    ) then
      v_waitlist_position := null;
    else
      select coalesce(max(r.waitlist_position), 0)::integer + 1
      into v_waitlist_position
      from public.sportlink_game_registrations as r
      where r.game_id = p_game_id and r.status = 'waitlisted';
    end if;
  end if;

  insert into public.sportlink_game_registrations (
    game_id,
    user_id,
    player_name,
    player_level,
    status,
    waitlist_position,
    note,
    created_at,
    updated_at
  )
  values (
    p_game_id,
    v_user_id,
    v_player_name,
    p_player_level,
    v_status,
    v_waitlist_position,
    v_note,
    v_now,
    v_now
  )
  on conflict (game_id, user_id) do update
  set player_name = excluded.player_name,
      player_level = excluded.player_level,
      status = excluded.status,
      waitlist_position = excluded.waitlist_position,
      note = excluded.note,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  returning id into v_registration_id;

  return jsonb_build_object(
    'registration_id', v_registration_id,
    'status', v_status,
    'waitlist_position', v_waitlist_position
  );
end;
$$;

revoke all on function public.sportlink_register_for_game(uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.sportlink_register_for_game(uuid, text, integer, text)
  to authenticated;

create or replace function public.sportlink_review_game_registration(
  p_registration_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_game public.sportlink_games%rowtype;
  v_registration public.sportlink_game_registrations%rowtype;
  v_confirmed integer;
  v_reserved integer;
  v_waitlist_count integer;
  v_waitlist_position integer;
  v_status text;
  v_now timestamp with time zone := now();
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception '請先登入';
  end if;
  if p_registration_id is null or p_approve is null then
    raise exception '審核資料不正確';
  end if;

  select g.*
  into v_game
  from public.sportlink_games as g
  join public.sportlink_game_registrations as r on r.game_id = g.id
  where r.id = p_registration_id
  for update of g;

  if not found then
    raise exception '報名資料不存在';
  end if;
  if v_game.host_id <> v_user_id then
    raise exception '只有團主可以審核報名';
  end if;
  if v_game.status <> 'open' or v_game.starts_at <= v_now then
    raise exception '球局已停止處理報名';
  end if;

  select r.*
  into v_registration
  from public.sportlink_game_registrations as r
  where r.id = p_registration_id
  for update;

  if not found or v_registration.status <> 'pending_approval' then
    raise exception '此報名目前不需要審核';
  end if;

  if not p_approve then
    update public.sportlink_game_registrations
    set status = 'rejected',
        waitlist_position = null,
        updated_at = v_now
    where id = p_registration_id;

    return jsonb_build_object(
      'registration_id', p_registration_id,
      'status', 'rejected',
      'decision', 'rejected'
    );
  end if;

  select count(*)::integer
  into v_confirmed
  from public.sportlink_game_registrations as r
  where r.game_id = v_game.id and r.status = 'confirmed';

  select coalesce(sum(r.reserved_slots), 0)::integer
  into v_reserved
  from public.sportlink_game_reservations as r
  where r.game_id = v_game.id
    and r.status in ('reserved', 'invited', 'claimed');

  select count(*)::integer
  into v_waitlist_count
  from public.sportlink_game_registrations as r
  where r.game_id = v_game.id and r.status = 'waitlisted';

  if v_confirmed + v_reserved < v_game.capacity and v_waitlist_count = 0 then
    v_status := 'confirmed';
    v_waitlist_position := null;
  else
    v_status := 'waitlisted';
    if exists (
      select 1
      from public.sportlink_game_registrations as r
      where r.game_id = v_game.id
        and r.status = 'waitlisted'
        and r.waitlist_position is null
    ) then
      v_waitlist_position := null;
    else
      select coalesce(max(r.waitlist_position), 0)::integer + 1
      into v_waitlist_position
      from public.sportlink_game_registrations as r
      where r.game_id = v_game.id and r.status = 'waitlisted';
    end if;
  end if;

  update public.sportlink_game_registrations
  set status = v_status,
      waitlist_position = v_waitlist_position,
      updated_at = v_now
  where id = p_registration_id;

  return jsonb_build_object(
    'registration_id', p_registration_id,
    'status', v_status,
    'waitlist_position', v_waitlist_position,
    'decision', 'approved'
  );
end;
$$;

revoke all on function public.sportlink_review_game_registration(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.sportlink_review_game_registration(uuid, boolean)
  to authenticated;

create or replace function public.sportlink_cancel_game_registration(
  p_registration_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_game public.sportlink_games%rowtype;
  v_registration public.sportlink_game_registrations%rowtype;
  v_now timestamp with time zone := now();
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception '請先登入';
  end if;
  if p_registration_id is null then
    raise exception '報名資料不正確';
  end if;

  select g.*
  into v_game
  from public.sportlink_games as g
  join public.sportlink_game_registrations as r on r.game_id = g.id
  where r.id = p_registration_id
    and r.user_id = v_user_id
  for update of g;

  if not found then
    raise exception '報名資料不存在';
  end if;
  if v_game.starts_at <= v_now then
    raise exception '球局開始後不可取消報名';
  end if;

  select r.*
  into v_registration
  from public.sportlink_game_registrations as r
  where r.id = p_registration_id
    and r.user_id = v_user_id
  for update;

  if not found or v_registration.status not in ('confirmed', 'waitlisted', 'pending_approval') then
    raise exception '此報名目前無法取消';
  end if;

  update public.sportlink_game_registrations
  set status = 'cancelled',
      waitlist_position = null,
      updated_at = v_now
  where id = p_registration_id;

  return jsonb_build_object(
    'registration_id', p_registration_id,
    'status', 'cancelled'
  );
end;
$$;

revoke all on function public.sportlink_cancel_game_registration(uuid)
  from public, anon, authenticated;
grant execute on function public.sportlink_cancel_game_registration(uuid)
  to authenticated;

create or replace function public.sportlink_promote_next_waitlisted(
  p_game_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_game public.sportlink_games%rowtype;
  v_registration public.sportlink_game_registrations%rowtype;
  v_confirmed integer;
  v_reserved integer;
  v_now timestamp with time zone := now();
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception '請先登入';
  end if;
  if p_game_id is null then
    raise exception '球局資料不正確';
  end if;

  select g.*
  into v_game
  from public.sportlink_games as g
  where g.id = p_game_id
  for update;

  if not found then
    raise exception '球局不存在';
  end if;
  if v_game.host_id <> v_user_id then
    raise exception '只有團主可以遞補候補';
  end if;
  if v_game.status <> 'open' or v_game.starts_at <= v_now then
    raise exception '球局已停止處理報名';
  end if;

  select count(*)::integer
  into v_confirmed
  from public.sportlink_game_registrations as r
  where r.game_id = p_game_id and r.status = 'confirmed';

  select coalesce(sum(r.reserved_slots), 0)::integer
  into v_reserved
  from public.sportlink_game_reservations as r
  where r.game_id = p_game_id
    and r.status in ('reserved', 'invited', 'claimed');

  if v_confirmed + v_reserved >= v_game.capacity then
    raise exception '目前沒有可遞補的名額';
  end if;

  select r.*
  into v_registration
  from public.sportlink_game_registrations as r
  where r.game_id = p_game_id and r.status = 'waitlisted'
  order by r.waitlist_position asc nulls last, r.created_at asc, r.id asc
  limit 1
  for update;

  if not found then
    raise exception '目前沒有候補球友';
  end if;

  update public.sportlink_game_registrations
  set status = 'confirmed',
      waitlist_position = null,
      updated_at = v_now
  where id = v_registration.id;

  return jsonb_build_object(
    'registration_id', v_registration.id,
    'status', 'confirmed',
    'waitlist_position', null::integer
  );
end;
$$;

revoke all on function public.sportlink_promote_next_waitlisted(uuid)
  from public, anon, authenticated;
grant execute on function public.sportlink_promote_next_waitlisted(uuid)
  to authenticated;
