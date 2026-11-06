alter table public.sportlink_games
  add column if not exists photo_path text;

drop function public.sportlink_list_games(text, text, integer, timestamp with time zone, integer, integer);

create function public.sportlink_list_games(
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
  registration_open boolean,
  photo_path text
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
    g.registration_deadline is null or g.registration_deadline > now(),
    g.photo_path
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

create or replace function public.sportlink_my_game_registrations()
returns table (
  registration_id uuid,
  game_id uuid,
  title text,
  venue_name text,
  city text,
  district text,
  venue_address text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  fee numeric,
  registration_status text,
  waitlist_position integer,
  registered_at timestamp with time zone
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    g.id,
    g.title,
    g.venue_name,
    g.city,
    g.district,
    g.venue_address,
    g.starts_at,
    g.ends_at,
    g.fee,
    r.status,
    r.waitlist_position,
    r.created_at
  from public.sportlink_game_registrations as r
  join public.sportlink_games as g on g.id = r.game_id
  where r.user_id = auth.uid()
    and r.status in ('confirmed', 'waitlisted', 'pending_approval')
    and g.starts_at > now()
  order by g.starts_at asc, r.created_at asc, r.id asc;
$$;

revoke all on function public.sportlink_my_game_registrations()
  from public, anon, authenticated;
grant execute on function public.sportlink_my_game_registrations()
  to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sportlink-game-photos',
  'sportlink-game-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "SportLink game host uploads own game photo" on storage.objects;
create policy "SportLink game host uploads own game photo"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'sportlink-game-photos'
  and name ~* (
    '^' || auth.uid()::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  )
);

drop policy if exists "SportLink game host deletes own game photo" on storage.objects;
create policy "SportLink game host deletes own game photo"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'sportlink-game-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.sportlink_set_game_photo(
  p_game_id uuid,
  p_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception '請先登入';
  end if;
  if p_game_id is null or p_storage_path is null or char_length(p_storage_path) > 255 then
    raise exception '照片資料不正確';
  end if;

  if p_storage_path !~* (
    '^' || v_user_id::text || '/' || p_game_id::text || '/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  ) then
    raise exception '照片路徑不正確';
  end if;

  update public.sportlink_games as g
  set photo_path = p_storage_path,
      updated_at = now()
  where g.id = p_game_id
    and g.host_id = v_user_id
    and exists (
      select 1
      from storage.objects as o
      where o.bucket_id = 'sportlink-game-photos'
        and o.name = p_storage_path
    );

  if not found then
    raise exception '找不到球局或照片上傳尚未完成';
  end if;

  return true;
end;
$$;

revoke all on function public.sportlink_set_game_photo(uuid, text)
  from public, anon, authenticated;
grant execute on function public.sportlink_set_game_photo(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
