create or replace function public.sportlink_hosted_games()
returns table (
  game_id uuid,
  title text,
  venue_name text,
  city text,
  district text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  capacity integer,
  fee numeric,
  registration_id uuid,
  player_name text,
  player_level integer,
  registration_status text,
  waitlist_position integer,
  note text,
  registered_at timestamp with time zone
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
    g.starts_at,
    g.ends_at,
    g.capacity,
    g.fee,
    r.id,
    r.player_name,
    r.player_level,
    r.status,
    r.waitlist_position,
    r.note,
    r.created_at
  from public.sportlink_games as g
  left join public.sportlink_game_registrations as r on r.game_id = g.id
  where g.host_id = auth.uid()
    and g.status = 'open'
    and g.starts_at > now()
  order by g.starts_at asc, r.created_at asc nulls last, r.id asc nulls last;
$$;

revoke all on function public.sportlink_hosted_games()
  from public, anon, authenticated;
grant execute on function public.sportlink_hosted_games()
  to authenticated;

notify pgrst, 'reload schema';
