CREATE OR REPLACE FUNCTION public.sportlink_coach_calendar(p_month_start date)
RETURNS TABLE (
  booking_id uuid,
  lesson_date text,
  lesson_time text,
  duration_minutes integer,
  status text,
  student_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.coaches AS coach
    WHERE coach.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION '只有教練可以查看課程行事曆';
  END IF;

  RETURN QUERY
  SELECT
    booking.id,
    booking.lesson_date::text,
    booking.lesson_time::text,
    COALESCE(booking.duration_minutes, 60)::integer,
    booking.status::text,
    COALESCE(
      NULLIF(BTRIM(student.raw_user_meta_data ->> 'display_name'), ''),
      '學生會員'
    )
  FROM public.bookings AS booking
  JOIN public.coaches AS coach
    ON coach.id = booking.coach_id
   AND coach.user_id = auth.uid()
  LEFT JOIN auth.users AS student
    ON student.id = booking.student_id
  WHERE booking.lesson_date >= p_month_start
    AND booking.lesson_date < (p_month_start + INTERVAL '1 month')::date
    AND booking.status::text IN ('pending', 'accepted', 'completed')
  ORDER BY booking.lesson_date, booking.lesson_time;
END;
$$;

REVOKE ALL ON FUNCTION public.sportlink_coach_calendar(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sportlink_coach_calendar(date)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
