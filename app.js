-- SportLink 第二步：教練管理自己的開放時段
-- 只新增兩個受權限控管的 RPC；不刪除既有預約或教練。

create or replace function public.sportlink_add_availability(p_date date, p_time time without time zone)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_coach_id uuid;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  if p_date is null or p_time is null or (p_date + p_time) <= (now() at time zone 'Asia/Taipei') then
    raise exception '只能新增未來的時段（台灣時間）';
  end if;
  select id into v_coach_id from public.coaches
  where user_id = auth.uid() and is_active = true;
  if v_coach_id is null then raise exception '只有已核准教練可以設定時段'; end if;
  insert into public.coach_availability(coach_id,lesson_date,lesson_time)
  values(v_coach_id,p_date,p_time)
  on conflict (coach_id,lesson_date,lesson_time) do nothing;
  return found;
end;
$$;

create or replace function public.sportlink_remove_availability(p_slot_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_slot public.coach_availability%rowtype;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  select a.* into v_slot from public.coach_availability a
  join public.coaches c on c.id = a.coach_id
  where a.id = p_slot_id and c.user_id = auth.uid()
  for update of a;
  if not found then return false; end if;
  if exists (select 1 from public.bookings b
    where b.coach_id=v_slot.coach_id and b.lesson_date=v_slot.lesson_date
      and b.lesson_time=v_slot.lesson_time and b.status in ('pending','accepted')) then
    raise exception '此時段已有有效預約，請先處理預約';
  end if;
  delete from public.coach_availability where id=p_slot_id;
  return found;
end;
$$;

revoke all on function public.sportlink_add_availability(date,time without time zone) from public, anon;
revoke all on function public.sportlink_remove_availability(uuid) from public, anon;
grant execute on function public.sportlink_add_availability(date,time without time zone) to authenticated;
grant execute on function public.sportlink_remove_availability(uuid) to authenticated;
